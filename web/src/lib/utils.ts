import clsx, { type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Minúsculo, sem acento, sem pontuação e com espaços colapsados. É o que
 * transforma "Gestão Financeira" e "gestao financeira " na mesma chave —
 * usado para deduplicar memórias quando o modelo escreve o título de um jeito
 * levemente diferente a cada vez.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Versão para slug de área: igual à chave, mas com hífen no lugar do espaço. */
export function slugificar(texto: string): string {
  return normalizar(texto).replace(/\s/g, "-");
}

export function hexParaRgba(hex: string, alfa: number): string {
  const limpo = hex.replace("#", "");
  const r = parseInt(limpo.slice(0, 2), 16);
  const g = parseInt(limpo.slice(2, 4), 16);
  const b = parseInt(limpo.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

export function limitar(valor: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, valor));
}

/** "há 3 dias", "agora há pouco" — datas curtas para a lista de memórias. */
export function tempoRelativo(data: Date | string): string {
  const d = typeof data === "string" ? new Date(data) : data;
  const segundos = Math.floor((Date.now() - d.getTime()) / 1000);
  if (segundos < 60) return "agora há pouco";
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
  return `há ${Math.floor(meses / 12)} ano(s)`;
}
