"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ArestaGrafo, Grafo, NoGrafo } from "@/lib/memoria";

/**
 * A rede de memórias, no estilo do grafo do Obsidian.
 *
 * Simulação dirigida a forças, três delas:
 *
 *  • **Repulsão** entre todos os nós (lei do inverso do quadrado, limitada),
 *    para nada empilhar;
 *  • **Mola** em cada ligação, puxando o que está conectado;
 *  • **Gravidade** fraca para o centro, senão componentes desconectados saem
 *    flutuando para fora da tela e não voltam.
 *
 * O `alfa` decai a cada quadro até a rede assentar, e volta a subir quando o
 * usuário arrasta um nó ou os dados mudam — é o mesmo esquema do d3-force, mas
 * em 120 linhas e sem dependência.
 *
 * Tudo em canvas, não em SVG: com algumas centenas de nós e arestas, um
 * elemento de DOM por nó derruba o quadro no celular.
 */

interface NoSimulado extends NoGrafo {
  x: number;
  y: number;
  vx: number;
  vy: number;
  raio: number;
}

const REPULSAO = 5400;
const COMPRIMENTO_MOLA = 96;
const FORCA_MOLA = 0.016;
const GRAVIDADE = 0.012;
const ATRITO = 0.86;
const ALFA_MINIMO = 0.002;

export function RedeNeural({
  grafo,
  aoSelecionar,
  busca,
}: {
  grafo: Grafo;
  aoSelecionar: (no: NoGrafo) => void;
  busca?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nosRef = useRef<NoSimulado[]>([]);
  const arestasRef = useRef<ArestaGrafo[]>([]);
  const vizinhosRef = useRef<Map<string, Set<string>>>(new Map());

  const camera = useRef({ x: 0, y: 0, zoom: 1 });
  const alfa = useRef(1);
  const arrastando = useRef<{ no: NoSimulado | null; movido: boolean; px: number; py: number } | null>(null);
  const destacado = useRef<string | null>(null);
  const buscaRef = useRef(busca ?? "");
  buscaRef.current = (busca ?? "").toLowerCase();

  /* ─── Dados → simulação ──────────────────────────────────────────────── */

  useEffect(() => {
    const anteriores = new Map(nosRef.current.map((n) => [n.id, n]));

    nosRef.current = grafo.nos.map((no, i) => {
      const antigo = anteriores.get(no.id);
      // Mantém a posição do que já estava na tela: recarregar a rede depois de
      // gravar uma memória não pode embaralhar tudo de lugar.
      if (antigo) return { ...no, x: antigo.x, y: antigo.y, vx: 0, vy: 0, raio: raioDe(no) };

      // Nó novo entra numa espiral a partir do centro — melhor que aleatório,
      // que às vezes nascia em cima de outro e explodia na primeira repulsão.
      const angulo = i * 2.39996; // ângulo áureo
      const distancia = 26 * Math.sqrt(i + 1);
      return {
        ...no,
        x: Math.cos(angulo) * distancia,
        y: Math.sin(angulo) * distancia,
        vx: 0,
        vy: 0,
        raio: raioDe(no),
      };
    });

    arestasRef.current = grafo.arestas;

    const vizinhos = new Map<string, Set<string>>();
    for (const a of grafo.arestas) {
      if (!vizinhos.has(a.origem)) vizinhos.set(a.origem, new Set());
      if (!vizinhos.has(a.destino)) vizinhos.set(a.destino, new Set());
      vizinhos.get(a.origem)!.add(a.destino);
      vizinhos.get(a.destino)!.add(a.origem);
    }
    vizinhosRef.current = vizinhos;

    alfa.current = 1;
  }, [grafo]);

  /* ─── Laço de simulação + desenho ────────────────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let largura = 0;
    let altura = 0;

    const redimensionar = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const caixa = canvas.getBoundingClientRect();
      largura = caixa.width;
      altura = caixa.height;
      canvas.width = Math.floor(largura * dpr);
      canvas.height = Math.floor(altura * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    redimensionar();

    const observador = new ResizeObserver(redimensionar);
    observador.observe(canvas);

    const passo = () => {
      const nos = nosRef.current;
      const arestas = arestasRef.current;

      if (alfa.current > ALFA_MINIMO) {
        // Repulsão: O(n²), aceitável até algumas centenas de nós. Passando
        // disso, o caminho é um quadtree (Barnes-Hut) — não antes.
        for (let i = 0; i < nos.length; i++) {
          const a = nos[i]!;
          for (let j = i + 1; j < nos.length; j++) {
            const b = nos[j]!;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dist2 = dx * dx + dy * dy;
            if (dist2 < 1) {
              // Sobrepostos: um empurrãozinho determinístico desempata.
              dx = (i - j) * 0.5 + 0.1;
              dy = (j - i) * 0.5 + 0.1;
              dist2 = dx * dx + dy * dy;
            }
            const dist = Math.sqrt(dist2);
            const forca = Math.min(REPULSAO / dist2, 24) / dist;
            a.vx -= dx * forca;
            a.vy -= dy * forca;
            b.vx += dx * forca;
            b.vy += dy * forca;
          }
        }

        const porId = new Map(nos.map((n) => [n.id, n]));
        for (const aresta of arestas) {
          const a = porId.get(aresta.origem);
          const b = porId.get(aresta.destino);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 1;
          const deslocamento = (dist - COMPRIMENTO_MOLA) * FORCA_MOLA * (aresta.peso || 1);
          const fx = (dx / dist) * deslocamento;
          const fy = (dy / dist) * deslocamento;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }

        for (const no of nos) {
          no.vx -= no.x * GRAVIDADE;
          no.vy -= no.y * GRAVIDADE;
          if (arrastando.current?.no === no) continue;
          no.vx *= ATRITO;
          no.vy *= ATRITO;
          no.x += no.vx * alfa.current;
          no.y += no.vy * alfa.current;
        }

        alfa.current *= 0.988;
      }

      desenhar(ctx, largura, altura);
      frame = requestAnimationFrame(passo);
    };

    const desenhar = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const { x: camX, y: camY, zoom } = camera.current;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + camX, h / 2 + camY);
      ctx.scale(zoom, zoom);

      const nos = nosRef.current;
      const porId = new Map(nos.map((n) => [n.id, n]));
      const foco = destacado.current;
      const vizinhosDoFoco = foco ? vizinhosRef.current.get(foco) : null;
      const termo = buscaRef.current;

      // Arestas primeiro, para os nós ficarem por cima.
      for (const aresta of arestasRef.current) {
        const a = porId.get(aresta.origem);
        const b = porId.get(aresta.destino);
        if (!a || !b) continue;

        const noCaminho =
          !foco || aresta.origem === foco || aresta.destino === foco;
        ctx.globalAlpha = noCaminho ? 0.5 : 0.08;
        ctx.strokeStyle = noCaminho
          ? gradienteAresta(ctx, a, b)
          : "rgba(124,138,160,0.5)";
        ctx.lineWidth = noCaminho ? 1.4 : 0.8;

        // Curva leve: linhas retas cruzando viram uma teia visualmente ilegível.
        const mx = (a.x + b.x) / 2 - (b.y - a.y) * 0.08;
        const my = (a.y + b.y) / 2 + (b.x - a.x) * 0.08;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      for (const no of nos) {
        const relacionado = !foco || no.id === foco || vizinhosDoFoco?.has(no.id);
        const casaBusca = !termo || no.titulo.toLowerCase().includes(termo);
        const opacidade = relacionado && casaBusca ? 1 : termo && !casaBusca ? 0.12 : 0.25;

        ctx.globalAlpha = opacidade;

        // Halo — é ele que dá o aspecto de sinapse acesa.
        const halo = ctx.createRadialGradient(no.x, no.y, 0, no.x, no.y, no.raio * 3.4);
        halo.addColorStop(0, comAlfa(no.cor, 0.34));
        halo.addColorStop(1, comAlfa(no.cor, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(no.x, no.y, no.raio * 3.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = no.cor;
        ctx.beginPath();
        ctx.arc(no.x, no.y, no.raio, 0, Math.PI * 2);
        ctx.fill();

        if (no.fixada) {
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Rótulo só onde cabe: com zoom pequeno, escrever tudo vira borrão.
        if (zoom > 0.55 || no.id === foco) {
          ctx.fillStyle = no.id === foco ? "#dbe6f2" : "rgba(219,230,242,0.75)";
          ctx.font = `${no.id === foco ? 600 : 400} ${11 / Math.max(zoom, 0.8)}px ui-sans-serif, system-ui`;
          ctx.textAlign = "center";
          ctx.fillText(cortar(no.titulo, 22), no.x, no.y + no.raio + 13);
        }
      }

      ctx.globalAlpha = 1;
      ctx.restore();
    };

    frame = requestAnimationFrame(passo);
    return () => {
      cancelAnimationFrame(frame);
      observador.disconnect();
    };
  }, []);

  /* ─── Interação ──────────────────────────────────────────────────────── */

  const paraMundo = useCallback((clienteX: number, clienteY: number) => {
    const canvas = canvasRef.current!;
    const caixa = canvas.getBoundingClientRect();
    const { x: camX, y: camY, zoom } = camera.current;
    return {
      x: (clienteX - caixa.left - caixa.width / 2 - camX) / zoom,
      y: (clienteY - caixa.top - caixa.height / 2 - camY) / zoom,
    };
  }, []);

  const noEm = useCallback(
    (clienteX: number, clienteY: number): NoSimulado | null => {
      const ponto = paraMundo(clienteX, clienteY);
      let melhor: NoSimulado | null = null;
      let menorDistancia = Infinity;
      for (const no of nosRef.current) {
        const d = Math.hypot(no.x - ponto.x, no.y - ponto.y);
        // Alvo generoso: no celular, o dedo não acerta um círculo de 6px.
        if (d < Math.max(no.raio + 12, 18) && d < menorDistancia) {
          menorDistancia = d;
          melhor = no;
        }
      }
      return melhor;
    },
    [paraMundo]
  );

  const aoApontar = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const no = noEm(e.clientX, e.clientY);
      arrastando.current = { no, movido: false, px: e.clientX, py: e.clientY };
      destacado.current = no?.id ?? null;
      if (no) alfa.current = Math.max(alfa.current, 0.35);
    },
    [noEm]
  );

  const aoMover = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const estado = arrastando.current;
      if (!estado) {
        // Sem botão pressionado: destaque por passagem do mouse.
        const sob = noEm(e.clientX, e.clientY);
        destacado.current = sob?.id ?? null;
        e.currentTarget.style.cursor = sob ? "pointer" : "grab";
        return;
      }

      const dx = e.clientX - estado.px;
      const dy = e.clientY - estado.py;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) estado.movido = true;
      estado.px = e.clientX;
      estado.py = e.clientY;

      if (estado.no) {
        const zoom = camera.current.zoom;
        estado.no.x += dx / zoom;
        estado.no.y += dy / zoom;
        estado.no.vx = 0;
        estado.no.vy = 0;
        alfa.current = Math.max(alfa.current, 0.3);
      } else {
        camera.current.x += dx;
        camera.current.y += dy;
      }
    },
    [noEm]
  );

  const aoSoltar = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const estado = arrastando.current;
      arrastando.current = null;
      // Clique = apertar e soltar sem arrastar. Sem essa distinção, terminar um
      // arrasto em cima do nó abriria o editor sem querer.
      if (estado?.no && !estado.movido) {
        const original = grafo.nos.find((n) => n.id === estado.no!.id);
        if (original) aoSelecionar(original);
      }
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [aoSelecionar, grafo.nos]
  );

  const aoRolar = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const fator = e.deltaY < 0 ? 1.12 : 0.89;
    camera.current.zoom = Math.max(0.22, Math.min(3.2, camera.current.zoom * fator));
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={aoApontar}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerCancel={aoSoltar}
      onWheel={aoRolar}
      className="h-full w-full touch-none select-none"
      style={{ cursor: "grab" }}
    />
  );
}

/* ─── Auxiliares ───────────────────────────────────────────────────────── */

/** Memória mais conectada e mais importante ocupa mais espaço — como no Obsidian. */
function raioDe(no: NoGrafo): number {
  return 5 + Math.min(no.grau, 8) * 1.1 + no.importancia * 0.9;
}

function comAlfa(hex: string, alfa: number): string {
  const limpo = hex.replace("#", "");
  const r = parseInt(limpo.slice(0, 2), 16);
  const g = parseInt(limpo.slice(2, 4), 16);
  const b = parseInt(limpo.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alfa})`;
}

function gradienteAresta(
  ctx: CanvasRenderingContext2D,
  a: NoSimulado,
  b: NoSimulado
): CanvasGradient {
  const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  g.addColorStop(0, comAlfa(a.cor, 0.75));
  g.addColorStop(1, comAlfa(b.cor, 0.75));
  return g;
}

function cortar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}
