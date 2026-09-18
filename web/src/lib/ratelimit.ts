import "server-only";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

/**
 * Rate limit apoiado na própria tabela de log — sem Redis, sem serviço extra.
 * Contamos eventos recentes que casam com um campo do `detalhe` (ip, username).
 *
 * Aguenta o caso real aqui: tentativa de força bruta no login de um app
 * pessoal. Não substitui um limitador de borda para tráfego alto.
 */
export async function contarEventos(
  tipo: string,
  campo: string,
  valor: string,
  janelaMs: number
): Promise<number> {
  const desde = new Date(Date.now() - janelaMs);
  return prisma.logEvento.count({
    where: {
      tipo,
      criadoEm: { gte: desde },
      detalhe: { path: [campo], equals: valor },
    },
  });
}

/**
 * IP do cliente. Atrás de proxy (Vercel, nginx) o socket é do proxy, então o
 * valor real vem do header — o primeiro da cadeia `x-forwarded-for`.
 */
export function obterIp(request: NextRequest): string {
  const encaminhado = request.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "desconhecido";
}
