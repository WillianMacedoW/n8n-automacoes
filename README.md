# n8n-automacoes

Portfólio com dois fluxos n8n feitos do zero por Willian Macedo.

São fluxos de demonstração com dados fictícios. Empresa, produtos, pessoas, telefones e e-mails foram inventados, e os serviços externos são simulados por um mock local nos testes. Nada aqui tem métrica de uso porque nada rodou em produção.

## Fluxos

| Pasta | O que faz |
| --- | --- |
| [`compra-aprovada`](compra-aprovada/README.md) | Recebe webhook de compra, valida token, ignora evento repetido, normaliza telefone, atualiza o CRM e manda WhatsApp, com caminhos separados para plano mensal e anual e tratamento de erro. |
| [`agente-rag`](agente-rag/README.md) | Recebe uma pergunta, busca trechos numa base de conhecimento fictícia, chama a API da Anthropic por nó HTTP Request e devolve a resposta com fontes. Sem contexto, responde com fallback e não chama a API. |

## Estrutura

```
compra-aprovada/   fluxo, payload de exemplo e README
agente-rag/        fluxo e README
docs/              prints do canvas
tests/             mock, testes de ponta a ponta, subida do n8n e captura de prints
.env.example       variáveis com placeholders
```

## Como rodar

Precisa de Node 24 ou mais novo.

```bash
cp .env.example .env     # ajuste WEBHOOK_TOKEN e a senha de teste
npm install
npm run n8n              # terminal 1: sobe o n8n em 127.0.0.1:5678
npm test                 # terminal 2: roda os casos
```

`npm run n8n` usa `npx n8n@2.46.6` com a pasta de dados `.n8n-local`, que fica fora do git e não encosta em nenhum outro n8n da máquina. Na primeira vez ele importa e ativa os dois fluxos e cria a conta local de teste com os dados do `.env`. Todas as URLs externas apontam para o mock, com chaves de teste.

`npm test` sobe o mock em `127.0.0.1:4010`, dispara os webhooks de verdade e confere a resposta do n8n e o que chegou no mock. Para usar os `curl` dos READMEs dos fluxos sem o `npm test`, deixe `node tests/mock-server.mjs` rodando num terceiro terminal.

`npm run prints` regenera os PNGs de `docs/` com Playwright headless. Precisa do Chromium do Playwright (`npx playwright install chromium`), ou de `CHROMIUM_PATH` apontando para um Chromium já instalado.

### Docker

Também dá para usar a imagem oficial, trocando o `npm run n8n` por um container. Esse caminho não foi testado aqui, porque o Docker não estava rodando na máquina dos testes. Os testes abaixo usaram `npx`.

```bash
docker run --rm -p 127.0.0.1:5678:5678 --env-file .env \
  -e N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
  docker.n8n.io/n8nio/n8n:2.46.6
```

Nesse modo os fluxos precisam ser importados pela interface, e as URLs do mock precisam usar `host.docker.internal` no lugar de `127.0.0.1`.

## Testes

A API real da Anthropic não é chamada. O teste usa um mock local que confere headers, modelo e formato do corpo e devolve uma resposta no formato da Messages API. Isso prova o caminho do fluxo, não a qualidade de uma resposta real.

Resultado da última execução, em 05/11/2026, com n8n 2.46.6 local: **17 de 17 casos passaram**.

| Fluxo | Casos | O que cobrem |
| --- | --- | --- |
| `compra-aprovada` | 11 | Plano mensal e anual, token inválido, evento duplicado, evento que não é compra aprovada, payload sem e-mail, produto desconhecido, telefone inválido, telefone sem DDI, CRM e WhatsApp fora do ar com reentrega. |
| `agente-rag` | 6 | Pergunta com e sem contexto, pergunta vazia, API fora do ar, recusa do modelo e trechos que não respondem à pergunta. |
