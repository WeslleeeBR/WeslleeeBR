/**
 * Catálogo dos cérebros que o Beru pode usar.
 *
 * Sem "server-only": a tela de Configurações também lê daqui (nome, prefixo da
 * chave, link para pegar a chave). Nenhum segredo mora neste arquivo.
 *
 * Dois dos três falam o dialeto da OpenAI (`/chat/completions`), então
 * compartilham o mesmo cliente; o Gemini tem formato próprio. `estilo` é o que
 * diz ao cliente qual caminho seguir — adicionar um provedor OpenAI-compatible
 * novo (Cerebras, Together, Mistral) é só acrescentar uma linha aqui.
 */

export type Provedor = "gemini" | "groq" | "openrouter";

export interface MetaProvedor {
  id: Provedor;
  nome: string;
  /** Como a chave desse provedor começa — usado para adivinhar o provedor. */
  prefixo: string;
  modeloPadrao: string;
  estilo: "openai" | "gemini";
  /** Base da API. O caminho completo é montado no cliente. */
  base: string;
  /** Onde o usuário pega a chave — a tela mostra o link. */
  urlChave: string;
  gratuito: string;
}

export const PROVEDORES: MetaProvedor[] = [
  {
    id: "gemini",
    nome: "Google Gemini",
    prefixo: "AIza",
    // Alias, não versão fixa, de propósito: o Google aposenta gerações inteiras
    // ("no longer available to new users") e um nome versionado aqui vira 404
    // de um dia para o outro. O `-latest` sempre aponta para o flash atual — e
    // se até ele sumir, conversarComAutoCura() acha outro sozinho.
    modeloPadrao: "gemini-flash-latest",
    estilo: "gemini",
    base: "https://generativelanguage.googleapis.com/v1beta",
    urlChave: "https://aistudio.google.com/apikey",
    gratuito: "Cota gratuita generosa no AI Studio.",
  },
  {
    id: "groq",
    nome: "Groq",
    prefixo: "gsk_",
    modeloPadrao: "llama-3.3-70b-versatile",
    estilo: "openai",
    base: "https://api.groq.com/openai/v1",
    urlChave: "https://console.groq.com/keys",
    gratuito: "Gratuito com limite por minuto. O mais rápido dos três.",
  },
  {
    id: "openrouter",
    nome: "OpenRouter",
    prefixo: "sk-or-",
    // Modelos com sufixo ":free" não consomem crédito. É o provedor de reserva
    // quando as cotas do Gemini e da Groq estouram no mesmo dia.
    modeloPadrao: "meta-llama/llama-3.3-70b-instruct:free",
    estilo: "openai",
    base: "https://openrouter.ai/api/v1",
    urlChave: "https://openrouter.ai/keys",
    gratuito: "Dezenas de modelos com sufixo :free, sem cartão.",
  },
];

export function metaProvedor(id: string): MetaProvedor | undefined {
  return PROVEDORES.find((p) => p.id === id);
}

export function modeloPadraoDe(provedor: string): string {
  return metaProvedor(provedor)?.modeloPadrao ?? "";
}

export function nomeProvedor(provedor: string): string {
  return metaProvedor(provedor)?.nome ?? provedor;
}

/**
 * Adivinha o provedor pelo formato da chave. Só um palpite — a tela deixa
 * corrigir. Evita o erro clássico de colar a chave da Groq no campo do Gemini
 * e só descobrir quando nenhuma resposta chega.
 */
export function detectarProvedor(segredo: string): Provedor | null {
  const limpo = segredo.trim();
  for (const p of PROVEDORES) {
    if (limpo.startsWith(p.prefixo)) return p.id;
  }
  return null;
}
