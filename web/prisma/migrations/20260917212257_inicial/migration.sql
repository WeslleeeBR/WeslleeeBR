-- CreateEnum
CREATE TYPE "OrigemMemoria" AS ENUM ('MANUAL', 'ASSISTENTE', 'IMPORTACAO');

-- CreateEnum
CREATE TYPE "PapelMensagem" AS ENUM ('USUARIO', 'ASSISTENTE', 'SISTEMA');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "senhaHash" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "tratamentos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "persona" JSONB,
    "ultimoLoginEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT '#00d4ff',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memorias" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "areaId" TEXT,
    "titulo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importancia" INTEGER NOT NULL DEFAULT 3,
    "fixada" BOOLEAN NOT NULL DEFAULT false,
    "origem" "OrigemMemoria" NOT NULL DEFAULT 'MANUAL',
    "origemConversaId" TEXT,
    "ultimoAcessoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conexoes" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "origemId" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,
    "tipo" TEXT,
    "peso" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "criadaPeloAssistente" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conexoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversas" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL DEFAULT 'Nova conversa',
    "arquivada" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "papel" "PapelMensagem" NOT NULL,
    "conteudo" TEXT NOT NULL,
    "provedor" TEXT,
    "modelo" TEXT,
    "latenciaMs" INTEGER,
    "memoriasUsadas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chaves_ia" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "segredoCifrado" TEXT NOT NULL,
    "final4" TEXT NOT NULL,
    "modelo" TEXT,
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ultimoErro" TEXT,
    "ultimoUsoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chaves_ia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_eventos" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "usuarioId" TEXT,
    "detalhe" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_username_key" ON "usuarios"("username");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "areas_usuarioId_idx" ON "areas"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "areas_usuarioId_slug_key" ON "areas"("usuarioId", "slug");

-- CreateIndex
CREATE INDEX "memorias_usuarioId_areaId_idx" ON "memorias"("usuarioId", "areaId");

-- CreateIndex
CREATE INDEX "memorias_usuarioId_atualizadoEm_idx" ON "memorias"("usuarioId", "atualizadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "memorias_usuarioId_chave_key" ON "memorias"("usuarioId", "chave");

-- CreateIndex
CREATE INDEX "conexoes_usuarioId_idx" ON "conexoes"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "conexoes_origemId_destinoId_key" ON "conexoes"("origemId", "destinoId");

-- CreateIndex
CREATE INDEX "conversas_usuarioId_atualizadoEm_idx" ON "conversas"("usuarioId", "atualizadoEm");

-- CreateIndex
CREATE INDEX "mensagens_conversaId_criadoEm_idx" ON "mensagens"("conversaId", "criadoEm");

-- CreateIndex
CREATE INDEX "chaves_ia_usuarioId_prioridade_idx" ON "chaves_ia"("usuarioId", "prioridade");

-- CreateIndex
CREATE INDEX "log_eventos_tipo_criadoEm_idx" ON "log_eventos"("tipo", "criadoEm");

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorias" ADD CONSTRAINT "memorias_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorias" ADD CONSTRAINT "memorias_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexoes" ADD CONSTRAINT "conexoes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexoes" ADD CONSTRAINT "conexoes_origemId_fkey" FOREIGN KEY ("origemId") REFERENCES "memorias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexoes" ADD CONSTRAINT "conexoes_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "memorias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chaves_ia" ADD CONSTRAINT "chaves_ia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
