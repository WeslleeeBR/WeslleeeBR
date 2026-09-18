"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/clienteApi";
import type { Grafo, NoGrafo } from "@/lib/memoria";
import { RedeNeural } from "@/components/RedeNeural";
import { ModalMemoria } from "@/components/ModalMemoria";
import { Icone } from "@/components/Icone";

/**
 * A tela da rede: canvas + legenda + busca + editor.
 *
 * O grafo chega pronto do servidor e é recarregado por `/api/v1/memorias/grafo`
 * depois de cada edição — recarregar a página inteira jogaria fora as posições
 * já assentadas da simulação e o enquadramento da câmera.
 */
export function PainelRede({ grafoInicial }: { grafoInicial: Grafo }) {
  const [grafo, setGrafo] = useState(grafoInicial);
  const [selecionado, setSelecionado] = useState<NoGrafo | null>(null);
  const [criando, setCriando] = useState(false);
  const [busca, setBusca] = useState("");
  const [recarregando, setRecarregando] = useState(false);

  const recarregar = useCallback(async () => {
    setRecarregando(true);
    try {
      setGrafo(await api.get<Grafo>("/api/v1/memorias/grafo"));
    } finally {
      setRecarregando(false);
    }
  }, []);

  const areasComUso = grafo.areas.filter((a) => a.total > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-mono text-lg font-bold tracking-[0.16em] text-theme">REDE</h1>
          <p className="text-xs text-dim">
            {grafo.nos.length} memórias · {grafo.arestas.length} ligações · arraste para mover,
            role para aproximar
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar..."
            className="w-36 rounded border border-line bg-panel2 px-3 py-1.5 text-sm outline-none transition focus:border-theme sm:w-48"
          />
          <button
            onClick={recarregar}
            title="Recarregar"
            className="rounded border border-line p-2 text-dim transition hover:text-theme"
          >
            <Icone nome="recarregar" className={`h-4 w-4 ${recarregando ? "girando" : ""}`} />
          </button>
          <button
            onClick={() => setCriando(true)}
            className="flex items-center gap-1.5 rounded border border-theme/50 bg-theme/12 px-3 py-2 font-mono text-[0.68rem] tracking-[0.12em] text-theme transition hover:bg-theme/20"
          >
            <Icone nome="mais" className="h-4 w-4" />
            NOVA
          </button>
        </div>
      </div>

      <div className="painel faixa-topo relative h-[62dvh] overflow-hidden md:h-[68dvh]">
        {grafo.nos.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="text-sm text-dim">
                A rede está vazia. Converse com o Beru ou crie a primeira memória —
                <br />
                ele liga o que for surgindo sozinho.
              </p>
              <button
                onClick={() => setCriando(true)}
                className="mt-4 rounded border border-theme/50 bg-theme/12 px-4 py-2 font-mono text-xs tracking-[0.12em] text-theme"
              >
                CRIAR MEMÓRIA
              </button>
            </div>
          </div>
        ) : (
          <RedeNeural grafo={grafo} aoSelecionar={setSelecionado} busca={busca} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {areasComUso.map((area) => (
          <button
            key={area.slug}
            onClick={() => setBusca("")}
            className="flex items-center gap-1.5 text-xs text-dim transition hover:text-txt"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: area.cor }} />
            {area.rotulo}
            <span className="font-mono text-dim/60">{area.total}</span>
          </button>
        ))}
      </div>

      {(selecionado || criando) && (
        <ModalMemoria
          memoria={selecionado}
          areas={grafo.areas}
          aoFechar={() => {
            setSelecionado(null);
            setCriando(false);
          }}
          aoSalvar={async () => {
            setSelecionado(null);
            setCriando(false);
            await recarregar();
          }}
        />
      )}
    </div>
  );
}
