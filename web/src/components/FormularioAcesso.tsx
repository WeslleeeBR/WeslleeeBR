"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ErroApi } from "@/lib/clienteApi";

/**
 * O único jeito de entrar no Beru.
 *
 * Não existe cadastro: o Beru é de um dono só, e a conta nasce pelo seed
 * (`npm run db:seed`). Sem tela de criar conta, a superfície exposta na
 * internet é uma porta só — e essa porta tem trava de tentativas.
 */
export function FormularioAcesso({ proximo }: { proximo?: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;

    const dados = new FormData(evento.currentTarget);
    setEnviando(true);
    setErro(null);

    try {
      await api.post("/api/v1/auth/login", {
        username: String(dados.get("username") ?? ""),
        senha: String(dados.get("senha") ?? ""),
      });

      // `refresh()` antes do push: o layout do servidor precisa reler a sessão,
      // senão a área logada renderiza com o usuário ainda nulo.
      router.refresh();
      router.push(proximo && proximo.startsWith("/") ? proximo : "/");
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : "Algo deu errado. Tente de novo.");
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={aoEnviar} className="painel faixa-topo relative space-y-4 p-6">
      <Campo nome="username" rotulo="Usuário" autoComplete="username" autoFocus />
      <Campo nome="senha" rotulo="Senha" type="password" autoComplete="current-password" />

      {erro && (
        <p className="surgindo rounded border border-err/40 bg-err/10 px-3 py-2 text-sm text-err">
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="brilho-theme mt-2 w-full rounded bg-linear-to-r from-theme to-violet px-4 py-3 font-mono text-sm font-semibold tracking-[0.14em] text-bg transition enabled:hover:-translate-y-px disabled:opacity-60"
      >
        {enviando ? "CONECTANDO..." : "ENTRAR"}
      </button>
    </form>
  );
}

function Campo({
  nome,
  rotulo,
  type = "text",
  autoComplete,
  autoFocus,
}: {
  nome: string;
  rotulo: string;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[0.65rem] tracking-[0.18em] text-dim uppercase">
        {rotulo}
      </span>
      <input
        name={nome}
        type={type}
        required
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
        className="w-full rounded border border-line bg-panel2 px-3 py-2.5 text-txt outline-none transition focus:border-theme focus:ring-1 focus:ring-theme/40"
      />
    </label>
  );
}
