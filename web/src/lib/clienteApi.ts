/**
 * Cliente HTTP do navegador. Existe por um motivo só: fazer toda tela tratar
 * erro do mesmo jeito.
 *
 * A API responde `{ error, code }` em qualquer falha (ver src/lib/api.ts), e
 * aqui isso vira uma exceção com a mensagem já pronta para mostrar — em vez de
 * cada componente ter que lembrar de checar `res.ok` e cavar o JSON.
 */

export class ErroApi extends Error {
  status: number;
  code: string;

  constructor(status: number, mensagem: string, code = "ERRO") {
    super(mensagem);
    this.status = status;
    this.code = code;
  }
}

async function requisitar<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ErroApi(0, "Sem conexão com o servidor.", "SEM_REDE");
  }

  if (res.status === 204) return undefined as T;

  const texto = await res.text();
  const json = texto ? (JSON.parse(texto) as unknown) : null;

  if (!res.ok) {
    const corpo = (json ?? {}) as { error?: string; code?: string };
    throw new ErroApi(res.status, corpo.error ?? "Não foi possível completar a ação.", corpo.code);
  }

  return json as T;
}

export const api = {
  get: <T>(url: string) => requisitar<T>(url),
  post: <T>(url: string, corpo?: unknown) =>
    requisitar<T>(url, { method: "POST", body: JSON.stringify(corpo ?? {}) }),
  patch: <T>(url: string, corpo: unknown) =>
    requisitar<T>(url, { method: "PATCH", body: JSON.stringify(corpo) }),
  delete: <T>(url: string) => requisitar<T>(url, { method: "DELETE" }),
};
