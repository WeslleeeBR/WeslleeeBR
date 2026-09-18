import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 não aceita mais `new PrismaClient()` sem adapter — a conexão vem de
// um driver adapter explícito. No Supabase isso significa a connection string
// do **transaction pooler** (porta 6543): cada invocação de rota no Next é uma
// conexão nova, e o Postgres do Supabase não aguenta uma conexão direta por
// requisição.
//
// Singleton em globalThis para o hot-reload do `next dev` não abrir um pool
// novo a cada recompilação e estourar o limite de conexões.

declare global {
  // eslint-disable-next-line no-var
  var __beruPrisma: PrismaClient | undefined;
}

function criarPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL não está definida. Copie a connection string do pooler (porta 6543) no painel do Supabase → Connect."
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalThis.__beruPrisma ?? criarPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__beruPrisma = prisma;
}
