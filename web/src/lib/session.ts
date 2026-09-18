import "server-only";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { verificarSessao, type SessionClaims } from "@/lib/auth";
import type { Usuario } from "@prisma/client";

/**
 * Cookie de sessão.
 *
 * Em produção usamos o prefixo `__Host-`: o navegador só grava esse cookie se
 * vier com `Secure`, `Path=/` e SEM `Domain`, o que o tranca no domínio exato.
 * Em desenvolvimento o site roda em http://localhost, onde `Secure` não vale e
 * o navegador recusaria o prefixo — por isso o nome simples continua aceito.
 * A LEITURA tenta os dois nomes, então trocar de ambiente não desloga ninguém.
 */
const COOKIE_SEGURO = process.env.NODE_ENV === "production";
const NOME_COOKIE_HOST = "__Host-beru_session";
const NOME_COOKIE_SIMPLES = "beru_session";

export const COOKIE_NAME = COOKIE_SEGURO ? NOME_COOKIE_HOST : NOME_COOKIE_SIMPLES;
export const NOMES_COOKIE_SESSAO = [NOME_COOKIE_HOST, NOME_COOKIE_SIMPLES] as const;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: COOKIE_SEGURO,
  sameSite: "lax" as const,
  path: "/",
};

export async function definirCookieSessao(token: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    ...COOKIE_OPTIONS,
    maxAge: 60 * 60 * 24 * 30, // 30 dias, em sincronia com a expiração do JWT
  });
  if (COOKIE_SEGURO) store.delete(NOME_COOKIE_SIMPLES);
}

export async function limparCookieSessao() {
  const store = await cookies();
  for (const nome of NOMES_COOKIE_SESSAO) store.delete(nome);
}

/**
 * Lê e valida o token. A web manda no cookie httpOnly; o app Android (Expo)
 * manda em `Authorization: Bearer <token>`. Tentamos o cookie e, se ausente, o
 * header — assim a mesma checagem serve aos dois clientes. Não vai ao banco.
 */
export async function obterClaimsSessao(): Promise<SessionClaims | null> {
  const store = await cookies();
  for (const nome of NOMES_COOKIE_SESSAO) {
    const token = store.get(nome)?.value;
    if (!token) continue;
    const claims = await verificarSessao(token);
    if (claims) return claims;
  }

  const cabecalhos = await headers();
  const autorizacao = cabecalhos.get("authorization");
  const tokenDoHeader = autorizacao?.toLowerCase().startsWith("bearer ")
    ? autorizacao.slice(7).trim()
    : undefined;
  return verificarSessao(tokenDoHeader);
}

export type UsuarioSemSenha = Omit<Usuario, "senhaHash">;

/**
 * Fonte da verdade para quem está logado: valida o token E busca o registro
 * atual. Quem toma decisão de autorização usa isto, não as claims soltas —
 * assim desativar uma conta tem efeito imediato, mesmo com token ainda válido.
 */
export async function usuarioAtual(): Promise<UsuarioSemSenha | null> {
  const claims = await obterClaimsSessao();
  if (!claims) return null;

  const usuario = await prisma.usuario.findUnique({ where: { id: claims.sub } });
  if (!usuario || !usuario.ativo) return null;

  const { senhaHash: _senhaHash, ...resto } = usuario;
  return resto;
}

/** Versão para rotas de API: lança 401 em vez de devolver null. */
export async function exigirUsuario(): Promise<UsuarioSemSenha> {
  const usuario = await usuarioAtual();
  if (!usuario) throw ApiError.naoAutenticado();
  return usuario;
}
