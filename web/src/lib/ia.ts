import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizar } from "@/lib/utils";
import {
  chavesParaUso,
  marcarFalha,
  marcarSucesso,
  registrarModeloEmUso,
} from "@/lib/chavesIA";
import { conversarComAutoCura, ErroProvedor, type MensagemIA } from "@/lib/clientesIA";
import { conectar, listarAreas, montarContexto, salvarMemoria } from "@/lib/memoria";
import { registrarEvento } from "@/lib/log";
import type { UsuarioSemSenha } from "@/lib/session";

/**
 * O orquestrador do Beru: monta o prompt, roda o rodízio de chaves e traduz o
 * que o modelo devolve em mudanças na second brain.
 *
 * O ponto não óbvio é o **protocolo de memória**. Em vez de function calling
 * (que cada provedor implementa de um jeito, e os modelos gratuitos suportam
 * mal), o modelo escreve marcações no fim da resposta:
 *
 *     [[SAVE:financas|Reserva de emergência|Guardar 6 meses de custo fixo.]]
 *     [[LINK:Reserva de emergência|Gestão Financeira]]
 *
 * Nós extraímos, aplicamos e removemos do texto antes de mostrar. Funciona
 * igual nos três provedores e degrada bem: se o modelo errar o formato, a pior
 * consequência é uma memória não gravada — nunca uma resposta quebrada.
 */

const MAX_HISTORICO = 12; // últimas mensagens enviadas ao modelo

/* ══════════════════════════════════════════════════════════════════════════
   Prompt
   ══════════════════════════════════════════════════════════════════════════ */

interface Persona {
  nome?: string;
  estilo?: string;
  voz?: string;
}

const ESTILOS: Record<string, string> = {
  formal_descontraido:
    "personalidade formal porém descontraída — educado e atencioso como um mordomo britânico moderno, mas leve, sem ser engessado",
  formal: "personalidade formal e precisa, como um secretário particular experiente",
  direto: "personalidade direta e objetiva: vai ao ponto, sem rodeios nem floreio",
  amigavel: "personalidade próxima e calorosa, como um amigo que conhece bem a rotina do usuário",
};

export async function montarPromptSistema(
  usuario: UsuarioSemSenha,
  opcoes?: { paraVoz?: boolean }
): Promise<{ system: string; idsMemorias: string[] }> {
  const persona = (usuario.persona ?? {}) as Persona;
  const nome = persona.nome?.trim() || "Beru";
  const estilo = ESTILOS[persona.estilo ?? "formal_descontraido"] ?? ESTILOS.formal_descontraido;

  const tratamentos = usuario.tratamentos.length ? usuario.tratamentos : [usuario.nome];
  const comoTratar =
    tratamentos.length > 1
      ? `Trate o usuário como "${tratamentos[0]}" ou "${tratamentos[1]}", alternando naturalmente.`
      : `Trate o usuário como "${tratamentos[0]}".`;

  const identidade = `Você é ${nome}, o assistente pessoal de ${usuario.nome}, com ${estilo}. ${comoTratar}`;

  // Markdown é proibido nos dois modos, por motivos diferentes: falado, vira
  // ruído literal no sintetizador ("asterisco asterisco"); escrito, aparece
  // como asterisco na tela, porque o painel de conversa mostra texto puro.
  const formato = opcoes?.paraVoz
    ? "Responda SEMPRE em português do Brasil. Sua resposta será falada em voz alta: use de 2 a 4 frases e NUNCA use markdown, listas, asteriscos ou emojis — apenas texto corrido."
    : "Responda SEMPRE em português do Brasil, de forma concisa (no máximo um parágrafo curto, salvo se pedirem detalhe). NUNCA use markdown, asteriscos, cabeçalhos ou emojis — apenas texto corrido. Nada de encher linguiça.";

  const { texto: contexto, ids } = await montarContexto(usuario.id);

  const areas = await listarAreas(usuario.id);
  const slugs = areas.map((a) => a.slug).join(", ");

  const protocolo = [
    "PROTOCOLO DE MEMÓRIA VIVA (sincronia com a Second Brain):",
    `Quando o usuário revelar algo novo e duradouro sobre a vida dele, OU pedir para você anotar, atualizar ou corrigir algo, acrescente no FIM da resposta uma linha no formato EXATO [[SAVE:area|titulo|texto]], onde area é uma destas: ${slugs}.`,
    "Se o título corresponder (mesmo com diferenças de escrita) a uma nota já listada no contexto acima, use EXATAMENTE o título existente, para atualizar em vez de duplicar.",
    "Para ligar duas memórias que se relacionam, acrescente [[LINK:titulo A|titulo B]] usando títulos que existam.",
    "Use essas marcações SOMENTE quando houver algo realmente novo — não repita a cada resposta. Elas são removidas antes de o usuário ver: nunca comente sobre elas nem as mencione no texto.",
  ].join(" ");

  return {
    system: `${identidade}\n\n${formato}\n\n${contexto}\n\n${protocolo}`,
    idsMemorias: ids,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Rodízio de chaves
   ══════════════════════════════════════════════════════════════════════════ */

export class SemChaveError extends Error {
  constructor() {
    super("Nenhuma chave de IA configurada. Cadastre uma em Configurações → Chaves de IA.");
  }
}

export class TodasFalharamError extends Error {
  tentativas: { provedor: string; erro: string }[];
  constructor(tentativas: { provedor: string; erro: string }[]) {
    super(
      tentativas.length
        ? `Nenhum provedor respondeu. ${tentativas.map((t) => t.erro).join(" ")}`
        : "Nenhum provedor respondeu."
    );
    this.tentativas = tentativas;
  }
}

/** Espera curta entre as passadas do rodízio. */
const ESPERA_SEGUNDA_PASSADA_MS = 1500;

/**
 * Tenta cada chave na ordem de prioridade até uma responder.
 *
 * É isto que justifica ter mais de uma chave: a cota gratuita do Gemini e o
 * limite por minuto da Groq estouram em horários diferentes, e o rodízio faz o
 * assistente continuar de pé sem o usuário perceber.
 *
 * Duas passadas, não uma. A primeira tenta todas; se as falhas foram
 * **transitórias** (cota do minuto, 503 de alta demanda, timeout), espera um
 * instante e tenta de novo só essas. Com uma chave só cadastrada, "cair para a
 * próxima" não existe — a segunda passada é o que segura o "não quero ficar
 * sem". Chave com credencial recusada fica de fora: insistir não muda nada.
 *
 * O erro só sobe quando tudo falhou nas duas passadas, e aí a mensagem diz o
 * que cada provedor respondeu.
 */
export async function chamarComRodizio(
  usuarioId: string,
  system: string,
  mensagens: MensagemIA[],
  maxTokens?: number
) {
  const fila = await chavesParaUso(usuarioId);
  if (fila.length === 0) throw new SemChaveError();

  const tentativas: { provedor: string; erro: string }[] = [];
  let aTentarDeNovo = fila;

  for (let passada = 1; passada <= 2; passada++) {
    const transitorias: typeof fila = [];

    for (const chave of aTentarDeNovo) {
      try {
        const resposta = await conversarComAutoCura(
          chave,
          { system, mensagens, maxTokens },
          // O modelo configurado morreu e outro funcionou: grava na chave para
          // a próxima mensagem já nascer com o nome certo.
          async (modelo) => {
            await registrarModeloEmUso(chave.id, modelo);
            await registrarEvento({
              tipo: "IA_MODELO_TROCADO",
              usuarioId,
              detalhe: { provedor: chave.provedor, de: chave.modelo, para: modelo },
            });
          }
        );
        await marcarSucesso(chave.id);
        return resposta;
      } catch (err) {
        const mensagem = err instanceof Error ? err.message : String(err);
        const provedorErro = err instanceof ErroProvedor ? err : null;
        await marcarFalha(chave.id, mensagem, provedorErro?.credencialRecusada ?? false);
        tentativas.push({ provedor: chave.provedor, erro: mensagem });
        if (provedorErro?.transitorio) transitorias.push(chave);
      }
    }

    if (transitorias.length === 0) break;
    aTentarDeNovo = transitorias;
    if (passada === 1) await new Promise((r) => setTimeout(r, ESPERA_SEGUNDA_PASSADA_MS));
  }

  await registrarEvento({ tipo: "IA_TODAS_FALHARAM", usuarioId, detalhe: { tentativas } });
  throw new TodasFalharamError(tentativas);
}

/* ══════════════════════════════════════════════════════════════════════════
   Protocolo de memória
   ══════════════════════════════════════════════════════════════════════════ */

const RE_SAVE = /\[\[SAVE:([^|\]]+)\|([^|\]]+)\|([\s\S]+?)\]\]/g;
const RE_LINK = /\[\[LINK:([^|\]]+)\|([^|\]]+)\]\]/g;

export interface AcaoMemoria {
  tipo: "salvou" | "ligou";
  titulo: string;
  area?: string | null;
  memoriaId?: string;
}

/**
 * Extrai as marcações, aplica no banco e devolve o texto limpo.
 *
 * Nunca deixa uma falha de gravação derrubar a resposta: se o SAVE vier
 * malformado ou o banco recusar, a marcação some do texto e a conversa segue.
 * Falhar aqui é perder uma anotação; falhar na resposta é perder a conversa.
 */
export async function aplicarProtocolo(
  usuarioId: string,
  texto: string,
  conversaId?: string
): Promise<{ limpo: string; acoes: AcaoMemoria[] }> {
  const acoes: AcaoMemoria[] = [];

  for (const m of texto.matchAll(RE_SAVE)) {
    const area = m[1]!.trim();
    const titulo = m[2]!.trim();
    const corpo = m[3]!.trim();
    if (!titulo || !corpo) continue;

    try {
      const salva = await salvarMemoria(usuarioId, {
        titulo,
        corpo,
        area,
        origem: "ASSISTENTE",
        origemConversaId: conversaId ?? null,
      });
      acoes.push({ tipo: "salvou", titulo: salva.titulo, area, memoriaId: salva.id });
    } catch (err) {
      console.error("[beru] falha ao aplicar SAVE:", err);
    }
  }

  for (const m of texto.matchAll(RE_LINK)) {
    const a = normalizar(m[1]!);
    const b = normalizar(m[2]!);
    if (!a || !b || a === b) continue;

    try {
      const [origem, destino] = await Promise.all([
        prisma.memoria.findUnique({ where: { usuarioId_chave: { usuarioId, chave: a } } }),
        prisma.memoria.findUnique({ where: { usuarioId_chave: { usuarioId, chave: b } } }),
      ]);
      // Só liga o que existe — o modelo às vezes cita um título que ele mesmo
      // inventou na frase anterior.
      if (!origem || !destino) continue;

      await conectar(usuarioId, origem.id, destino.id, { criadaPeloAssistente: true });
      acoes.push({ tipo: "ligou", titulo: `${origem.titulo} ↔ ${destino.titulo}` });
    } catch (err) {
      console.error("[beru] falha ao aplicar LINK:", err);
    }
  }

  const limpo = texto.replace(RE_SAVE, "").replace(RE_LINK, "").trim();
  return { limpo, acoes };
}

/* ══════════════════════════════════════════════════════════════════════════
   Conversa
   ══════════════════════════════════════════════════════════════════════════ */

export interface RespostaBeru {
  conversaId: string;
  texto: string;
  provedor: string;
  modelo: string;
  latenciaMs: number;
  acoes: AcaoMemoria[];
}

export async function responder(
  usuario: UsuarioSemSenha,
  entrada: { mensagem: string; conversaId?: string; paraVoz?: boolean }
): Promise<RespostaBeru> {
  const conversa = entrada.conversaId
    ? await prisma.conversa.findFirst({ where: { id: entrada.conversaId, usuarioId: usuario.id } })
    : null;

  const anteriores = conversa
    ? await prisma.mensagem.findMany({
        where: { conversaId: conversa.id, papel: { in: ["USUARIO", "ASSISTENTE"] } },
        orderBy: { criadoEm: "desc" },
        take: MAX_HISTORICO,
      })
    : [];

  const historico: MensagemIA[] = anteriores.reverse().map((m) => ({
    papel: m.papel === "USUARIO" ? ("usuario" as const) : ("assistente" as const),
    conteudo: m.conteudo,
  }));

  const { system, idsMemorias } = await montarPromptSistema(usuario, { paraVoz: entrada.paraVoz });

  // O modelo é chamado ANTES de criar a conversa: se todos os provedores
  // falharem, o erro sobe sem deixar uma conversa vazia na lista do usuário.
  const resposta = await chamarComRodizio(usuario.id, system, [
    ...historico,
    { papel: "usuario", conteudo: entrada.mensagem },
  ]);

  const conversaAtiva =
    conversa ??
    (await prisma.conversa.create({
      data: {
        usuarioId: usuario.id,
        // Título provisório: as primeiras palavras da pergunta. Basta para
        // reconhecer a conversa na lista, e não custa uma chamada extra ao modelo.
        titulo: entrada.mensagem.slice(0, 48),
      },
    }));

  const { limpo, acoes } = await aplicarProtocolo(usuario.id, resposta.texto, conversaAtiva.id);

  // Grava as duas pontas depois da chamada: se o provedor falhar, a conversa
  // não fica com uma pergunta sem resposta pendurada no histórico.
  await prisma.mensagem.createMany({
    data: [
      { conversaId: conversaAtiva.id, papel: "USUARIO", conteudo: entrada.mensagem },
      {
        conversaId: conversaAtiva.id,
        papel: "ASSISTENTE",
        conteudo: limpo,
        provedor: resposta.provedor,
        modelo: resposta.modelo,
        latenciaMs: resposta.latenciaMs,
        memoriasUsadas: idsMemorias,
      },
    ],
  });
  await prisma.conversa.update({
    where: { id: conversaAtiva.id },
    data: { atualizadoEm: new Date() },
  });

  return {
    conversaId: conversaAtiva.id,
    texto: limpo,
    provedor: resposta.provedor,
    modelo: resposta.modelo,
    latenciaMs: resposta.latenciaMs,
    acoes,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Distribuição de texto solto
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * O usuário cola um desabafo ("comecei inglês e fechei um projeto novo") e o
 * modelo fatia aquilo em memórias, cada uma na sua área. Uma chamada só, sem
 * histórico e sem persona: aqui ele é um classificador, não o assistente.
 */
export async function distribuirTexto(
  usuario: UsuarioSemSenha,
  texto: string
): Promise<AcaoMemoria[]> {
  const areas = await listarAreas(usuario.id);
  const slugs = areas.map((a) => `${a.slug} (${a.rotulo})`).join(", ");
  const { texto: contexto } = await montarContexto(usuario.id);

  const system = [
    "Você organiza a second brain de um usuário. Receba um texto solto e transforme-o em memórias curtas e objetivas.",
    `Áreas disponíveis: ${slugs}.`,
    "Responda APENAS com marcações, uma por linha, sem nenhum outro texto:",
    "[[SAVE:area|titulo curto|texto da memória em uma ou duas frases]]",
    "Se o assunto já existir no contexto abaixo, reutilize EXATAMENTE o título existente para atualizá-lo.",
    "Use [[LINK:titulo A|titulo B]] para ligar memórias relacionadas.",
    "",
    contexto,
  ].join("\n");

  const resposta = await chamarComRodizio(
    usuario.id,
    system,
    [{ papel: "usuario", conteudo: texto }],
    1000
  );

  const { acoes } = await aplicarProtocolo(usuario.id, resposta.texto);
  return acoes;
}
