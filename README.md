# Beru

Assistente pessoal com memória viva. Conversa por texto ou voz, decide sozinho o
que vale guardar sobre você e organiza tudo numa rede de memórias navegável no
estilo do grafo do Obsidian.

```
weslle/
├── web/     Next.js 16 + React 19 + Prisma 7 + Supabase — a aplicação e a API
├── app/     Expo (dev client) — o Android, consumindo a mesma API
└── docs/    arquitetura e referência dos endpoints
```

## O que ele faz

- **Conversa** com rodízio entre três provedores de IA (Gemini, Groq,
  OpenRouter). Se a cota de um estoura, cai para o próximo sem interrupção.
- **Memória viva**: durante a conversa, o assistente grava o que for duradouro
  sobre você e liga essas memórias entre si. Nada disso exige comando.
- **Rede navegável**: as memórias viram um grafo dirigido a forças, com cor por
  área da vida, arrasto, zoom e edição no clique.
- **Voz**: wake word ("ei beru"), reconhecimento e resposta falada no navegador.
- **De um dono só**: login por usuário e senha (hash bcrypt), sessão em JWT, e
  nenhuma tela de cadastro — a conta nasce pelo seed. Ainda assim, todo dado
  (memória, conversa, chave) é gravado por `usuarioId`, então nada vaza entre
  contas se um dia houver mais de uma.

## Começando

### 1. Banco (Supabase)

No painel do projeto → **Connect** → aba **ORMs / Prisma**, copie as duas
connection strings. A do *transaction pooler* (porta 6543) vira `DATABASE_URL`;
a *direct connection* (porta 5432) vira `DIRECT_URL`.

### 2. Web

```bash
cd web
cp .env.example .env     # preencha DATABASE_URL, DIRECT_URL, JWT_SECRET, BERU_CRYPTO_KEY
npm install
npm run db:migrate       # cria as tabelas
npm run db:seed          # cria a sua conta + as memórias iniciais
npm run dev
```

O seed é o único caminho para criar a conta (defina `BERU_USERNAME`,
`BERU_SENHA` e `BERU_NOME` no `.env`). Trocar de senha depois é rodar o seed de
novo com outra `BERU_SENHA`.

Gere os segredos com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 3. Chaves de IA

Entre no app → **Ajustes → Chaves de IA** e cadastre pelo menos uma:

| Provedor | Onde pegar | Observação |
| --- | --- | --- |
| Google Gemini | aistudio.google.com/apikey | cota gratuita generosa |
| Groq | console.groq.com/keys | o mais rápido; limite por minuto |
| OpenRouter | openrouter.ai/keys | modelos com sufixo `:free` |

As chaves são cifradas (AES-256-GCM) antes de ir para o banco e nunca voltam
para a tela — só o final `••••1a2b`.

### 4. Android

```bash
cd app
cp .env.example .env     # EXPO_PUBLIC_API_URL apontando para a web
npm install
npx expo start --dev-client
```

## Documentação

- [docs/ARQUITETURA.md](docs/ARQUITETURA.md) — como as peças se encaixam e por quê
- [docs/endpoints.md](docs/endpoints.md) — a API v1 inteira
