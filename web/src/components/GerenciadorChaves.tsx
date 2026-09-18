"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ErroApi } from "@/lib/clienteApi";
import { PROVEDORES, detectarProvedor, type Provedor } from "@/lib/provedores";
import type { ChaveIAView } from "@/lib/chavesIA";
import { Icone } from "@/components/Icone";

interface ModeloDisponivel {
  id: string;
  rotulo: string;
  gratuito?: boolean;
}

/**
 * Cadastro e rodízio das chaves de IA.
 *
 * Duas decisões de interface que evitam os erros mais comuns:
 *
 *  • O provedor é **adivinhado pelo formato da chave** assim que ela é colada.
 *  • O modelo é **escolhido numa lista vinda do provedor**, não digitado. Um
 *    caractere errado no nome do modelo só apareceria depois, como "não
 *    consegui responder", sem pista do motivo.
 *
 * A ordem da lista é a ordem de tentativa: a primeira que responder atende.
 */
export function GerenciadorChaves({
  chavesIniciais,
  criptografiaOk,
}: {
  chavesIniciais: ChaveIAView[];
  criptografiaOk: boolean;
}) {
  const router = useRouter();
  const [chaves, setChaves] = useState(chavesIniciais);
  const [provedor, setProvedor] = useState<Provedor>("gemini");
  const [segredo, setSegredo] = useState("");
  const [rotulo, setRotulo] = useState("");
  const [modelo, setModelo] = useState("");
  const [modelos, setModelos] = useState<ModeloDisponivel[]>([]);
  const [testando, setTestando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const meta = PROVEDORES.find((p) => p.id === provedor)!;

  function aoColarSegredo(valor: string) {
    setSegredo(valor);
    setModelos([]);
    setModelo("");
    const detectado = detectarProvedor(valor);
    if (detectado) setProvedor(detectado);
  }

  async function buscarModelos() {
    if (segredo.trim().length < 12 || testando) return;
    setTestando(true);
    setErro(null);
    try {
      const { modelos } = await api.post<{ modelos: ModeloDisponivel[] }>(
        "/api/v1/chaves-ia/modelos",
        { provedor, segredo }
      );
      setModelos(modelos);
      setModelo(modelos.find((m) => m.id === meta.modeloPadrao)?.id ?? modelos[0]?.id ?? "");
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : "Não consegui validar a chave.");
    } finally {
      setTestando(false);
    }
  }

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const nova = await api.post<ChaveIAView>("/api/v1/chaves-ia", {
        provedor,
        rotulo: rotulo.trim() || meta.nome,
        segredo,
        modelo: modelo || undefined,
      });
      setChaves((atual) => [...atual, nova]);
      setSegredo("");
      setRotulo("");
      setModelo("");
      setModelos([]);
      router.refresh();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : "Não consegui salvar a chave.");
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Sobe ou desce uma chave na fila de tentativas, trocando a prioridade com a
   * vizinha. São duas escritas porque a prioridade é um número por linha, não
   * uma lista ordenada — e trocar os dois valores mantém a fila sem buracos.
   */
  async function mover(indice: number, direcao: -1 | 1) {
    const atual = chaves[indice];
    const vizinha = chaves[indice + direcao];
    if (!atual || !vizinha) return;

    const [a, b] = await Promise.all([
      api.patch<ChaveIAView>(`/api/v1/chaves-ia/${atual.id}`, { prioridade: vizinha.prioridade }),
      api.patch<ChaveIAView>(`/api/v1/chaves-ia/${vizinha.id}`, { prioridade: atual.prioridade }),
    ]);

    setChaves((lista) =>
      lista
        .map((c) => (c.id === a.id ? a : c.id === b.id ? b : c))
        .sort((x, y) => x.prioridade - y.prioridade)
    );
  }

  async function alternar(chave: ChaveIAView) {
    const atualizada = await api.patch<ChaveIAView>(`/api/v1/chaves-ia/${chave.id}`, {
      ativa: !chave.ativa,
    });
    setChaves((atual) => atual.map((c) => (c.id === chave.id ? atualizada : c)));
    router.refresh();
  }

  async function remover(chave: ChaveIAView) {
    await api.delete(`/api/v1/chaves-ia/${chave.id}`);
    setChaves((atual) => atual.filter((c) => c.id !== chave.id));
    router.refresh();
  }

  return (
    <section className="painel faixa-topo relative p-5">
      <h2 className="flex items-center gap-2 font-mono text-sm tracking-[0.16em] text-theme">
        <Icone nome="chave" className="h-4 w-4" />
        CHAVES DE IA
      </h2>
      <p className="mt-1.5 text-xs text-dim">
        O Beru tenta as chaves de cima para baixo. Se uma estourar a cota, ele cai para a próxima
        sem você perceber. As chaves são cifradas antes de ir para o banco e nunca voltam para a
        tela.
      </p>

      {!criptografiaOk && (
        <p className="mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          O servidor está sem BERU_CRYPTO_KEY (ou JWT_SECRET). Defina uma no .env antes de cadastrar
          chaves.
        </p>
      )}

      {chaves.length > 0 && (
        <ul className="mt-4 space-y-2">
          {chaves.map((chave, i) => (
            <li
              key={chave.id}
              className="flex flex-wrap items-center gap-3 rounded border border-line bg-panel2 px-3 py-2.5"
            >
              <div className="flex flex-col">
                <button
                  onClick={() => mover(i, -1)}
                  disabled={i === 0}
                  title="Tentar antes"
                  className="px-1 text-dim transition enabled:hover:text-theme disabled:opacity-25"
                >
                  ▲
                </button>
                <button
                  onClick={() => mover(i, 1)}
                  disabled={i === chaves.length - 1}
                  title="Tentar depois"
                  className="px-1 text-dim transition enabled:hover:text-theme disabled:opacity-25"
                >
                  ▼
                </button>
              </div>
              <span className="font-mono text-[0.62rem] text-dim">#{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-txt">
                  {chave.rotulo}
                  <span className="ml-2 font-mono text-[0.62rem] text-dim">{chave.mascara}</span>
                </p>
                <p className="truncate font-mono text-[0.6rem] text-dim">
                  {chave.nomeProvedor} · {chave.modeloEfetivo}
                  {chave.ultimoErro && <span className="text-err"> · {chave.ultimoErro}</span>}
                </p>
              </div>

              <button
                onClick={() => alternar(chave)}
                className={`rounded border px-2 py-1 font-mono text-[0.6rem] tracking-[0.1em] transition ${
                  chave.ativa
                    ? "border-ok/50 bg-ok/10 text-ok"
                    : "border-line text-dim hover:text-txt"
                }`}
              >
                {chave.ativa ? "ATIVA" : "PAUSADA"}
              </button>
              <button
                onClick={() => remover(chave)}
                className="rounded border border-line p-1.5 text-dim transition hover:border-err/50 hover:text-err"
                title="Remover"
              >
                <Icone nome="lixeira" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 space-y-3 rounded border border-line/60 p-4">
        <div className="flex flex-wrap gap-2">
          {PROVEDORES.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setProvedor(p.id);
                setModelos([]);
                setModelo("");
              }}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                provedor === p.id
                  ? "border-theme/60 bg-theme/12 text-theme"
                  : "border-line text-dim hover:text-txt"
              }`}
            >
              {p.nome}
            </button>
          ))}
        </div>

        <p className="text-[0.7rem] text-dim">
          {meta.gratuito}{" "}
          <a
            href={meta.urlChave}
            target="_blank"
            rel="noreferrer"
            className="text-theme hover:underline"
          >
            pegar chave →
          </a>
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={segredo}
            onChange={(e) => aoColarSegredo(e.target.value)}
            onBlur={buscarModelos}
            type="password"
            placeholder={`${meta.prefixo}...`}
            autoComplete="off"
            spellCheck={false}
            className="rounded border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-theme"
          />
          <input
            value={rotulo}
            onChange={(e) => setRotulo(e.target.value)}
            placeholder={`Apelido (ex: ${meta.nome} pessoal)`}
            className="rounded border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-theme"
          />
        </div>

        {modelos.length > 0 && (
          <select
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            className="w-full rounded border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-theme"
          >
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.rotulo}
                {m.gratuito ? " · grátis" : ""}
              </option>
            ))}
          </select>
        )}

        {erro && (
          <p className="rounded border border-err/40 bg-err/10 px-3 py-2 text-sm text-err">{erro}</p>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={buscarModelos}
            disabled={testando || segredo.trim().length < 12}
            className="rounded border border-line px-3 py-2 font-mono text-[0.66rem] tracking-[0.1em] text-dim transition enabled:hover:text-txt disabled:opacity-40"
          >
            {testando ? "TESTANDO..." : "TESTAR CHAVE"}
          </button>
          <button
            onClick={salvar}
            disabled={salvando || !criptografiaOk || segredo.trim().length < 12}
            className="rounded border border-theme/50 bg-theme/12 px-4 py-2 font-mono text-[0.66rem] tracking-[0.1em] text-theme transition enabled:hover:bg-theme/20 disabled:opacity-40"
          >
            {salvando ? "SALVANDO..." : "ADICIONAR"}
          </button>
        </div>
      </div>
    </section>
  );
}
