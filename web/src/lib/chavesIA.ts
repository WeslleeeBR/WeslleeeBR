import "server-only";
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar, mascarar } from "@/lib/cripto";
import { registrarEvento } from "@/lib/log";
import { metaProvedor, modeloPadraoDe, PROVEDORES, type Provedor } from "@/lib/provedores";

/**
 * Chaves de API dos provedores de IA.
 *
 * Camadas de proteção do segredo, na ordem em que atuam:
 *
 *  1. Cifrado em repouso (AES-256-GCM, src/lib/cripto.ts) — dump do banco não
 *     devolve chave nenhuma.
 *  2. Material de chave só no ambiente, nunca no banco.
 *  3. **Não existe endpoint que devolva o segredo.** `ChaveIAView` é o único
 *     formato que sai daqui para uma resposta de API, e ele não tem o campo.
 *     Não é filtragem: o valor nem é selecionado do banco.
 *  4. `chavesParaUso()` é server-only e só o orquestrador do chat usa.
 *  5. Criação, remoção e troca viram evento de auditoria — sem o valor.
 *  6. Trocar uma chave é substituir, nunca editar em cima: o antigo some.
 */

/** O que a UI recebe. Sem segredo — por construção, não por filtro. */
export interface ChaveIAView {
  id: string;
  provedor: string;
  nomeProvedor: string;
  rotulo: string;
  /** `gsk_••••••1a2b`. Suficiente para identificar, inútil para usar. */
  mascara: string;
  modelo: string | null;
  modeloEfetivo: string;
  prioridade: number;
  ativa: boolean;
  ultimoErro: string | null;
  ultimoUsoEm: string | null;
  criadoEm: string;
}

const SELECT_SEGURO = {
  id: true,
  provedor: true,
  rotulo: true,
  final4: true,
  modelo: true,
  prioridade: true,
  ativa: true,
  ultimoErro: true,
  ultimoUsoEm: true,
  criadoEm: true,
} as const;

type LinhaSegura = {
  id: string;
  provedor: string;
  rotulo: string;
  final4: string;
  modelo: string | null;
  prioridade: number;
  ativa: boolean;
  ultimoErro: string | null;
  ultimoUsoEm: Date | null;
  criadoEm: Date;
};

function paraView(c: LinhaSegura): ChaveIAView {
  const meta = metaProvedor(c.provedor);
  return {
    id: c.id,
    provedor: c.provedor,
    nomeProvedor: meta?.nome ?? c.provedor,
    rotulo: c.rotulo,
    mascara: mascarar(meta?.prefixo ?? "", c.final4),
    modelo: c.modelo,
    modeloEfetivo: c.modelo || modeloPadraoDe(c.provedor),
    prioridade: c.prioridade,
    ativa: c.ativa,
    ultimoErro: c.ultimoErro,
    ultimoUsoEm: c.ultimoUsoEm?.toISOString() ?? null,
    criadoEm: c.criadoEm.toISOString(),
  };
}

/** Lista para a tela. A coluna do segredo nem é lida do banco. */
export async function listarChaves(usuarioId: string): Promise<ChaveIAView[]> {
  const linhas = await prisma.chaveIA.findMany({
    where: { usuarioId },
    orderBy: [{ prioridade: "asc" }, { criadoEm: "asc" }],
    select: SELECT_SEGURO,
  });
  return linhas.map(paraView);
}

export async function criarChave({
  usuarioId,
  provedor,
  rotulo,
  segredo,
  modelo,
}: {
  usuarioId: string;
  provedor: Provedor;
  rotulo: string;
  segredo: string;
  modelo?: string | null;
}): Promise<ChaveIAView> {
  // A nova entra no fim da fila de tentativas; reordenar é arrastar na tela.
  const ultima = await prisma.chaveIA.findFirst({
    where: { usuarioId },
    orderBy: { prioridade: "desc" },
    select: { prioridade: true },
  });

  const criada = await prisma.chaveIA.create({
    data: {
      usuarioId,
      provedor,
      rotulo,
      segredoCifrado: cifrar(segredo.trim()),
      final4: segredo.trim().slice(-4),
      modelo: modelo?.trim() || null,
      prioridade: (ultima?.prioridade ?? -1) + 1,
    },
    select: SELECT_SEGURO,
  });

  await registrarEvento({
    tipo: "CHAVE_IA_CRIADA",
    usuarioId,
    detalhe: { provedor, rotulo }, // sem o segredo, nem mascarado
  });

  return paraView(criada);
}

export async function atualizarChave(
  usuarioId: string,
  id: string,
  dados: { rotulo?: string; modelo?: string | null; ativa?: boolean; prioridade?: number }
): Promise<ChaveIAView | null> {
  // updateMany com o usuarioId no where: garante que ninguém mexa na chave de
  // outra pessoa mesmo conhecendo o id.
  const { count } = await prisma.chaveIA.updateMany({
    where: { id, usuarioId },
    data: {
      ...dados,
      // Reativar manualmente limpa o erro anterior — senão a tela segue
      // mostrando "cota estourada" para uma chave que já voltou a funcionar.
      ...(dados.ativa === true ? { ultimoErro: null } : {}),
    },
  });
  if (count === 0) return null;

  const atualizada = await prisma.chaveIA.findUnique({ where: { id }, select: SELECT_SEGURO });
  return atualizada ? paraView(atualizada) : null;
}

export async function removerChave(usuarioId: string, id: string): Promise<boolean> {
  const { count } = await prisma.chaveIA.deleteMany({ where: { id, usuarioId } });
  if (count > 0) {
    await registrarEvento({ tipo: "CHAVE_IA_REMOVIDA", usuarioId, detalhe: { id } });
  }
  return count > 0;
}

/** Uma chave pronta para uso, com o segredo em claro. Nunca sai do servidor. */
export interface ChaveParaUso {
  /** null quando veio do ambiente (fallback de desenvolvimento). */
  id: string | null;
  provedor: Provedor;
  rotulo: string;
  segredo: string;
  modelo: string;
}

/**
 * Fila de tentativas do assistente, na ordem de prioridade.
 *
 * Chaves do banco primeiro; depois, as variáveis de ambiente, se houver. O
 * fallback por ambiente existe para o app funcionar antes de qualquer cadastro
 * (e em desenvolvimento) — mas quem cadastrou a própria chave sempre ganha
 * precedência sobre ele.
 *
 * Chave que não decifra é pulada em silêncio: acontece quando BERU_CRYPTO_KEY
 * foi rotacionada e o registro antigo ficou ilegível. Derrubar o chat inteiro
 * por causa disso seria pior do que seguir para a próxima.
 */
export async function chavesParaUso(usuarioId: string): Promise<ChaveParaUso[]> {
  const linhas = await prisma.chaveIA.findMany({
    where: { usuarioId, ativa: true },
    orderBy: [{ prioridade: "asc" }, { criadoEm: "asc" }],
  });

  const fila: ChaveParaUso[] = [];

  for (const linha of linhas) {
    const segredo = decifrar(linha.segredoCifrado);
    if (!segredo) continue;
    fila.push({
      id: linha.id,
      provedor: linha.provedor as Provedor,
      rotulo: linha.rotulo,
      segredo,
      modelo: linha.modelo || modeloPadraoDe(linha.provedor),
    });
  }

  const doAmbiente: Record<Provedor, string | undefined> = {
    gemini: process.env.GEMINI_API_KEY,
    groq: process.env.GROQ_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  };

  for (const p of PROVEDORES) {
    const segredo = doAmbiente[p.id]?.trim();
    if (!segredo) continue;
    fila.push({
      id: null,
      provedor: p.id,
      rotulo: `${p.nome} (ambiente)`,
      segredo,
      modelo: p.modeloPadrao,
    });
  }

  return fila;
}

/**
 * Grava o modelo que funcionou depois de uma troca automática (o configurado
 * foi aposentado pelo provedor). Sem isso, toda mensagem pagaria de novo o
 * pedágio de descobrir um substituto.
 */
export async function registrarModeloEmUso(id: string | null, modelo: string): Promise<void> {
  if (!id) return;
  try {
    await prisma.chaveIA.update({ where: { id }, data: { modelo } });
  } catch {
    // Chave apagada durante a requisição. Irrelevante para a resposta.
  }
}

/** Carimba o uso bem-sucedido e limpa o erro anterior. Não lança. */
export async function marcarSucesso(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await prisma.chaveIA.update({
      where: { id },
      data: { ultimoUsoEm: new Date(), ultimoErro: null },
    });
  } catch {
    // Chave apagada durante a requisição. Irrelevante para a resposta.
  }
}

/**
 * Registra a falha. Desativa a chave só quando o provedor recusou a
 * credencial (401/403) — cota estourada (429) e instabilidade (5xx) passam,
 * porque voltam a funcionar sozinhas e desligar a chave obrigaria o usuário a
 * reativá-la na mão todo dia.
 */
export async function marcarFalha(
  id: string | null,
  mensagem: string,
  credencialRecusada: boolean
): Promise<void> {
  if (!id) return;
  try {
    await prisma.chaveIA.update({
      where: { id },
      data: { ultimoErro: mensagem.slice(0, 200), ...(credencialRecusada ? { ativa: false } : {}) },
    });
  } catch {
    // idem
  }
}
