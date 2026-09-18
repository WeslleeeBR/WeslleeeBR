import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

interface Evento {
  tipo: string;
  usuarioId?: string | null;
  detalhe?: Prisma.InputJsonValue;
}

/**
 * Registra um evento de auditoria. **Nunca lança**: log é efeito colateral, e
 * uma falha ao gravar o log não pode derrubar a operação que o gerou (nem o
 * próprio tratador de erro, que também chama esta função).
 *
 * Nada de segredo entra em `detalhe` — nem chave de API, nem senha, nem o texto
 * das memórias do usuário.
 */
export async function registrarEvento({ tipo, usuarioId, detalhe }: Evento): Promise<void> {
  try {
    await prisma.logEvento.create({
      data: { tipo, usuarioId: usuarioId ?? null, detalhe: detalhe ?? undefined },
    });
  } catch (err) {
    console.error("[beru] falha ao registrar evento:", tipo, err);
  }
}
