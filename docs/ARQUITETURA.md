# Arquitetura

## Visão geral

```
         ┌──────────────┐        ┌──────────────┐
         │   web (Next) │        │  app (Expo)  │
         │  React 19    │        │   Android    │
         └──────┬───────┘        └──────┬───────┘
                │ cookie httpOnly        │ Authorization: Bearer
                └───────────┬────────────┘
                            ▼
                   /api/v1  (Route Handlers)
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
        Prisma 7 + pooler        provedores de IA
        (Supabase Postgres)   Gemini · Groq · OpenRouter
```

Um único backend serve os dois clientes. A diferença está só em como a sessão
viaja: a web usa cookie `httpOnly` (imune a XSS), o Android manda o mesmo JWT no
header `Authorization`. `obterClaimsSessao()` aceita os dois, então nenhuma rota
precisa saber de onde veio a chamada.

## Camadas

| Camada | Onde | Responsabilidade |
| --- | --- | --- |
| Rotas | `web/src/app/api/v1/**` | validar entrada (Zod), autorizar, traduzir para HTTP |
| Domínio | `web/src/lib/*.ts` | memória, IA, chaves, sessão — onde as regras moram |
| Dados | `web/prisma/schema.prisma` | Postgres no Supabase |

Regra que vale em todo lugar: **rota não fala com o banco direto quando existe
uma função de domínio**. É o que mantém o app Android e a web com o mesmo
comportamento sem duplicar lógica.

## Decisões que valem explicação

### Prisma com driver adapter e duas URLs

O Supabase expõe o Postgres por um pooler (pgbouncer, porta 6543) e direto
(5432). Cada requisição no Next é uma conexão nova, então o runtime **precisa**
do pooler — conexão direta esgota o limite do projeto em minutos. Mas o pooler
em modo transaction não aceita o DDL que o `prisma migrate` emite; por isso a
CLI usa `DIRECT_URL` (ver `prisma.config.ts`).

### Senha com bcrypt, chave de API com AES-256-GCM

São problemas opostos e o código trata como tal. Senha é hash de mão única — não
existe caminho de volta nem para nós. Chave de API precisa voltar em claro para
chamar o provedor, então é cifra reversível, com o material de chave **só no
ambiente**: um dump do banco, sozinho, não devolve segredo nenhum.

### Protocolo de memória em texto, não function calling

O assistente grava memória escrevendo `[[SAVE:area|titulo|texto]]` no fim da
resposta; o servidor extrai, aplica e remove antes de mostrar. Function calling
seria mais elegante, mas cada provedor implementa de um jeito e os modelos
gratuitos suportam mal. O formato em texto funciona igual nos três e degrada
bem: erro de formato custa uma anotação perdida, nunca a resposta.

### Deduplicação por título normalizado

Toda memória tem uma `chave` (título em minúsculas, sem acento). É a chave única
com `usuarioId`. Sem isso, "Gestão Financeira" e "gestao financeira" viravam dois
nós no grafo — o modelo escreve o título de um jeito levemente diferente a cada
conversa.

### Rodízio de chaves

`chavesParaUso()` devolve a fila ordenada por prioridade e o orquestrador tenta
uma por uma, em **duas passadas**: a primeira tenta todas; se as falhas foram
transitórias (cota do minuto, 503 de alta demanda, timeout), espera 1,5s e
repete só essas. Com uma única chave cadastrada, "cair para a próxima" não
existe — a segunda passada é o que segura o assistente de pé.

O erro é classificado em três, e cada um leva a uma ação diferente:

| Erro | O que significa | O que o código faz |
| --- | --- | --- |
| 401/403, ou "API key not valid" | a chave morreu | desativa a chave |
| 404 (ou "model not found") | o MODELO sumiu, a chave está boa | troca de modelo e grava o novo |
| 429/5xx/timeout | passageiro | mantém ativa e tenta de novo |

A distinção não é preciosismo: o Gemini responde **400 tanto para chave inválida
quanto para payload malformado**, e tratar os dois como "chave recusada"
desativava uma chave perfeitamente boa por um erro nosso. Só a mensagem do corpo
separa os casos.

### Modelo que apodrece

Provedores aposentam modelos sem aviso — `gemini-2.5-flash` passou a responder
404 ("no longer available to new users") com a chave ainda válida. Duas defesas:

1. O padrão é um **alias** (`gemini-flash-latest`), que acompanha a geração atual
   em vez de apontar para uma versão que vai morrer.
2. `conversarComAutoCura()` reage ao 404 listando os modelos que aquela chave
   alcança, escolhendo um (aliases primeiro, depois `flash`, `preview` por
   último) e regravando o que funcionou na chave. O mesmo vale para 503, mas aí
   a troca é só para aquela chamada: sobrecarga passa, aposentadoria não.

### Grafo em canvas, simulação própria

Repulsão entre nós, mola nas ligações, gravidade fraca ao centro, com `alfa`
decaindo até assentar. São ~120 linhas em `RedeNeural.tsx` no lugar do d3-force,
e em canvas, não SVG: um elemento de DOM por nó derruba o quadro no celular
assim que a rede passa de algumas dezenas de memórias.

## Fluxo de uma mensagem

1. `POST /api/v1/chat` valida a entrada e o limite por hora.
2. `montarPromptSistema()` junta persona + memórias (orçamento de 6000
   caracteres, fixadas primeiro) + protocolo.
3. `chamarComRodizio()` tenta as chaves em ordem.
4. `aplicarProtocolo()` grava as memórias novas e as ligações.
5. Pergunta e resposta são gravadas na conversa, com provedor, modelo e latência
   — é o que permite diagnosticar uma resposta ruim depois.
