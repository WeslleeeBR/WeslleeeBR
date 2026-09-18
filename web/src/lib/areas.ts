/**
 * Áreas padrão da second brain — as mesmas cores do protótipo HTML do Beru.
 *
 * Isto é só a semente: as áreas viram linhas na tabela `Area` no primeiro
 * acesso do usuário, e a partir daí ele renomeia, recolore e cria as próprias.
 * Arquivo sem "server-only" de propósito — o grafo no client também usa as
 * cores como fallback.
 */
export interface AreaPadrao {
  slug: string;
  rotulo: string;
  cor: string;
}

export const AREAS_PADRAO: AreaPadrao[] = [
  { slug: "metas", rotulo: "Metas", cor: "#fbbf24" },
  { slug: "trabalho", rotulo: "Carreira", cor: "#ff5547" },
  { slug: "projetos", rotulo: "Projetos", cor: "#8b7cff" },
  { slug: "financas", rotulo: "Finanças", cor: "#f7931a" },
  { slug: "aprendizado", rotulo: "Aprendizado", cor: "#2dd4ff" },
  { slug: "saude", rotulo: "Saúde", cor: "#10b981" },
  { slug: "relacoes", rotulo: "Relações", cor: "#ec4899" },
  { slug: "meta", rotulo: "Perfil", cor: "#8a90a6" },
];

export const COR_PADRAO_AREA = "#8a90a6";
