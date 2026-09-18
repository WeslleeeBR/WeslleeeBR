import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const SALT_ROUNDS = 10;
const TOKEN_TTL = "30d";

/**
 * Senha nunca é guardada — só o hash bcrypt, que é de mão única. O custo 10
 * deixa a verificação em ~100ms, caro o suficiente para tornar um ataque de
 * dicionário impraticável e barato o suficiente para o login não travar.
 */
export async function hashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, SALT_ROUNDS);
}

export async function verificarSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

export interface SessionClaims extends JWTPayload {
  sub: string;
  username: string;
  nome: string;
}

function obterChaveSecreta(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "JWT_SECRET não está definido (ou é muito curto). Gere uma string aleatória longa e coloque no .env."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function assinarSessao(claims: Omit<SessionClaims, keyof JWTPayload>): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(obterChaveSecreta());
}

/**
 * Verifica e decodifica o token. Devolve `null` em qualquer cenário de token
 * ausente, expirado ou inválido — nunca lança, para simplificar quem chama
 * (middleware, layouts, rotas).
 */
export async function verificarSessao(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, obterChaveSecreta());
    return payload as SessionClaims;
  } catch {
    return null;
  }
}
