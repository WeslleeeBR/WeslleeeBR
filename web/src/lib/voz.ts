"use client";

/**
 * Voz do navegador: reconhecimento (ouvir) e síntese (falar).
 *
 * As duas APIs são do navegador, não padronizadas por igual, e ausentes em
 * parte deles — Firefox não tem reconhecimento até hoje. Por isso tudo aqui
 * devolve `null` ou `false` em vez de lançar: a interface tem que continuar
 * funcionando por texto onde a voz não existe.
 */

interface ResultadoFala {
  transcript: string;
  confidence: number;
}
interface EventoReconhecimento {
  resultIndex: number;
  results: { isFinal: boolean; length: number; 0: ResultadoFala }[];
}
export interface Reconhecimento {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: EventoReconhecimento) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

type ConstrutorReconhecimento = new () => Reconhecimento;

function construtor(): ConstrutorReconhecimento | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstrutorReconhecimento;
    webkitSpeechRecognition?: ConstrutorReconhecimento;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function reconhecimentoDisponivel(): boolean {
  return construtor() !== null;
}

export function criarReconhecimento(): Reconhecimento | null {
  const Construtor = construtor();
  if (!Construtor) return null;

  const r = new Construtor();
  r.lang = "pt-BR";
  // `continuous` é o que permite a wake word: o microfone fica aberto e a gente
  // filtra o que interessa, em vez de exigir um clique a cada frase.
  r.continuous = true;
  r.interimResults = false;
  return r;
}

/* ─── Síntese ────────────────────────────────────────────────────────────── */

let vozEscolhida: SpeechSynthesisVoice | null = null;

/**
 * Escolhe a melhor voz em português. A lista chega de forma assíncrona em
 * alguns navegadores, então `vozesProntas` é chamada de novo no evento
 * `voiceschanged` — pedir a voz cedo demais devolve array vazio e o navegador
 * cai numa voz em inglês lendo português.
 */
export function prepararVozes(preferencia: "masculina" | "feminina" | "sistema" = "masculina") {
  if (typeof window === "undefined" || !window.speechSynthesis) return;

  const escolher = () => {
    const vozes = window.speechSynthesis.getVoices().filter((v) => /pt[-_]?BR|pt/i.test(v.lang));
    if (!vozes.length) return;

    if (preferencia !== "sistema") {
      const pistas = preferencia === "masculina" ? /male|homem|daniel|ricardo|felipe/i : /female|mulher|luciana|maria|francisca/i;
      vozEscolhida = vozes.find((v) => pistas.test(v.name)) ?? vozes[0]!;
    } else {
      vozEscolhida = vozes[0]!;
    }
  };

  escolher();
  window.speechSynthesis.onvoiceschanged = escolher;
}

/**
 * Fala um texto. Quebra em frases antes de enfileirar: enunciados longos são
 * cortados no meio por alguns navegadores (limite não documentado, em torno de
 * 200-300 caracteres), e frases curtas também deixam o `onend` mais preciso.
 */
export function falar(texto: string, aoTerminar?: () => void) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    aoTerminar?.();
    return;
  }

  window.speechSynthesis.cancel();

  const frases = texto.match(/[^.!?…]+[.!?…]*/g)?.map((f) => f.trim()).filter(Boolean) ?? [texto];
  if (!frases.length) {
    aoTerminar?.();
    return;
  }

  frases.forEach((frase, i) => {
    const fala = new SpeechSynthesisUtterance(frase);
    fala.lang = "pt-BR";
    fala.rate = 1.02;
    fala.pitch = 0.95;
    if (vozEscolhida) fala.voice = vozEscolhida;
    if (i === frases.length - 1) {
      fala.onend = () => aoTerminar?.();
      // Alguns navegadores engolem o onend quando a aba perde o foco; o erro
      // também precisa liberar quem está esperando, ou o app trava em "falando".
      fala.onerror = () => aoTerminar?.();
    }
    window.speechSynthesis.speak(fala);
  });
}

export function pararFala() {
  if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
}
