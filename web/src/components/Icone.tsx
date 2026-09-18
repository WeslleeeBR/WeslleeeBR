/**
 * Ícones em SVG inline, herdando `currentColor`.
 *
 * Sem biblioteca: são poucos, e uma dependência de ícones custaria mais
 * kilobytes no bundle do que o arquivo inteiro. Traço de 1.6 para casar com o
 * peso da tipografia mono da interface.
 */
export type NomeIcone =
  | "orb"
  | "rede"
  | "nota"
  | "ajustes"
  | "sair"
  | "microfone"
  | "enviar"
  | "parar"
  | "mais"
  | "recarregar"
  | "lixeira"
  | "chave"
  | "alfinete"
  | "fechar"
  | "raio";

const CAMINHOS: Record<NomeIcone, React.ReactNode> = {
  orb: (
    <>
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="9" opacity="0.45" />
    </>
  ),
  rede: (
    <>
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="17" r="2" />
      <circle cx="19" cy="17" r="2" />
      <path d="M12 7v4m0 0-5 4m5-4 5 4" />
    </>
  ),
  nota: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h4" />
    </>
  ),
  ajustes: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1m0-14.2-2.1 2.1m-10 10-2.1 2.1" />
    </>
  ),
  sair: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>
  ),
  microfone: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </>
  ),
  enviar: <path d="m4 12 16-8-6 8 6 8z" />,
  parar: <rect x="6" y="6" width="12" height="12" rx="2" />,
  mais: <path d="M12 5v14M5 12h14" />,
  recarregar: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </>
  ),
  lixeira: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  chave: (
    <>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9l-2 3m-3-3v3" />
    </>
  ),
  alfinete: <path d="M12 3v7m0 0-4 4h8l-4-4Zm0 7v8" />,
  fechar: <path d="M6 6l12 12M18 6 6 18" />,
  raio: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
};

export function Icone({
  nome,
  className = "h-5 w-5",
}: {
  nome: NomeIcone;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {CAMINHOS[nome]}
    </svg>
  );
}
