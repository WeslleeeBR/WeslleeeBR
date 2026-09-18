"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ErroApi } from "@/lib/clienteApi";
import { Icone } from "@/components/Icone";

const ESTILOS = [
  { id: "formal_descontraido", rotulo: "Formal descontraído" },
  { id: "formal", rotulo: "Formal" },
  { id: "direto", rotulo: "Direto" },
  { id: "amigavel", rotulo: "Amigável" },
];

const CORES = ["#00d4ff", "#8b5cf6", "#10b981", "#fbbf24", "#ff5547", "#ec4899"];

/**
 * Quem o Beru é para este usuário: nome, cor, jeito de falar, wake word e como
 * ele chama a pessoa.
 *
 * Isso não é enfeite — tudo aqui entra no prompt (ver montarPromptSistema em
 * src/lib/ia.ts). Trocar o estilo muda de verdade o tom das respostas.
 */
export function FormularioPersona({
  usuario,
}: {
  usuario: {
    nome: string;
    email: string | null;
    tratamentos: string[];
    persona: Record<string, string>;
  };
}) {
  const router = useRouter();
  const [nome, setNome] = useState(usuario.nome);
  const [tratamentos, setTratamentos] = useState(usuario.tratamentos.join(", "));
  const [nomeAssistente, setNomeAssistente] = useState(usuario.persona.nome ?? "Beru");
  const [estilo, setEstilo] = useState(usuario.persona.estilo ?? "formal_descontraido");
  const [corTema, setCorTema] = useState(usuario.persona.corTema ?? "#00d4ff");
  const [wakeWord, setWakeWord] = useState(usuario.persona.wakeWord ?? "ei beru");
  const [voz, setVoz] = useState(usuario.persona.voz ?? "masculina");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setAviso(null);
    try {
      await api.patch("/api/v1/auth/eu", {
        nome,
        tratamentos: tratamentos
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 4),
        persona: { nome: nomeAssistente, estilo, corTema, wakeWord, voz },
      });
      setAviso("Salvo.");
      // A cor do tema é aplicada no layout do servidor — sem o refresh, ela só
      // mudaria no próximo carregamento da página.
      router.refresh();
    } catch (err) {
      setAviso(err instanceof ErroApi ? err.message : "Não consegui salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="painel faixa-topo relative p-5">
      <h2 className="flex items-center gap-2 font-mono text-sm tracking-[0.16em] text-theme">
        <Icone nome="orb" className="h-4 w-4" />
        PERSONA
      </h2>
      <p className="mt-1.5 text-xs text-dim">
        Tudo daqui entra no prompt: o jeito de falar, como ele te chama e o nome que responde.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Campo rotulo="SEU NOME" valor={nome} aoMudar={setNome} />
        <Campo
          rotulo="COMO ELE TE CHAMA"
          valor={tratamentos}
          aoMudar={setTratamentos}
          dica="separe por vírgula — ele alterna entre as formas"
        />
        <Campo rotulo="NOME DO ASSISTENTE" valor={nomeAssistente} aoMudar={setNomeAssistente} />
        <Campo
          rotulo="PALAVRA DE ATIVAÇÃO"
          valor={wakeWord}
          aoMudar={setWakeWord}
          dica="dita no microfone para acordar o assistente"
        />

        <label className="block">
          <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] text-dim">
            ESTILO
          </span>
          <select
            value={estilo}
            onChange={(e) => setEstilo(e.target.value)}
            className="w-full rounded border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-theme"
          >
            {ESTILOS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.rotulo}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] text-dim">
            VOZ
          </span>
          <select
            value={voz}
            onChange={(e) => setVoz(e.target.value)}
            className="w-full rounded border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-theme"
          >
            <option value="masculina">Masculina</option>
            <option value="feminina">Feminina</option>
            <option value="sistema">Padrão do sistema</option>
          </select>
        </label>
      </div>

      <div className="mt-4">
        <span className="mb-2 block font-mono text-[0.62rem] tracking-[0.18em] text-dim">
          COR DE DESTAQUE
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {CORES.map((cor) => (
            <button
              key={cor}
              onClick={() => setCorTema(cor)}
              style={{ background: cor }}
              className={`h-7 w-7 rounded-full transition ${
                corTema === cor ? "ring-2 ring-white/80 ring-offset-2 ring-offset-panel" : ""
              }`}
              aria-label={cor}
            />
          ))}
          <input
            type="color"
            value={corTema}
            onChange={(e) => setCorTema(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent"
          />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded border border-theme/50 bg-theme/12 px-4 py-2 font-mono text-[0.66rem] tracking-[0.1em] text-theme transition enabled:hover:bg-theme/20 disabled:opacity-40"
        >
          {salvando ? "SALVANDO..." : "SALVAR"}
        </button>
        {aviso && <span className="text-sm text-dim">{aviso}</span>}
      </div>
    </section>
  );
}

function Campo({
  rotulo,
  valor,
  aoMudar,
  dica,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  dica?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[0.62rem] tracking-[0.18em] text-dim">
        {rotulo}
      </span>
      <input
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="w-full rounded border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-theme"
      />
      {dica && <span className="mt-1 block text-[0.68rem] text-dim/80">{dica}</span>}
    </label>
  );
}
