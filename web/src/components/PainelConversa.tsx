"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ErroApi } from "@/lib/clienteApi";
import { normalizar } from "@/lib/utils";
import { Orbe, type EstadoOrbe } from "@/components/Orbe";
import { Icone } from "@/components/Icone";
import {
  criarReconhecimento,
  falar,
  pararFala,
  prepararVozes,
  reconhecimentoDisponivel,
  type Reconhecimento,
} from "@/lib/voz";

interface AcaoMemoria {
  tipo: "salvou" | "ligou";
  titulo: string;
}

interface RespostaChat {
  conversaId: string;
  texto: string;
  provedor: string;
  modelo: string;
  acoes: AcaoMemoria[];
}

interface Linha {
  id: string;
  quem: "voce" | "beru";
  texto: string;
  acoes?: AcaoMemoria[];
  rodape?: string;
}

/**
 * A conversa: texto e voz na mesma superfície.
 *
 * O fluxo de voz tem uma armadilha própria — o reconhecimento contínuo escuta
 * o alto-falante e se ouve responder, virando um laço infinito. Por isso o
 * microfone é desligado durante o pensar e o falar, e religado só quando a
 * resposta termina.
 */
export function PainelConversa({
  nomeAssistente,
  wakeWord,
  vozPreferida,
}: {
  nomeAssistente: string;
  wakeWord: string;
  vozPreferida: "masculina" | "feminina" | "sistema";
}) {
  const router = useRouter();

  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [estado, setEstado] = useState<EstadoOrbe>("parado");
  const [status, setStatus] = useState("PRONTO");
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<{ mensagem: string; semChave: boolean } | null>(null);
  const [vozAtiva, setVozAtiva] = useState(false);
  const [ouvindoPalavra, setOuvindoPalavra] = useState(false);

  const conversaId = useRef<string | undefined>(undefined);
  const reconhecimento = useRef<Reconhecimento | null>(null);
  const ocupado = useRef(false);
  const fimDaLista = useRef<HTMLDivElement>(null);
  const querOuvir = useRef(false);

  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [linhas]);

  const adicionar = useCallback((linha: Omit<Linha, "id">) => {
    setLinhas((atual) => [...atual, { ...linha, id: crypto.randomUUID() }].slice(-40));
  }, []);

  /* ─── Envio ──────────────────────────────────────────────────────────── */

  const enviar = useCallback(
    async (mensagem: string, porVoz: boolean) => {
      const limpo = mensagem.trim();
      if (!limpo || ocupado.current) return;

      ocupado.current = true;
      adicionar({ quem: "voce", texto: limpo });
      setTexto("");
      setErro(null);
      setEstado("pensando");
      setStatus("PENSANDO...");

      try {
        const resposta = await api.post<RespostaChat>(
          `/api/v1/chat${porVoz ? "?voz=1" : ""}`,
          { mensagem: limpo, conversaId: conversaId.current }
        );
        conversaId.current = resposta.conversaId;

        adicionar({
          quem: "beru",
          texto: resposta.texto,
          acoes: resposta.acoes,
          rodape: `${resposta.provedor} · ${resposta.modelo}`,
        });

        // Memória nova significa nó novo na rede — a página do grafo precisa
        // reler os dados do servidor.
        if (resposta.acoes.length) router.refresh();

        if (porVoz && vozAtiva) {
          setEstado("falando");
          setStatus("FALANDO...");
          falar(resposta.texto, () => {
            ocupado.current = false;
            setEstado("parado");
            setStatus(querOuvir.current ? `AGUARDANDO "${wakeWord.toUpperCase()}"...` : "PRONTO");
          });
          return;
        }
      } catch (err) {
        const apiErro = err instanceof ErroApi ? err : null;
        setErro({
          mensagem: apiErro?.message ?? "Não consegui falar com o servidor.",
          semChave: apiErro?.code === "SEM_CHAVE",
        });
      }

      ocupado.current = false;
      setEstado("parado");
      setStatus(querOuvir.current ? `AGUARDANDO "${wakeWord.toUpperCase()}"...` : "PRONTO");
    },
    [adicionar, router, vozAtiva, wakeWord]
  );

  /* ─── Voz ────────────────────────────────────────────────────────────── */

  /**
   * Só reage depois da palavra de ativação, e manda adiante apenas o que veio
   * DEPOIS dela ("ei beru, que horas são" → "que horas são").
   *
   * A busca é feita palavra a palavra, cada uma normalizada: comparar as
   * strings inteiras não serve, porque tirar acento e pontuação muda o tamanho
   * do texto e o corte cairia no lugar errado.
   */
  const aoOuvir = useCallback(
    (frase: string) => {
      if (ocupado.current) return;

      const palavras = frase.trim().split(/\s+/);
      const normalizadas = palavras.map((p) => normalizar(p));
      const gatilho = normalizar(wakeWord).split(" ").filter(Boolean);
      if (!gatilho.length) return;

      let inicio = -1;
      for (let i = 0; i + gatilho.length <= normalizadas.length; i++) {
        if (gatilho.every((g, k) => normalizadas[i + k] === g)) {
          inicio = i;
          break;
        }
      }
      if (inicio === -1) return;

      const resto = palavras
        .slice(inicio + gatilho.length)
        .join(" ")
        .replace(/^[,.\s]+/, "")
        .trim();

      if (resto.length > 1) {
        void enviar(resto, true);
      } else {
        // Chamou e não disse mais nada: fica atento, esperando a frase seguinte.
        setEstado("ouvindo");
        setStatus("ESCUTANDO...");
      }
    },
    [enviar, wakeWord]
  );

  // O reconhecimento registra `onresult` uma vez só, quando a escuta começa.
  // Sem esta referência viva, ele ficaria preso à primeira versão de `aoOuvir`
  // — e com ela, ao valor antigo de `vozAtiva`, deixando o Beru mudo.
  const aoOuvirRef = useRef(aoOuvir);
  aoOuvirRef.current = aoOuvir;

  const alternarEscuta = useCallback(() => {
    if (ouvindoPalavra) {
      querOuvir.current = false;
      reconhecimento.current?.abort();
      reconhecimento.current = null;
      setOuvindoPalavra(false);
      setEstado("parado");
      setStatus("PRONTO");
      return;
    }

    const r = criarReconhecimento();
    if (!r) {
      setErro({
        mensagem: "Seu navegador não tem reconhecimento de voz. Use o Chrome ou digite abaixo.",
        semChave: false,
      });
      return;
    }

    r.onresult = (evento) => {
      for (let i = evento.resultIndex; i < evento.results.length; i++) {
        const resultado = evento.results[i]!;
        if (resultado.isFinal) aoOuvirRef.current(resultado[0].transcript);
      }
    };
    // O reconhecimento contínuo para sozinho depois de um tempo de silêncio;
    // religar no `onend` é o que mantém a escuta de fato contínua.
    r.onend = () => {
      if (querOuvir.current) {
        try {
          r.start();
        } catch {
          /* já rodando */
        }
      }
    };
    r.onerror = (evento) => {
      if (evento.error === "not-allowed" || evento.error === "service-not-allowed") {
        querOuvir.current = false;
        setOuvindoPalavra(false);
        setErro({ mensagem: "Preciso da permissão do microfone para escutar.", semChave: false });
      }
    };

    querOuvir.current = true;
    reconhecimento.current = r;
    setVozAtiva(true);
    setOuvindoPalavra(true);
    setStatus(`AGUARDANDO "${wakeWord.toUpperCase()}"...`);
    prepararVozes(vozPreferida);
    try {
      r.start();
    } catch {
      /* já rodando */
    }
  }, [ouvindoPalavra, vozPreferida, wakeWord]);

  useEffect(() => {
    return () => {
      querOuvir.current = false;
      reconhecimento.current?.abort();
      pararFala();
    };
  }, []);

  /* ─── Render ─────────────────────────────────────────────────────────── */

  const temReconhecimento = reconhecimentoDisponivel();

  return (
    <section className="painel faixa-topo relative flex min-h-[70dvh] flex-col overflow-hidden">
      <div className="flex flex-col items-center gap-3 border-b border-line px-6 py-7">
        <Orbe estado={estado} />
        <h2 className="font-mono text-lg font-bold tracking-[0.2em] text-theme">
          {nomeAssistente.toUpperCase()}
        </h2>
        <p className="font-mono text-[0.66rem] tracking-[0.26em] text-dim">
          <span className={estado === "pensando" ? "piscando" : undefined}>{status}</span>
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6">
        {linhas.length === 0 && (
          <p className="mx-auto max-w-sm py-10 text-center text-sm leading-relaxed text-dim">
            Fale ou escreva. O que for duradouro sobre você, eu guardo na rede de memórias
            sozinho — e uso em toda conversa daqui pra frente.
          </p>
        )}

        {linhas.map((linha) => (
          <div key={linha.id} className="surgindo">
            <div
              className={
                linha.quem === "voce"
                  ? "ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-theme/12 px-3.5 py-2.5 text-sm text-txt"
                  : "mr-auto max-w-[85%] rounded-lg rounded-bl-sm border border-line bg-panel2 px-3.5 py-2.5 text-sm leading-relaxed text-txt"
              }
            >
              <span className="mb-1 block font-mono text-[0.58rem] tracking-[0.2em] text-dim">
                {linha.quem === "voce" ? "VOCÊ" : nomeAssistente.toUpperCase()}
              </span>
              {linha.texto}
            </div>

            {linha.acoes?.map((acao, i) => (
              <p
                key={i}
                className="mt-1.5 ml-1 flex items-center gap-1.5 font-mono text-[0.62rem] text-ok"
              >
                <Icone nome={acao.tipo === "salvou" ? "nota" : "rede"} className="h-3 w-3" />
                {acao.tipo === "salvou" ? "memória gravada:" : "ligação criada:"} {acao.titulo}
              </p>
            ))}

            {linha.rodape && (
              <p className="mt-1 ml-1 font-mono text-[0.58rem] text-dim/70">{linha.rodape}</p>
            )}
          </div>
        ))}

        {erro && (
          <div className="surgindo rounded border border-err/40 bg-err/10 px-3 py-2.5 text-sm text-err">
            {erro.mensagem}
            {erro.semChave && (
              <>
                {" "}
                <Link href="/configuracoes" className="underline">
                  Cadastrar chave
                </Link>
              </>
            )}
          </div>
        )}

        <div ref={fimDaLista} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(texto, false);
        }}
        className="flex items-center gap-2 border-t border-line bg-bg2/60 px-3 py-3"
      >
        <button
          type="button"
          onClick={alternarEscuta}
          disabled={!temReconhecimento}
          title={
            temReconhecimento
              ? ouvindoPalavra
                ? "Parar de escutar"
                : `Escutar "${wakeWord}"`
              : "Sem reconhecimento de voz neste navegador"
          }
          className={`rounded border p-2.5 transition disabled:opacity-35 ${
            ouvindoPalavra
              ? "border-theme bg-theme/15 text-theme"
              : "border-line text-dim hover:text-txt"
          }`}
        >
          <Icone nome="microfone" className="h-5 w-5" />
        </button>

        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escreva aqui..."
          className="min-w-0 flex-1 rounded border border-line bg-panel2 px-3 py-2.5 text-sm outline-none transition focus:border-theme"
        />

        <button
          type="button"
          onClick={() => {
            pararFala();
            ocupado.current = false;
            setEstado("parado");
            setStatus("PRONTO");
          }}
          title="Interromper a fala"
          className="rounded border border-line p-2.5 text-dim transition hover:text-err"
        >
          <Icone nome="parar" className="h-5 w-5" />
        </button>

        <button
          type="submit"
          disabled={!texto.trim()}
          className="rounded border border-theme/50 bg-theme/12 p-2.5 text-theme transition enabled:hover:bg-theme/20 disabled:opacity-35"
        >
          <Icone nome="enviar" className="h-5 w-5" />
        </button>
      </form>
    </section>
  );
}
