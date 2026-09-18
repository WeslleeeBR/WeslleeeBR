import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

/**
 * Cria o primeiro usuário e a rede inicial de memórias — as mesmas notas que o
 * protótipo HTML trazia embutidas, agora no banco e já ligadas entre si.
 *
 * Idempotente: rodar de novo não duplica nada. Usuário existente só tem a senha
 * reposta se BERU_SENHA estiver definida.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
});

const AREAS = [
  { slug: "metas", rotulo: "Metas", cor: "#fbbf24" },
  { slug: "trabalho", rotulo: "Carreira", cor: "#ff5547" },
  { slug: "projetos", rotulo: "Projetos", cor: "#8b7cff" },
  { slug: "financas", rotulo: "Finanças", cor: "#f7931a" },
  { slug: "aprendizado", rotulo: "Aprendizado", cor: "#2dd4ff" },
  { slug: "saude", rotulo: "Saúde", cor: "#10b981" },
  { slug: "relacoes", rotulo: "Relações", cor: "#ec4899" },
  { slug: "meta", rotulo: "Perfil", cor: "#8a90a6" },
];

const MEMORIAS = [
  { area: "meta", titulo: "Perfil", corpo: "20 anos, trabalha na Zenir.", importancia: 5, fixada: true },
  { area: "metas", titulo: "Gestão Financeira", corpo: "Meta de médio prazo (2 anos): organizar e dominar a gestão financeira pessoal.", importancia: 5 },
  { area: "trabalho", titulo: "Suporte TI", corpo: "Trabalha como Suporte de TI na Zenir.", importancia: 4 },
  { area: "projetos", titulo: "Beru IA", corpo: "Projeto atual: desenvolver sua própria inteligência artificial pessoal, o Beru.", importancia: 5 },
  { area: "financas", titulo: "Estabilidade", corpo: "Objetivo financeiro: se manter financeiramente e buscar autonomia.", importancia: 4 },
  { area: "aprendizado", titulo: "Evoluir Beru", corpo: "Estudando como melhorar e evoluir o projeto Beru / IA pessoal.", importancia: 3 },
  { area: "saude", titulo: "Estável", corpo: "Saúde e rotina em dia, sem pendências no momento.", importancia: 2 },
];

const LIGACOES: [string, string][] = [
  ["Perfil", "Gestão Financeira"],
  ["Perfil", "Suporte TI"],
  ["Perfil", "Beru IA"],
  ["Perfil", "Estável"],
  ["Gestão Financeira", "Estabilidade"],
  ["Gestão Financeira", "Suporte TI"],
  ["Gestão Financeira", "Evoluir Beru"],
  ["Suporte TI", "Beru IA"],
  ["Beru IA", "Evoluir Beru"],
  ["Estabilidade", "Estável"],
];

function chaveDe(titulo: string) {
  return titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const username = (process.env.BERU_USERNAME ?? "weslle").toLowerCase();
  const senha = process.env.BERU_SENHA;
  const nome = process.env.BERU_NOME ?? "Weslle";

  const existente = await prisma.usuario.findUnique({ where: { username } });

  if (!existente && !senha) {
    throw new Error(
      "Defina BERU_SENHA no .env para criar o primeiro usuário (ela vira hash bcrypt, não fica em claro)."
    );
  }

  const usuario = existente
    ? senha
      ? await prisma.usuario.update({
          where: { id: existente.id },
          data: { senhaHash: await bcrypt.hash(senha, 10) },
        })
      : existente
    : await prisma.usuario.create({
        data: {
          nome,
          username,
          senhaHash: await bcrypt.hash(senha!, 10),
          tratamentos: [`Senhor ${nome}`, "chefe"],
          persona: {
            nome: "Beru",
            estilo: "formal_descontraido",
            corTema: "#00d4ff",
            wakeWord: "ei beru",
            voz: "masculina",
          },
        },
      });

  console.log(`✓ usuário ${usuario.username}`);

  for (const [i, area] of AREAS.entries()) {
    await prisma.area.upsert({
      where: { usuarioId_slug: { usuarioId: usuario.id, slug: area.slug } },
      update: {},
      create: { ...area, usuarioId: usuario.id, ordem: i },
    });
  }
  console.log(`✓ ${AREAS.length} áreas`);

  const areas = await prisma.area.findMany({ where: { usuarioId: usuario.id } });
  const idDaArea = new Map(areas.map((a) => [a.slug, a.id]));

  for (const memoria of MEMORIAS) {
    await prisma.memoria.upsert({
      where: { usuarioId_chave: { usuarioId: usuario.id, chave: chaveDe(memoria.titulo) } },
      update: {},
      create: {
        usuarioId: usuario.id,
        areaId: idDaArea.get(memoria.area) ?? null,
        titulo: memoria.titulo,
        chave: chaveDe(memoria.titulo),
        corpo: memoria.corpo,
        importancia: memoria.importancia,
        fixada: memoria.fixada ?? false,
        origem: "IMPORTACAO",
      },
    });
  }
  console.log(`✓ ${MEMORIAS.length} memórias`);

  const memorias = await prisma.memoria.findMany({ where: { usuarioId: usuario.id } });
  const idPorChave = new Map(memorias.map((m) => [m.chave, m.id]));

  let ligacoes = 0;
  for (const [a, b] of LIGACOES) {
    const origemId = idPorChave.get(chaveDe(a));
    const destinoId = idPorChave.get(chaveDe(b));
    if (!origemId || !destinoId) continue;

    const existe = await prisma.conexao.findFirst({
      where: {
        OR: [
          { origemId, destinoId },
          { origemId: destinoId, destinoId: origemId },
        ],
      },
    });
    if (existe) continue;

    await prisma.conexao.create({ data: { usuarioId: usuario.id, origemId, destinoId } });
    ligacoes++;
  }
  console.log(`✓ ${ligacoes} ligações novas`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
