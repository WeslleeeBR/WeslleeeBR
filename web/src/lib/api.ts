import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { registrarEvento } from "@/lib/log";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "ERRO") {
    super(message);
    this.status = status;
    this.code = code;
  }

  static naoAutenticado(msg = "Você precisa estar autenticado.") {
    return new ApiError(401, msg, "NAO_AUTENTICADO");
  }

  static semPermissao(msg = "Você não tem permissão para fazer isso.") {
    return new ApiError(403, msg, "SEM_PERMISSAO");
  }

  static naoEncontrado(msg = "Registro não encontrado.") {
    return new ApiError(404, msg, "NAO_ENCONTRADO");
  }
}

// Rótulos amigáveis dos campos — transformam o erro do Zod numa frase que diz
// o que corrigir ("Senha: mínimo de 8 caracteres.") em vez de "Dados inválidos".
const ROTULOS_CAMPO: Record<string, string> = {
  nome: "Nome",
  username: "Usuário",
  senha: "Senha",
  novaSenha: "Nova senha",
  email: "E-mail",
  titulo: "Título",
  corpo: "Conteúdo",
  area: "Área",
  areaId: "Área",
  tags: "Tags",
  importancia: "Importância",
  mensagem: "Mensagem",
  provedor: "Provedor",
  rotulo: "Apelido da chave",
  segredo: "Chave de API",
  modelo: "Modelo",
};

function mensagemDeValidacao(err: ZodError): string {
  const partes = err.issues.map((issue) => {
    const campos = issue.path.filter((p) => typeof p === "string") as string[];
    const campo = campos[campos.length - 1];
    const rotulo = campo ? ROTULOS_CAMPO[campo] ?? campo : undefined;
    return rotulo ? `${rotulo}: ${issue.message}` : issue.message;
  });
  const unicas = Array.from(new Set(partes)).slice(0, 4);
  return unicas.length ? unicas.join(" ") : "Dados inválidos.";
}

type RouteHandler<Args extends unknown[]> = (...args: Args) => Promise<Response>;

/**
 * Envolve um route handler com tratamento de erro padronizado:
 * - ApiError vira JSON com o status/código que ela já carrega.
 * - ZodError vira 400 com a mensagem de validação legível.
 * - Qualquer outro erro é logado (ERRO_API) e respondido como 500 genérico —
 *   detalhe de erro inesperado não vai para o cliente.
 *
 * Genérico sobre a TUPLA de argumentos: o mesmo wrapper serve tanto para
 * `(request) => ...` quanto para `(request, { params }) => ...`, mantendo o
 * tipo exato que o Next espera em cada caso.
 */
export function comTratamentoDeErro<Args extends unknown[]>(
  handler: RouteHandler<Args>
): RouteHandler<Args> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: mensagemDeValidacao(err), code: "VALIDACAO", detalhes: err.issues },
          { status: 400 }
        );
      }

      console.error("[beru] erro inesperado em rota da API:", err);
      await registrarEvento({
        tipo: "ERRO_API",
        detalhe: { mensagem: err instanceof Error ? err.message : String(err) },
      });

      return NextResponse.json(
        { error: "Erro interno. Tente novamente em alguns instantes.", code: "ERRO_INTERNO" },
        { status: 500 }
      );
    }
  };
}
