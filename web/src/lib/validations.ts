import { z } from "zod";

/**
 * Toda entrada que vem de fora passa por aqui antes de tocar o banco. As
 * mensagens são escritas para o usuário final ler na tela, não para o dev.
 */

// Não existe schema de cadastro: o Beru é de um dono só e a conta é criada
// pelo seed (prisma/seed.ts), nunca por um endpoint exposto.
export const loginSchema = z.object({
  username: z.string().trim().min(3, "informe seu usuário.").max(80),
  senha: z.string().min(1, "informe sua senha."),
});

export const perfilSchema = z.object({
  nome: z.string().trim().min(2).max(80).optional(),
  email: z.union([z.string().trim().email("e-mail inválido."), z.literal("")]).optional(),
  tratamentos: z.array(z.string().trim().min(1).max(40)).max(4).optional(),
  persona: z
    .object({
      nome: z.string().trim().min(1).max(30).optional(),
      corTema: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "use uma cor no formato #00d4ff.")
        .optional(),
      estilo: z.enum(["formal_descontraido", "formal", "direto", "amigavel"]).optional(),
      wakeWord: z.string().trim().max(30).optional(),
      voz: z.enum(["masculina", "feminina", "sistema"]).optional(),
    })
    .optional(),
});

export const memoriaSchema = z.object({
  titulo: z.string().trim().min(2, "mínimo de 2 caracteres.").max(80),
  corpo: z.string().trim().min(1, "escreva o conteúdo da memória.").max(4000),
  area: z.string().trim().min(1).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  importancia: z.number().int().min(1).max(5).optional(),
  fixada: z.boolean().optional(),
});

export const memoriaPatchSchema = memoriaSchema.partial();

export const conexaoSchema = z.object({
  origemId: z.string().min(1),
  destinoId: z.string().min(1),
  tipo: z.string().trim().max(40).optional(),
  peso: z.number().min(0).max(1).optional(),
});

export const chaveIaSchema = z.object({
  provedor: z.enum(["gemini", "groq", "openrouter"]),
  rotulo: z.string().trim().min(1, "dê um apelido para reconhecer a chave.").max(40),
  segredo: z.string().trim().min(12, "essa chave parece curta demais."),
  modelo: z.string().trim().max(80).optional(),
});

export const chaveIaPatchSchema = z.object({
  rotulo: z.string().trim().min(1).max(40).optional(),
  modelo: z.string().trim().max(80).nullable().optional(),
  ativa: z.boolean().optional(),
  prioridade: z.number().int().min(0).max(99).optional(),
});

export const chatSchema = z.object({
  mensagem: z.string().trim().min(1, "escreva alguma coisa.").max(4000),
  conversaId: z.string().optional(),
});

/** Texto solto que o usuário cola para o Beru distribuir em memórias. */
export const distribuirSchema = z.object({
  texto: z.string().trim().min(10, "escreva um pouco mais para eu distribuir.").max(6000),
});
