import { NextResponse, type NextRequest } from "next/server";
import { verificarSessao } from "@/lib/auth";
import { NOMES_COOKIE_SESSAO } from "@/lib/session";

// proxy.ts substitui o middleware.ts a partir do Next.js 16 — roda em runtime
// Node e fica com as tarefas leves de borda. A checagem fina (usuário ainda
// existe? conta ativa?) continua no layout e nas rotas, contra o banco.
//
// REGRA DA CASA: **nega por padrão.** Este arquivo lista o que é PÚBLICO; tudo
// o mais exige sessão. Assim uma página ou rota nova nasce protegida — o
// esquecimento erra para o lado seguro.

/**
 * Páginas públicas, por igualdade exata. É uma só: não há cadastro no Beru —
 * a conta do dono nasce pelo seed.
 */
const PAGINAS_PUBLICAS = new Set(["/login"]);

/**
 * As únicas rotas de API abertas: exatamente as que não chamam `exigirUsuario`.
 * O logout entra por ser idempotente — quem está com o token expirado precisa
 * conseguir limpar o cookie.
 */
const APIS_PUBLICAS = new Set(["/api/v1/auth/login", "/api/v1/auth/logout"]);

const METODOS_MUTANTES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function ehPublica(pathname: string): boolean {
  if (pathname.startsWith("/api/")) {
    return APIS_PUBLICAS.has(pathname) || APIS_PUBLICAS.has(pathname.replace(/\/$/, ""));
  }
  return PAGINAS_PUBLICAS.has(pathname);
}

/** Sessão da requisição: cookie (web) ou `Authorization: Bearer` (app Android). */
async function sessaoDaRequisicao(request: NextRequest) {
  for (const nome of NOMES_COOKIE_SESSAO) {
    const valor = request.cookies.get(nome)?.value;
    if (valor) {
      const sessao = await verificarSessao(valor);
      if (sessao) return sessao;
    }
  }
  const autorizacao = request.headers.get("authorization");
  if (autorizacao?.toLowerCase().startsWith("bearer ")) {
    return verificarSessao(autorizacao.slice(7).trim());
  }
  return null;
}

/**
 * Anti-CSRF: uma requisição mutante feita pelo navegador SEMPRE manda `Origin`
 * (o Fetch obriga em tudo que não é GET/HEAD). Se o `Origin` não for o do
 * próprio site, a chamada veio de outra página — recusamos.
 *
 * Quem manda `Authorization: Bearer` (o app Expo) é dispensado: não usa cookie,
 * então não há como um site terceiro forjar a chamada em nome do usuário.
 */
function origemConfiavel(request: NextRequest): boolean {
  const bruta = request.headers.get("origin") ?? request.headers.get("referer");
  if (!bruta) return false;
  try {
    const origem = new URL(bruta);
    const host = request.headers.get("host");
    return !!host && origem.host === host;
  } catch {
    return false;
  }
}

/** Destino seguro pós-login: só caminho interno, nunca URL absoluta. */
function destinoInterno(valor: string | null): string {
  if (!valor || !valor.startsWith("/") || valor.startsWith("//")) return "/";
  return valor;
}

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const ehApi = pathname.startsWith("/api/");

  // 1) CSRF antes de tudo — vale inclusive para as APIs públicas (o login) e
  //    para rotas que ainda nem existem.
  if (ehApi && METODOS_MUTANTES.has(request.method)) {
    const temBearer = (request.headers.get("authorization") ?? "")
      .toLowerCase()
      .startsWith("bearer ");
    if (!temBearer && !origemConfiavel(request)) {
      return NextResponse.json(
        { error: "Requisição bloqueada: origem não reconhecida.", code: "ORIGEM_INVALIDA" },
        { status: 403 }
      );
    }
  }

  const sessao = await sessaoDaRequisicao(request);

  // 2) Rotas públicas seguem o fluxo — só o /login desvia quem já entrou.
  if (ehPublica(pathname)) {
    if (pathname === "/login" && sessao) {
      return NextResponse.redirect(
        new URL(destinoInterno(request.nextUrl.searchParams.get("proximo")), request.url)
      );
    }
    return NextResponse.next();
  }

  // 3) O resto exige sessão. API responde 401 em JSON (nunca redirect: o app
  //    Android receberia o HTML do login e quebraria); página vai ao login
  //    guardando para onde a pessoa queria ir.
  if (!sessao) {
    if (ehApi) {
      return NextResponse.json(
        { error: "Não autenticado.", code: "NAO_AUTENTICADO" },
        { status: 401 }
      );
    }
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("proximo", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  // 4) Conteúdo autenticado não pode ser cacheado por CDN/navegador nem
  //    indexado por buscador.
  const resposta = NextResponse.next();
  if (!ehApi) {
    resposta.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    resposta.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return resposta;
}

export const config = {
  // Tudo, menos estáticos do Next e arquivos com extensão (ícones, manifest).
  // É essa amplitude que faz o "nega por padrão" valer.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
