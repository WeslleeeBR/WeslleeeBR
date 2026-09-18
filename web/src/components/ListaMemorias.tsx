"use client";

import { useCallback, useMemo, useState } from "react";
import { api, ErroApi } from "@/lib/clienteApi";
import { normalizar, tempoRelativo } from "@/lib/utils";
import type { Grafo, NoGrafo } from "@/lib/memoria";
import { ModalMemoria } from "@/components/ModalMemoria";
import { Icone } from "@/components/Icone";

interface AcaoMemoria {
  tipo: "salvou" | "ligou";
  titulo: string;
}

/**
 * A mesma base da rede, em lista — para ler, filtrar e editar com calma.
 *
 * O painel de distribuição é o atalho que faltava no protótipo: cola-se um
 * texto corrido e o modelo o fatia em memórias, cada uma na sua área, em vez de
 * obrigar o usuário a criar nota por nota.
 */
export function ListaMemorias({ grafoInicial }: { grafoInicial: Grafo }) {
  const [grafo, setGrafo] = useState(grafoInicial);
  const [busca, setBusca] = useState("");
  const [areaFiltro, setAreaFiltro] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<NoGrafo | null>(null);
  const [criando, setCriando] = useState(false);

  const [textoSolto, setTextoSolto] = useState("");
  const [distribuindo, setDistribuindo] = useState(false);
  const [resultado, setResultado] = useState<{ acoes?: AcaoMemoria[]; erro?: string } | null>(null);

  const recarregar = useCallback(async () => {
    setGrafo(await api.get<Grafo>("/api/v1/memorias/grafo"));
  }, []);

  const filtradas = useMemo(() => {
    const termo = normalizar(busca);
    return grafo.nos
      .filter((n) => (areaFiltro ? n.area === areaFiltro : true))
      .filter(
        (n) =>
          !termo ||
          normalizar(n.titulo).includes(termo) ||
          normalizar(n.corpo).includes(termo) ||
          n.tags.some((t) => normalizar(t).includes(termo))
      )
      .sort(
        (a, b) =>
          Number(b.fixada) - Number(a.fixada) || b.atualizadoEm.localeCompare(a.atualizadoEm)
      );
  }, [grafo.nos, busca, areaFiltro]);

  async function distribuir() {
    if (distribuindo || textoSolto.trim().length < 10) return;
    setDistribuindo(true);
    setResultado(null);
    try {
      const { acoes } = await api.post<{ acoes: AcaoMemoria[] }>(
        "/api/v1/memorias/distribuir",
        { texto: textoSolto }
      );
      setResultado({ acoes });
      setTextoSolto("");
      await recarregar();
    } catch (err) {
      setResultado({ erro: err instanceof ErroApi ? err.message : "Não consegui distribuir." });
    } finally {
      setDistribuindo(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-mono text-lg font-bold tracking-[0.16em] text-theme">MEMÓRIAS</h1>
          <p className="text-xs text-dim">{grafo.nos.length} no total</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar..."
            className="w-40 rounded border border-line bg-panel2 px-3 py-1.5 text-sm outline-none focus:border-theme sm:w-56"
          />
          <button
            onClick={() => setCriando(true)}
            className="flex items-center gap-1.5 rounded border border-theme/50 bg-theme/12 px-3 py-2 font-mono text-[0.68rem] tracking-[0.12em] text-theme transition hover:bg-theme/20"
          >
            <Icone nome="mais" className="h-4 w-4" />
            NOVA
          </button>
        </div>
      </div>

      <section className="painel faixa-topo relative p-4">
        <p className="flex items-center gap-2 font-mono text-[0.66rem] tracking-[0.16em] text-theme">
          <Icone nome="raio" className="h-4 w-4" />
          DISTRIBUIR TEXTO
        </p>
        <p className="mt-1.5 text-xs text-dim">
          Escreva solto o que aconteceu. O Beru separa em memórias e liga no que já existe.
        </p>
        <textarea
          value={textoSolto}
          onChange={(e) => setTextoSolto(e.target.value)}
          rows={3}
          placeholder="Ex: comecei a estudar inglês essa semana e fechei um projeto novo de automação no trabalho..."
          className="mt-3 w-full resize-y rounded border border-line bg-panel2 px-3 py-2 text-sm leading-relaxed outline-none focus:border-theme"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={distribuir}
            disabled={distribuindo || textoSolto.trim().length < 10}
            className="rounded border border-theme/50 bg-theme/12 px-4 py-2 font-mono text-[0.68rem] tracking-[0.12em] text-theme transition enabled:hover:bg-theme/20 disabled:opacity-40"
          >
            {distribuindo ? "DISTRIBUINDO..." : "DISTRIBUIR"}
          </button>

          {resultado?.erro && <span className="text-sm text-err">{resultado.erro}</span>}
          {resultado?.acoes && (
            <span className="text-sm text-ok">
              {resultado.acoes.length
                ? `${resultado.acoes.length} ${resultado.acoes.length === 1 ? "alteração aplicada" : "alterações aplicadas"}.`
                : "Nada novo para gravar."}
            </span>
          )}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <BotaoFiltro ativo={areaFiltro === null} aoClicar={() => setAreaFiltro(null)}>
          Todas
        </BotaoFiltro>
        {grafo.areas
          .filter((a) => a.total > 0)
          .map((a) => (
            <BotaoFiltro
              key={a.slug}
              ativo={areaFiltro === a.slug}
              cor={a.cor}
              aoClicar={() => setAreaFiltro(areaFiltro === a.slug ? null : a.slug)}
            >
              {a.rotulo} <span className="font-mono opacity-60">{a.total}</span>
            </BotaoFiltro>
          ))}
      </div>

      {filtradas.length === 0 ? (
        <p className="py-16 text-center text-sm text-dim">Nada por aqui ainda.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtradas.map((memoria) => (
            <button
              key={memoria.id}
              onClick={() => setSelecionada(memoria)}
              className="painel group relative overflow-hidden p-4 text-left transition hover:border-theme/45"
            >
              <span
                className="absolute inset-y-0 left-0 w-0.5"
                style={{ background: memoria.cor }}
              />
              <div className="flex items-start gap-2">
                <h3 className="flex-1 text-sm font-semibold text-txt">{memoria.titulo}</h3>
                {memoria.fixada && <Icone nome="alfinete" className="h-3.5 w-3.5 text-theme" />}
              </div>
              <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-dim">{memoria.corpo}</p>
              <div className="mt-3 flex items-center gap-2 font-mono text-[0.58rem] text-dim/70">
                <span style={{ color: memoria.cor }}>{memoria.areaRotulo ?? "sem área"}</span>
                <span>·</span>
                <span>{memoria.grau} ligações</span>
                <span className="ml-auto">{tempoRelativo(memoria.atualizadoEm)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {(selecionada || criando) && (
        <ModalMemoria
          memoria={selecionada}
          areas={grafo.areas}
          aoFechar={() => {
            setSelecionada(null);
            setCriando(false);
          }}
          aoSalvar={async () => {
            setSelecionada(null);
            setCriando(false);
            await recarregar();
          }}
        />
      )}
    </div>
  );
}

function BotaoFiltro({
  children,
  ativo,
  cor,
  aoClicar,
}: {
  children: React.ReactNode;
  ativo: boolean;
  cor?: string;
  aoClicar: () => void;
}) {
  return (
    <button
      onClick={aoClicar}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
        ativo ? "border-theme/60 bg-theme/12 text-theme" : "border-line text-dim hover:text-txt"
      }`}
    >
      {cor && <span className="h-2 w-2 rounded-full" style={{ background: cor }} />}
      {children}
    </button>
  );
}
