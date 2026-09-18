"use client";

import { useEffect, useRef } from "react";

export type EstadoOrbe = "parado" | "ouvindo" | "pensando" | "falando";

/**
 * O núcleo do Beru. Cada estado tem frequência, amplitude e brilho próprios —
 * é por eles que se sabe, de relance, se ele está ouvindo ou processando.
 *
 * O pulso é calculado com seno em requestAnimationFrame em vez de
 * `@keyframes`: a troca de estado precisa ser contínua (a onda continua de
 * onde estava), e com keyframes a animação reiniciaria do zero a cada troca,
 * dando um solavanco visível a cada frase.
 */
const PARAMETROS: Record<EstadoOrbe, { freq: number; amp: number; brilho: number }> = {
  parado: { freq: 0.22, amp: 0.03, brilho: 44 },
  ouvindo: { freq: 1.05, amp: 0.075, brilho: 60 },
  pensando: { freq: 1.85, amp: 0.115, brilho: 78 },
  falando: { freq: 1.25, amp: 0.06, brilho: 64 },
};

export function Orbe({ estado, tamanho = 132 }: { estado: EstadoOrbe; tamanho?: number }) {
  const nucleo = useRef<HTMLDivElement>(null);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  useEffect(() => {
    let frame = 0;
    let inicio: number | null = null;

    const animar = (ts: number) => {
      if (inicio === null) inicio = ts;
      const el = nucleo.current;
      if (el) {
        const p = PARAMETROS[estadoRef.current];
        const t = (ts - inicio) / 1000;
        const onda = Math.sin(2 * Math.PI * p.freq * t) * 0.5 + 0.5;
        el.style.transform = `scale(${(1 + p.amp * onda).toFixed(4)})`;
        el.style.boxShadow =
          `0 0 ${(p.brilho + onda * 24).toFixed(0)}px color-mix(in srgb, var(--theme) ${(40 + onda * 26).toFixed(0)}%, transparent), ` +
          `0 0 ${(p.brilho * 2 + onda * 38).toFixed(0)}px rgba(139,92,246,${(0.2 + onda * 0.15).toFixed(2)})`;
      }
      frame = requestAnimationFrame(animar);
    };

    frame = requestAnimationFrame(animar);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="relative grid place-items-center" style={{ width: tamanho, height: tamanho }}>
      <div className="orbe-anel" />
      <div className="orbe-anel orbe-anel-2" />
      <div
        ref={nucleo}
        className="rounded-full bg-radial-[at_35%_30%] from-white/85 via-theme to-violet"
        style={{ width: tamanho * 0.52, height: tamanho * 0.52 }}
      />
    </div>
  );
}
