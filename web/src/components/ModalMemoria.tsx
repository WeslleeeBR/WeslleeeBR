"use client";

import { useEffect, useState } from "react";
import { api, ErroApi } from "@/lib/clienteApi";
import type { NoGrafo } from "@/lib/memoria";
import { Icone } from "@/components/Icone";

/**
 * Editor de uma memória. O mesmo componente cria e edita — `memoria` nulo
 * significa criação.
 *
 * Excluir pede confirmação no próprio botão (dois toques) em vez de um
 * `confirm()`: um diálogo nativo em cima de um modal escuro fica feio e quebra
 * o foco no celular.
 */
export function ModalMemoria({
  memoria,
  areas,
  aoFechar,
  aoSalvar,
}: {
  memoria: NoGrafo | null;
  areas: { slug: string; rotulo: string; cor: string }[];
  aoFechar: () => void;
  aoSalvar: () => void | Promise<void>;
}) {
  const [titulo, setTitulo] = useState(memoria?.titulo ?? "");
  const [corpo, setCorpo] = useState(memoria?.corpo ?? "");
  const [area, setArea] = useState(memoria?.area ?? areas[0]?.slug ?? "");
  const [importancia, setImportancia] = useState(memoria?.importancia ?? 3);
  const [fixada, setFixada] = useState(memoria?.fixada ?? false);
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErro(null);

    try {
      const dados = { titulo, corpo, area, importancia, fixada };
      if (memoria) {
        await api.patch(`/api/v1/memorias/${memoria.id}`, dados);
      } else {
        await api.post("/api/v1/memorias", dados);
      }
      await aoSalvar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : "Não consegui salvar.");
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!memoria) return;
    if (!confirmando) {
      setConfirmando(true);
      return;
    }
    setSalvando(true);
    try {
      await api.delete(`/api/v1/memorias/${memoria.id}`);
      await aoSalvar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : "Não consegui excluir.");
      setSalvando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="painel faixa-topo surgindo relative w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-sm tracking-[0.16em] text-theme">
            {memoria ? "EDITAR MEMÓRIA" : "NOVA MEMÓRIA"}
          </h2>
          <button onClick={aoFechar} className="text-dim transition hover:text-txt">
            <Icone nome="fechar" className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3.5">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] text-dim">
              TÍTULO
            </span>
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={80}
              autoFocus
              className="w-full rounded border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-theme"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] text-dim">
              ÁREA
            </span>
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="w-full rounded border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-theme"
            >
              {areas.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.rotulo}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] text-dim">
              CONTEÚDO
            </span>
            <textarea
              value={corpo}
              onChange={(e) => setCorpo(e.target.value)}
              rows={5}
              className="w-full resize-y rounded border border-line bg-panel2 px-3 py-2 text-sm leading-relaxed outline-none focus:border-theme"
            />
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <span className="font-mono text-[0.62rem] tracking-[0.18em] text-dim">PESO</span>
              <input
                type="range"
                min={1}
                max={5}
                value={importancia}
                onChange={(e) => setImportancia(Number(e.target.value))}
                className="accent-[var(--theme)]"
              />
              <span className="font-mono text-xs text-theme">{importancia}</span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-dim">
              <input
                type="checkbox"
                checked={fixada}
                onChange={(e) => setFixada(e.target.checked)}
                className="accent-[var(--theme)]"
              />
              Sempre no contexto
            </label>
          </div>

          {erro && (
            <p className="rounded border border-err/40 bg-err/10 px-3 py-2 text-sm text-err">
              {erro}
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          {memoria && (
            <button
              onClick={excluir}
              disabled={salvando}
              className={`flex items-center gap-1.5 rounded border px-3 py-2 font-mono text-[0.68rem] tracking-[0.1em] transition ${
                confirmando
                  ? "border-err bg-err/15 text-err"
                  : "border-line text-dim hover:border-err/50 hover:text-err"
              }`}
            >
              <Icone nome="lixeira" className="h-4 w-4" />
              {confirmando ? "CONFIRMAR" : "EXCLUIR"}
            </button>
          )}

          <button
            onClick={aoFechar}
            className="ml-auto rounded border border-line px-3 py-2 font-mono text-[0.68rem] tracking-[0.1em] text-dim transition hover:text-txt"
          >
            CANCELAR
          </button>
          <button
            onClick={salvar}
            disabled={salvando || !titulo.trim() || !corpo.trim()}
            className="rounded border border-theme/50 bg-theme/15 px-4 py-2 font-mono text-[0.68rem] tracking-[0.1em] text-theme transition enabled:hover:bg-theme/25 disabled:opacity-40"
          >
            {salvando ? "SALVANDO..." : "SALVAR"}
          </button>
        </div>
      </div>
    </div>
  );
}
