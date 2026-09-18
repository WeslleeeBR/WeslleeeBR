import "server-only";
import { metaProvedor, type Provedor } from "@/lib/provedores";
import type { ChaveParaUso } from "@/lib/chavesIA";

/**
 * O contato com os provedores. Três operações: conversar, listar modelos e —
 * quando o modelo configurado morre — achar um substituto sozinho.
 *
 * A chave vai SEMPRE em header, nunca na query string: URL entra em log de
 * acesso do proxy e no histórico do navegador; header, não.
 *
 * Toda falha vira `ErroProvedor` com três distinções que mudam o que quem
 * chama faz a seguir:
 *
 *   credencialRecusada → a chave morreu, desativa (401/403, ou a mensagem do
 *                        Google dizendo que a API key é inválida).
 *   modeloInvalido     → a CHAVE está boa, o modelo é que sumiu (404). Troca de
 *                        modelo e tenta de novo — não encosta na chave.
 *   transitorio        → cota do minuto, instabilidade, timeout (429/5xx). Vale
 *                        insistir daqui a pouco; a chave continua ativa.
 *
 * Essa separação não é preciosismo: sem ela, o Gemini devolvendo 400 por um
 * campo de payload desativaria uma chave perfeitamente boa, e o assistente
 * ficaria mudo até alguém reativar na mão.
 */

const TIMEOUT_MS = 30_000;
const TIMEOUT_MODELOS_MS = 10_000;

export class ErroProvedor extends Error {
  provedor: string;
  status: number | null;
  credencialRecusada: boolean;
  modeloInvalido: boolean;
  transitorio: boolean;

  constructor(
    provedor: string,
    mensagem: string,
    status: number | null = null,
    opcoes?: { credencialRecusada?: boolean; modeloInvalido?: boolean }
  ) {
    super(mensagem);
    this.provedor = provedor;
    this.status = status;
    this.credencialRecusada = opcoes?.credencialRecusada ?? (status === 401 || status === 403);
    this.modeloInvalido = opcoes?.modeloInvalido ?? status === 404;
    // Sem status = falha de rede ou timeout: também vale tentar de novo.
    this.transitorio = status === null || status === 429 || (status >= 500 && status < 600);
  }
}

export interface MensagemIA {
  papel: "usuario" | "assistente";
  conteudo: string;
}

export interface RespostaIA {
  texto: string;
  provedor: Provedor;
  modelo: string;
  latenciaMs: number;
}

export interface ModeloDisponivel {
  id: string;
  rotulo: string;
  contexto?: number;
  gratuito?: boolean;
}

/** fetch com timeout — sem isso uma API pendurada segura a rota até o limite da plataforma. */
async function buscarComTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controlador.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ErroProvedor("rede", `O provedor não respondeu em ${ms / 1000}s.`);
    }
    throw new ErroProvedor("rede", "Falha de rede ao chamar o provedor.");
  } finally {
    clearTimeout(timer);
  }
}

/** Mensagem curta, pronta para a tela e para o campo `ultimoErro`. */
function descreverStatus(nome: string, status: number, modelo?: string): string {
  if (status === 401 || status === 403) return `${nome} recusou esta chave.`;
  if (status === 404) return `O modelo ${modelo ?? "configurado"} não existe mais no ${nome}.`;
  if (status === 429) return `${nome} está com a cota esgotada no momento.`;
  if (status === 503) return `${nome} está sobrecarregado agora.`;
  if (status >= 500) return `${nome} está instável (${status}).`;
  return `${nome} respondeu ${status}.`;
}

/** Lê a mensagem de erro do corpo, quando o provedor manda uma. */
async function mensagemDoCorpo(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } | string };
    if (typeof json.error === "string") return json.error;
    return json.error?.message ?? "";
  } catch {
    return "";
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Dialeto OpenAI — Groq e OpenRouter
   ══════════════════════════════════════════════════════════════════════════ */

async function conversarOpenAI(
  chave: ChaveParaUso,
  system: string,
  mensagens: MensagemIA[],
  maxTokens: number
): Promise<string> {
  const meta = metaProvedor(chave.provedor)!;

  const res = await buscarComTimeout(
    `${meta.base}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${chave.segredo}`,
        "Content-Type": "application/json",
        // O OpenRouter pede identificação do app; os outros ignoram headers extras.
        "HTTP-Referer": "https://beru.local",
        "X-Title": "Beru",
      },
      body: JSON.stringify({
        model: chave.modelo,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          ...mensagens.map((m) => ({
            role: m.papel === "usuario" ? "user" : "assistant",
            content: m.conteudo,
          })),
        ],
      }),
    },
    TIMEOUT_MS
  );

  if (!res.ok) {
    const detalhe = await mensagemDoCorpo(res);
    // Groq e OpenRouter usam 404 e 400 para modelo desconhecido; a mensagem é
    // que distingue "modelo não existe" de "pedido malformado".
    const modeloSumiu =
      res.status === 404 || /model .*(not found|does not exist|decommissioned)/i.test(detalhe);
    throw new ErroProvedor(
      chave.provedor,
      modeloSumiu
        ? descreverStatus(meta.nome, 404, chave.modelo)
        : descreverStatus(meta.nome, res.status),
      res.status,
      { modeloInvalido: modeloSumiu }
    );
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

async function modelosOpenAI(base: string, nome: string, segredo: string): Promise<ModeloDisponivel[]> {
  const res = await buscarComTimeout(
    `${base}/models`,
    { headers: { Authorization: `Bearer ${segredo}` } },
    TIMEOUT_MODELOS_MS
  );

  if (!res.ok) throw new ErroProvedor(nome, descreverStatus(nome, res.status), res.status);

  const json = (await res.json()) as {
    data?: { id: string; name?: string; context_length?: number; context_window?: number }[];
  };

  return (json.data ?? [])
    // Áudio, TTS e moderação não respondem pergunta — na lista só atrapalham.
    .filter((m) => !/whisper|tts|guard|moderation|embed/i.test(m.id))
    .map((m) => ({
      id: m.id,
      rotulo: m.name ?? m.id,
      contexto: m.context_window ?? m.context_length,
      gratuito: m.id.endsWith(":free"),
    }))
    .sort((a, b) => Number(b.gratuito) - Number(a.gratuito) || a.id.localeCompare(b.id));
}

/* ══════════════════════════════════════════════════════════════════════════
   Gemini — formato próprio
   ══════════════════════════════════════════════════════════════════════════ */

async function conversarGemini(
  chave: ChaveParaUso,
  system: string,
  mensagens: MensagemIA[],
  maxTokens: number
): Promise<string> {
  const meta = metaProvedor("gemini")!;

  // Os modelos que "pensam" antes de responder gastam do mesmo orçamento de
  // tokens. Sem desligar, uma resposta curta chega vazia: o modelo estoura o
  // limite pensando e devolve finishReason MAX_TOKENS sem texto nenhum.
  // `thinkingBudget: 0` não existe nos modelos antigos (2.0), que respondem 400
  // se o campo vier — daí a checagem pelo nome.
  const pensante = /gemini-(2\.5|3|flash-latest|pro-latest|flash-lite-latest)/.test(chave.modelo);

  const res = await buscarComTimeout(
    `${meta.base}/models/${encodeURIComponent(chave.modelo)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": chave.segredo, "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: mensagens.map((m) => ({
          role: m.papel === "usuario" ? "user" : "model",
          parts: [{ text: m.conteudo }],
        })),
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(pensante ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    },
    TIMEOUT_MS
  );

  if (!res.ok) {
    const detalhe = await mensagemDoCorpo(res);

    // O Google responde 400 tanto para chave inválida quanto para payload
    // malformado. Só a mensagem distingue — e tratar os dois como "chave
    // recusada" desativaria uma chave boa por um erro nosso.
    const chaveInvalida = /api[_ ]key[_ ]?(not valid|invalid)|API_KEY_INVALID/i.test(detalhe);
    // 404 aqui quase sempre é modelo aposentado ("no longer available").
    const modeloSumiu = res.status === 404;

    throw new ErroProvedor(
      "gemini",
      chaveInvalida
        ? `${meta.nome} recusou esta chave.`
        : modeloSumiu
          ? descreverStatus(meta.nome, 404, chave.modelo)
          : descreverStatus(meta.nome, res.status),
      res.status,
      { credencialRecusada: chaveInvalida, modeloInvalido: modeloSumiu }
    );
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };

  // Bloqueio por filtro de conteúdo vem como 200 com a resposta vazia. Sem esta
  // checagem viraria "resposta vazia" e o rodízio tentaria as outras chaves à
  // toa — o texto seria bloqueado em todas.
  if (json.promptFeedback?.blockReason || json.candidates?.[0]?.finishReason === "SAFETY") {
    throw new ErroProvedor("gemini", "O Google bloqueou esta mensagem pelo filtro de conteúdo.");
  }

  return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
}

async function modelosGemini(segredo: string): Promise<ModeloDisponivel[]> {
  const meta = metaProvedor("gemini")!;
  const res = await buscarComTimeout(
    `${meta.base}/models`,
    { headers: { "x-goog-api-key": segredo } },
    TIMEOUT_MODELOS_MS
  );

  if (!res.ok) {
    const detalhe = await mensagemDoCorpo(res);
    const chaveInvalida =
      res.status === 401 ||
      res.status === 403 ||
      /api[_ ]key[_ ]?(not valid|invalid)|API_KEY_INVALID/i.test(detalhe);
    throw new ErroProvedor(
      "gemini",
      chaveInvalida ? `${meta.nome} recusou esta chave.` : descreverStatus(meta.nome, res.status),
      res.status,
      { credencialRecusada: chaveInvalida }
    );
  }

  const json = (await res.json()) as {
    models?: {
      name: string;
      displayName?: string;
      inputTokenLimit?: number;
      supportedGenerationMethods?: string[];
    }[];
  };

  return (json.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({
      // A API devolve "models/gemini-flash-latest"; guardamos só o id.
      id: m.name.replace(/^models\//, ""),
      rotulo: m.displayName || m.name.replace(/^models\//, ""),
      contexto: m.inputTokenLimit,
      gratuito: true,
    }))
    // Embedding, imagem, áudio e os especializados escapam do filtro acima em
    // algumas contas — nenhum deles serve para conversar.
    .filter(
      (m) =>
        !/embedding|aqa|imagen|veo|tts|vision|live|native-audio|image|lyria|robotics|transcribe|computer-use|deep-research|nano-banana|omni|antigravity/i.test(
          m.id
        )
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/* ══════════════════════════════════════════════════════════════════════════
   API pública do módulo
   ══════════════════════════════════════════════════════════════════════════ */

/** Uma chamada a um provedor. Lança `ErroProvedor`; o rodízio fica em ia.ts. */
export async function conversar(
  chave: ChaveParaUso,
  opcoes: { system: string; mensagens: MensagemIA[]; maxTokens?: number }
): Promise<RespostaIA> {
  const meta = metaProvedor(chave.provedor);
  if (!meta) throw new ErroProvedor(chave.provedor, "Provedor desconhecido.");

  const inicio = Date.now();
  const maxTokens = opcoes.maxTokens ?? 800;

  const texto =
    meta.estilo === "gemini"
      ? await conversarGemini(chave, opcoes.system, opcoes.mensagens, maxTokens)
      : await conversarOpenAI(chave, opcoes.system, opcoes.mensagens, maxTokens);

  if (!texto) {
    throw new ErroProvedor(chave.provedor, `${meta.nome} devolveu uma resposta vazia.`);
  }

  return { texto, provedor: chave.provedor, modelo: chave.modelo, latenciaMs: Date.now() - inicio };
}

/**
 * Ordena os modelos por "serventia para conversar".
 *
 * Aliases (`-latest`) primeiro de propósito: são os únicos nomes que não
 * apodrecem quando o Google aposenta uma geração — foi exatamente assim que o
 * `gemini-2.5-flash` parou de responder de um dia para o outro. Depois vêm os
 * `flash` (rápidos e baratos), e os `preview` ficam por último por serem os
 * mais instáveis.
 */
function ordenarCandidatos(modelos: ModeloDisponivel[]): ModeloDisponivel[] {
  const nota = (id: string) =>
    (/-latest$/.test(id) ? -4 : 0) +
    (/flash/i.test(id) ? -2 : 0) +
    (/lite/i.test(id) ? 1 : 0) +
    (/preview|exp/i.test(id) ? 3 : 0);
  return [...modelos].sort((a, b) => nota(a.id) - nota(b.id) || a.id.localeCompare(b.id));
}

/**
 * Conversa e, quando o problema é o MODELO e não a chave, acha um substituto
 * sozinho com a mesma chave.
 *
 * Dois casos entram aqui, e os dois deixariam o assistente mudo à toa:
 *
 *  • **404** — o modelo foi aposentado ("no longer available"). Definitivo: o
 *    substituto que funcionar é gravado na chave, senão toda mensagem pagaria
 *    de novo o pedágio da descoberta.
 *  • **503** — aquele modelo está com alta demanda. No Gemini a sobrecarga é
 *    por modelo, então um irmão atende na hora; mas é passageiro, então NÃO
 *    gravamos a troca: na próxima mensagem ele volta ao modelo preferido.
 */
export async function conversarComAutoCura(
  chave: ChaveParaUso,
  opcoes: { system: string; mensagens: MensagemIA[]; maxTokens?: number },
  aoTrocarModelo?: (modelo: string) => Promise<void>
): Promise<RespostaIA> {
  try {
    return await conversar(chave, opcoes);
  } catch (err) {
    if (!(err instanceof ErroProvedor)) throw err;

    const sobrecarregado = err.status === 503;
    if (!err.modeloInvalido && !sobrecarregado) throw err;

    const disponiveis = await listarModelos(chave.provedor, chave.segredo);
    const candidatos = ordenarCandidatos(disponiveis)
      .filter((m) => m.id !== chave.modelo)
      .slice(0, 3);

    for (const candidato of candidatos) {
      try {
        const resposta = await conversar({ ...chave, modelo: candidato.id }, opcoes);
        // Modelo aposentado é para sempre; sobrecarga passa. Só o primeiro caso
        // vira mudança permanente na chave.
        if (err.modeloInvalido) await aoTrocarModelo?.(candidato.id);
        return resposta;
      } catch (erroCandidato) {
        // Outro modelo morto ou também lotado: segue para o próximo. Qualquer
        // outra falha (cota, chave, rede) é do provedor, não da escolha.
        if (
          erroCandidato instanceof ErroProvedor &&
          (erroCandidato.modeloInvalido || erroCandidato.status === 503)
        ) {
          continue;
        }
        throw erroCandidato;
      }
    }

    throw err;
  }
}

/**
 * Lista os modelos que AQUELA chave alcança. A chamada também serve de
 * validação: chave errada ou revogada falha aqui, ANTES de ser gravada — e o
 * usuário não fica digitando nome de modelo de cabeça, que é por onde o erro
 * costuma entrar.
 */
export async function listarModelos(
  provedor: Provedor,
  segredo: string
): Promise<ModeloDisponivel[]> {
  const meta = metaProvedor(provedor);
  if (!meta) throw new ErroProvedor(provedor, "Provedor desconhecido.");

  return meta.estilo === "gemini"
    ? modelosGemini(segredo)
    : modelosOpenAI(meta.base, meta.nome, segredo);
}
