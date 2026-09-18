import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizar } from "@/lib/utils";
import { AREAS_PADRAO, COR_PADRAO_AREA } from "@/lib/areas";
import type { OrigemMemoria } from "@prisma/client";

/**
 * A second brain: notas (memórias) ligadas entre si formando uma rede.
 *
 * Duas coisas dependem deste módulo e puxam em direções diferentes:
 *
 *  • A **tela da rede**, que quer tudo — todos os nós e todas as arestas.
 *  • O **prompt do assistente**, que quer o essencial — o contexto tem
 *    orçamento de caracteres, e memória demais empurra a conversa para fora
 *    da janela do modelo.
 *
 * Por isso `montarContexto()` corta por importância e recência, enquanto
 * `obterGrafo()` devolve a base inteira.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Áreas
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Garante que o usuário tenha o conjunto padrão de áreas. Idempotente: roda no
 * cadastro e também na primeira leitura de quem foi criado antes deste código.
 */
export async function garantirAreas(usuarioId: string) {
  const existentes = await prisma.area.count({ where: { usuarioId } });
  if (existentes > 0) return;

  await prisma.area.createMany({
    data: AREAS_PADRAO.map((a, i) => ({
      usuarioId,
      slug: a.slug,
      rotulo: a.rotulo,
      cor: a.cor,
      ordem: i,
    })),
    skipDuplicates: true,
  });
}

export async function listarAreas(usuarioId: string) {
  await garantirAreas(usuarioId);
  return prisma.area.findMany({
    where: { usuarioId },
    orderBy: [{ ordem: "asc" }, { rotulo: "asc" }],
  });
}

/**
 * Resolve o slug que o modelo devolveu para uma área real.
 *
 * O modelo às vezes inventa uma área ("carreira" quando o slug é "trabalho")
 * ou escreve com acento. Tentamos slug exato, depois rótulo normalizado, e só
 * então criamos uma área nova — em vez de jogar a memória num balde genérico,
 * que era o comportamento do protótipo e fazia a nota sumir da área certa.
 */
async function resolverArea(usuarioId: string, slugOuRotulo?: string | null) {
  if (!slugOuRotulo) return null;
  const alvo = normalizar(slugOuRotulo).replace(/\s/g, "-");
  if (!alvo) return null;

  const areas = await listarAreas(usuarioId);

  const porSlug = areas.find((a) => a.slug === alvo);
  if (porSlug) return porSlug;

  const porRotulo = areas.find((a) => normalizar(a.rotulo).replace(/\s/g, "-") === alvo);
  if (porRotulo) return porRotulo;

  return prisma.area.create({
    data: {
      usuarioId,
      slug: alvo.slice(0, 40),
      rotulo: slugOuRotulo.trim().slice(0, 40),
      cor: COR_PADRAO_AREA,
      ordem: areas.length,
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Memórias
   ══════════════════════════════════════════════════════════════════════════ */

export interface DadosMemoria {
  titulo: string;
  corpo: string;
  area?: string | null;
  tags?: string[];
  importancia?: number;
  fixada?: boolean;
  origem?: OrigemMemoria;
  origemConversaId?: string | null;
}

/**
 * Cria ou atualiza pelo título normalizado.
 *
 * A deduplicação por `chave` é o que impede a base de encher de "Gestão
 * Financeira", "gestao financeira" e "Gestão financeira." como três nós
 * separados — o modelo escreve o título de um jeito levemente diferente a cada
 * conversa, e sem isso o grafo vira um cemitério de duplicatas.
 */
export async function salvarMemoria(usuarioId: string, dados: DadosMemoria) {
  const titulo = dados.titulo.trim().slice(0, 80);
  const chave = normalizar(titulo);
  const area = await resolverArea(usuarioId, dados.area);

  const existente = await prisma.memoria.findUnique({
    where: { usuarioId_chave: { usuarioId, chave } },
  });

  if (existente) {
    return prisma.memoria.update({
      where: { id: existente.id },
      data: {
        titulo,
        corpo: dados.corpo.trim(),
        ...(area ? { areaId: area.id } : {}),
        ...(dados.tags ? { tags: dados.tags } : {}),
        ...(dados.importancia ? { importancia: dados.importancia } : {}),
        ...(dados.fixada !== undefined ? { fixada: dados.fixada } : {}),
      },
      include: { area: true },
    });
  }

  const criada = await prisma.memoria.create({
    data: {
      usuarioId,
      areaId: area?.id ?? null,
      titulo,
      chave,
      corpo: dados.corpo.trim(),
      tags: dados.tags ?? [],
      importancia: dados.importancia ?? 3,
      fixada: dados.fixada ?? false,
      origem: dados.origem ?? "MANUAL",
      origemConversaId: dados.origemConversaId ?? null,
    },
    include: { area: true },
  });

  // Um nó solto não é rede. Ligamos a nota nova à vizinha mais próxima — a mais
  // recente da mesma área; sem nenhuma, a memória fixada ou mais importante.
  await conectarAutomaticamente(usuarioId, criada.id, criada.areaId);

  return criada;
}

async function conectarAutomaticamente(usuarioId: string, memoriaId: string, areaId: string | null) {
  const vizinha =
    (areaId
      ? await prisma.memoria.findFirst({
          where: { usuarioId, areaId, id: { not: memoriaId } },
          orderBy: { atualizadoEm: "desc" },
          select: { id: true },
        })
      : null) ??
    (await prisma.memoria.findFirst({
      where: { usuarioId, id: { not: memoriaId } },
      orderBy: [{ fixada: "desc" }, { importancia: "desc" }, { criadoEm: "asc" }],
      select: { id: true },
    }));

  if (!vizinha) return;
  await conectar(usuarioId, vizinha.id, memoriaId, { criadaPeloAssistente: true });
}

export async function listarMemorias(
  usuarioId: string,
  filtro?: { busca?: string; areaSlug?: string }
) {
  return prisma.memoria.findMany({
    where: {
      usuarioId,
      ...(filtro?.areaSlug ? { area: { slug: filtro.areaSlug } } : {}),
      ...(filtro?.busca
        ? {
            OR: [
              { titulo: { contains: filtro.busca, mode: "insensitive" } },
              { corpo: { contains: filtro.busca, mode: "insensitive" } },
              { tags: { has: filtro.busca.toLowerCase() } },
            ],
          }
        : {}),
    },
    include: { area: true },
    orderBy: [{ fixada: "desc" }, { atualizadoEm: "desc" }],
  });
}

export async function removerMemoria(usuarioId: string, id: string): Promise<boolean> {
  // As conexões saem junto por onDelete: Cascade no schema.
  const { count } = await prisma.memoria.deleteMany({ where: { id, usuarioId } });
  return count > 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   Conexões
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Liga duas memórias. A aresta é tratada como não direcionada na tela, então
 * checamos os dois sentidos antes de gravar — senão A→B e B→A virariam duas
 * linhas sobrepostas no grafo.
 */
export async function conectar(
  usuarioId: string,
  origemId: string,
  destinoId: string,
  opcoes?: { tipo?: string | null; peso?: number; criadaPeloAssistente?: boolean }
) {
  if (origemId === destinoId) return null;

  // Os dois nós têm de ser do usuário — impede ligar a memória de outra pessoa
  // passando um id adivinhado.
  const quantas = await prisma.memoria.count({
    where: { usuarioId, id: { in: [origemId, destinoId] } },
  });
  if (quantas !== 2) return null;

  const jaExiste = await prisma.conexao.findFirst({
    where: {
      OR: [
        { origemId, destinoId },
        { origemId: destinoId, destinoId: origemId },
      ],
    },
  });
  if (jaExiste) return jaExiste;

  return prisma.conexao.create({
    data: {
      usuarioId,
      origemId,
      destinoId,
      tipo: opcoes?.tipo ?? null,
      peso: opcoes?.peso ?? 1,
      criadaPeloAssistente: opcoes?.criadaPeloAssistente ?? false,
    },
  });
}

export async function desconectar(usuarioId: string, origemId: string, destinoId: string) {
  const { count } = await prisma.conexao.deleteMany({
    where: {
      usuarioId,
      OR: [
        { origemId, destinoId },
        { origemId: destinoId, destinoId: origemId },
      ],
    },
  });
  return count > 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   Grafo
   ══════════════════════════════════════════════════════════════════════════ */

export interface NoGrafo {
  id: string;
  titulo: string;
  corpo: string;
  area: string | null;
  areaRotulo: string | null;
  cor: string;
  importancia: number;
  fixada: boolean;
  tags: string[];
  grau: number;
  atualizadoEm: string;
}

export interface ArestaGrafo {
  origem: string;
  destino: string;
  peso: number;
  tipo: string | null;
}

export interface Grafo {
  nos: NoGrafo[];
  arestas: ArestaGrafo[];
  areas: { slug: string; rotulo: string; cor: string; total: number }[];
}

/** A rede inteira, no formato que o canvas consome. Uma ida ao banco por tabela. */
export async function obterGrafo(usuarioId: string): Promise<Grafo> {
  await garantirAreas(usuarioId);

  const [memorias, conexoes, areas] = await Promise.all([
    prisma.memoria.findMany({ where: { usuarioId }, include: { area: true } }),
    prisma.conexao.findMany({ where: { usuarioId } }),
    prisma.area.findMany({ where: { usuarioId }, orderBy: { ordem: "asc" } }),
  ]);

  // Grau de cada nó calculado aqui, uma vez — o renderer usa para o raio, e
  // recontar dentro do loop de desenho custaria O(n²) a cada frame.
  const grau = new Map<string, number>();
  for (const c of conexoes) {
    grau.set(c.origemId, (grau.get(c.origemId) ?? 0) + 1);
    grau.set(c.destinoId, (grau.get(c.destinoId) ?? 0) + 1);
  }

  const nos: NoGrafo[] = memorias.map((m) => ({
    id: m.id,
    titulo: m.titulo,
    corpo: m.corpo,
    area: m.area?.slug ?? null,
    areaRotulo: m.area?.rotulo ?? null,
    cor: m.area?.cor ?? COR_PADRAO_AREA,
    importancia: m.importancia,
    fixada: m.fixada,
    tags: m.tags,
    grau: grau.get(m.id) ?? 0,
    atualizadoEm: m.atualizadoEm.toISOString(),
  }));

  return {
    nos,
    arestas: conexoes.map((c) => ({
      origem: c.origemId,
      destino: c.destinoId,
      peso: c.peso,
      tipo: c.tipo,
    })),
    areas: areas.map((a) => ({
      slug: a.slug,
      rotulo: a.rotulo,
      cor: a.cor,
      total: memorias.filter((m) => m.areaId === a.id).length,
    })),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Contexto para o prompt
   ══════════════════════════════════════════════════════════════════════════ */

const ORCAMENTO_CONTEXTO = 6000; // caracteres

/**
 * Monta o bloco de contexto injetado em toda conversa.
 *
 * Ordem: fixadas primeiro, depois importância, depois recência. O corte por
 * orçamento acontece no fim — quando a base passa de algumas centenas de notas,
 * mandar tudo empurraria a conversa para fora da janela do modelo, e o Beru
 * começaria a "esquecer" o que foi dito há duas mensagens.
 */
export async function montarContexto(
  usuarioId: string
): Promise<{ texto: string; ids: string[] }> {
  const memorias = await prisma.memoria.findMany({
    where: { usuarioId },
    include: { area: true },
    orderBy: [{ fixada: "desc" }, { importancia: "desc" }, { atualizadoEm: "desc" }],
    take: 200,
  });

  if (memorias.length === 0) {
    return { texto: "A second brain está vazia — ainda não há nada gravado sobre o usuário.", ids: [] };
  }

  const grupos = new Map<string, string[]>();
  const ids: string[] = [];
  let tamanho = 0;

  for (const m of memorias) {
    const linha = `- ${m.titulo}: ${m.corpo}`;
    if (tamanho + linha.length > ORCAMENTO_CONTEXTO) break;
    tamanho += linha.length;
    ids.push(m.id);

    const rotulo = m.area?.rotulo ?? "Outros";
    const lista = grupos.get(rotulo) ?? [];
    lista.push(linha);
    grupos.set(rotulo, lista);
  }

  let texto = "CONTEXTO DA VIDA DO USUÁRIO (Second Brain):\n";
  for (const [rotulo, linhas] of grupos) {
    texto += `\n[${rotulo}]\n${linhas.join("\n")}\n`;
  }

  return { texto, ids };
}
