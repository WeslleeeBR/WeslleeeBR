import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Cifra simétrica para segredos que precisam voltar em claro no servidor —
 * hoje, as chaves de API dos provedores de IA (`ChaveIA.segredoCifrado`).
 *
 * Senha de usuário NÃO passa por aqui: aquilo é hash de mão única (bcrypt, ver
 * src/lib/auth.ts). Isto é o caso oposto: precisamos do valor original para
 * chamar a API do provedor, então tem de ser reversível.
 *
 * AES-256-GCM: além de cifrar, autentica. Um byte alterado no banco faz a
 * decifragem falhar em vez de devolver lixo silenciosamente.
 *
 * O ponto central: **o material de chave nunca fica no banco.** Ele vem do
 * ambiente. Um dump do Postgres, sozinho, não devolve segredo nenhum.
 */

const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12; // 96 bits, o recomendado para GCM
const TAMANHO_CHAVE = 32; // AES-256
const SAL = "beru:chaves-ia:v1";

/** Marca a versão do formato: permite trocar o esquema sem quebrar o que existe. */
const PREFIXO = "v1";

let chaveEmCache: Buffer | null = null;

/**
 * Deriva a chave de 32 bytes.
 *
 * Preferência para `BERU_CRYPTO_KEY` (dedicada, rotacionável sem invalidar
 * sessões). Sem ela, deriva de `JWT_SECRET` — assim o app sobe sem configuração
 * extra, ao custo de amarrar as duas coisas. Sem nenhuma das duas, falha
 * fechado: melhor não gravar nada do que gravar com chave previsível.
 */
function obterChave(): Buffer {
  if (chaveEmCache) return chaveEmCache;

  const dedicada = process.env.BERU_CRYPTO_KEY;
  if (dedicada && dedicada.length >= 32) {
    // scrypt normaliza qualquer entrada para 32 bytes — aceita string longa,
    // base64 ou hex, sem exigir formato de quem configura.
    chaveEmCache = scryptSync(dedicada, SAL, TAMANHO_CHAVE);
    return chaveEmCache;
  }

  const jwt = process.env.JWT_SECRET;
  if (jwt && jwt.length >= 16) {
    chaveEmCache = scryptSync(jwt, SAL, TAMANHO_CHAVE);
    return chaveEmCache;
  }

  throw new Error(
    "Defina BERU_CRYPTO_KEY (ou ao menos JWT_SECRET) para guardar chaves de API cifradas."
  );
}

/** Há como cifrar neste ambiente? A UI avisa antes de deixar o usuário tentar. */
export function criptografiaDisponivel(): boolean {
  try {
    obterChave();
    return true;
  } catch {
    return false;
  }
}

/** Cifra um segredo. Formato: `v1.<iv>.<tag>.<dados>`, tudo em base64url. */
export function cifrar(texto: string): string {
  const chave = obterChave();
  const iv = randomBytes(TAMANHO_IV);
  const cipher = createCipheriv(ALGORITMO, chave, iv);
  const dados = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIXO,
    iv.toString("base64url"),
    tag.toString("base64url"),
    dados.toString("base64url"),
  ].join(".");
}

/**
 * Decifra. Devolve null quando o valor está corrompido, foi adulterado ou foi
 * cifrado com outra chave (ex.: BERU_CRYPTO_KEY rotacionada) — quem chama trata
 * como "chave indisponível" e segue para a próxima, em vez de estourar.
 */
export function decifrar(valor: string): string | null {
  try {
    const partes = valor.split(".");
    if (partes.length !== 4 || partes[0] !== PREFIXO) return null;
    const [, ivB64, tagB64, dadosB64] = partes;

    const decipher = createDecipheriv(ALGORITMO, obterChave(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dadosB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Inclui a falha de autenticação do GCM (dado adulterado). Silencioso de
    // propósito: a mensagem do erro não pode virar oráculo para quem sonda.
    return null;
  }
}

/** Comparação em tempo constante — evita vazar segredo por timing. */
export function comparaSegura(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba); // gasta tempo equivalente; não vaza o tamanho
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/**
 * Máscara para exibição: `gsk_••••••1a2b`. É o ÚNICO formato em que uma chave
 * pode aparecer numa resposta de API.
 */
export function mascarar(prefixo: string, final4: string): string {
  return `${prefixo}${"•".repeat(6)}${final4}`;
}
