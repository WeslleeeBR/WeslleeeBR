import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O client do Prisma e o adapter do Postgres precisam ser resolvidos em
  // runtime a partir de node_modules — empacotá-los no bundle do servidor
  // quebra o carregamento do engine nativo.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
};

export default nextConfig;
