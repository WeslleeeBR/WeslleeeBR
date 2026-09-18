"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/clienteApi";
import { cn } from "@/lib/utils";
import { Icone, type NomeIcone } from "@/components/Icone";

const ITENS: { href: string; rotulo: string; icone: NomeIcone }[] = [
  { href: "/", rotulo: "Conversa", icone: "orb" },
  { href: "/rede", rotulo: "Rede", icone: "rede" },
  { href: "/memorias", rotulo: "Memórias", icone: "nota" },
  { href: "/configuracoes", rotulo: "Ajustes", icone: "ajustes" },
];

/**
 * Topo no desktop, barra inferior no celular. A mesma lista nos dois — o app
 * é usado muito mais no telefone do que no computador, e alcançar o topo da
 * tela com o polegar é ruim.
 */
export function NavPrincipal({
  nomeAssistente,
  nomeUsuario,
}: {
  nomeAssistente: string;
  nomeUsuario: string;
}) {
  const caminho = usePathname();
  const router = useRouter();

  const ativo = (href: string) => (href === "/" ? caminho === "/" : caminho.startsWith(href));

  async function sair() {
    await api.post("/api/v1/auth/logout");
    router.refresh();
    router.push("/login");
  }

  return (
    <>
      <header className="vidro sticky top-0 z-30 flex items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Icone nome="orb" className="h-5 w-5 text-theme" />
          <span className="font-mono text-sm font-bold tracking-[0.14em] text-theme">
            {nomeAssistente.toUpperCase()}
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {ITENS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded px-3 py-1.5 font-mono text-xs tracking-[0.1em] transition",
                ativo(item.href)
                  ? "bg-theme/12 text-theme"
                  : "text-dim hover:bg-panel2 hover:text-txt"
              )}
            >
              {item.rotulo.toUpperCase()}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-dim sm:block">{nomeUsuario}</span>
          <button
            onClick={sair}
            title="Sair"
            className="rounded border border-line p-1.5 text-dim transition hover:border-err/50 hover:text-err"
          >
            <Icone nome="sair" className="h-4 w-4" />
          </button>
        </div>
      </header>

      <nav className="vidro fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 md:hidden">
        {ITENS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-1 py-2.5 text-[0.6rem] tracking-[0.1em] transition",
              ativo(item.href) ? "text-theme" : "text-dim"
            )}
          >
            <Icone nome={item.icone} className="h-5 w-5" />
            {item.rotulo.toUpperCase()}
          </Link>
        ))}
      </nav>
    </>
  );
}
