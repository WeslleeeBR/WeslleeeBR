# API v1

Base: `/api/v1`. Tudo em JSON. Erro sempre no mesmo formato:

```json
{ "error": "Mensagem pronta para mostrar ao usuário.", "code": "CODIGO" }
```

Autenticação: cookie `httpOnly` (web) **ou** `Authorization: Bearer <token>`
(app Android). O token vem no corpo do login e do cadastro.

## Sessão

| Método | Rota | O que faz |
| --- | --- | --- |
| POST | `/auth/login` | `{ username, senha }` → `{ id, nome, username, token }`. Aceita e-mail no lugar do usuário. Limite: 10 falhas/IP e 5/conta a cada 10 min. |
| POST | `/auth/logout` | Limpa o cookie. |

Não existe rota de cadastro: o Beru é de um dono só, e a conta é criada pelo
seed (`npm run db:seed`).
| GET | `/auth/eu` | O usuário atual, sem o hash da senha. |
| PATCH | `/auth/eu` | `{ nome?, email?, tratamentos?, persona? }`. `persona` é mesclada, não substituída. |

## Conversa

| Método | Rota | O que faz |
| --- | --- | --- |
| POST | `/chat` | `{ mensagem, conversaId? }` → `{ conversaId, texto, provedor, modelo, latenciaMs, acoes }`. `?voz=1` pede resposta curta, sem markdown. Limite: 60 mensagens/hora. |
| GET | `/conversas` | Últimas 30 conversas. |
| GET | `/conversas?id=<id>` | Uma conversa com as mensagens. |
| DELETE | `/conversas?id=<id>` | Apaga a conversa (as memórias gravadas nela ficam). |

`acoes` é o que o assistente mexeu na memória durante a resposta:
`[{ tipo: "salvou" \| "ligou", titulo, memoriaId? }]`.

Códigos próprios: `SEM_CHAVE` (428, nenhuma chave cadastrada) e
`PROVEDORES_INDISPONIVEIS` (502, todos falharam — a mensagem diz o que cada um
respondeu).

## Memórias

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/memorias` | `?busca=` e `?area=` filtram. |
| POST | `/memorias` | `{ titulo, corpo, area?, tags?, importancia?, fixada? }`. Título já existente **atualiza** em vez de duplicar. |
| PATCH | `/memorias/:id` | Campos parciais. Renomear move a nota para a nova chave. |
| DELETE | `/memorias/:id` | Remove a memória e suas ligações. |
| GET | `/memorias/grafo` | `{ nos, arestas, areas }` — a rede inteira, pronta para o canvas. |
| POST | `/memorias/distribuir` | `{ texto }` → o modelo fatia o texto em memórias e ligações. |
| GET | `/areas` | Áreas do usuário com slug, rótulo e cor. |

## Ligações

| Método | Rota | O que faz |
| --- | --- | --- |
| POST | `/conexoes` | `{ origemId, destinoId, tipo?, peso? }`. Trata como não direcionada: A↔B só existe uma vez. |
| DELETE | `/conexoes?origem=&destino=` | Desfaz a ligação, em qualquer sentido. |

## Chaves de IA

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/chaves-ia` | `{ chaves, criptografiaOk }`. O segredo **nunca** vem — só `mascara`. |
| POST | `/chaves-ia` | `{ provedor, rotulo, segredo, modelo? }`. Valida contra o provedor antes de gravar. |
| PATCH | `/chaves-ia/:id` | `{ rotulo?, modelo?, ativa?, prioridade? }`. O segredo não é editável: troque removendo e cadastrando. |
| DELETE | `/chaves-ia/:id` | Remove. |
| POST | `/chaves-ia/modelos` | `{ provedor, segredo }` → modelos que aquela chave alcança. A chave é usada e descartada; nada é gravado. |
