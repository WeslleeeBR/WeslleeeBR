import "dotenv/config";
import { defineConfig } from "prisma/config";

// Usado apenas pela CLI do Prisma (migrate, studio, db push). O app em runtime
// NÃO passa por aqui — ele conecta via driver adapter em src/lib/prisma.ts.
//
// No Supabase existem duas connection strings (painel → Connect):
//   • Transaction pooler (porta 6543) → DATABASE_URL, usada pelo app.
//   • Direct connection (porta 5432)  → DIRECT_URL, usada pelas migrations.
// Migration por pooler falha: o pgbouncer em modo transaction não aceita os
// comandos de DDL com prepared statements que o migrate emite.
//
// `process.env.DIRECT_URL` direto (e não o helper `env()` do Prisma) de
// propósito: o helper estoura já no carregamento do arquivo se a variável não
// existir, e este arquivo é lido por QUALQUER comando da CLI — inclusive
// `prisma generate`, que roda no postinstall e nem conecta no banco.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DIRECT_URL ?? "",
  },
});
