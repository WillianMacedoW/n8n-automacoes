// Dispara casos reais contra os webhooks do n8n local e confere o que chegou no mock.
// Pré-requisito: `npm run n8n` em outro terminal. A API real da Anthropic não é chamada.
import { lerEnvArquivo } from './env.mjs';
import { MOCK_PORT, iniciarMock } from './mock-server.mjs';

const N8N = `http://127.0.0.1:${process.env.N8N_PORT ?? 5678}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const TOKEN = lerEnvArquivo().WEBHOOK_TOKEN;

const execucao = Date.now();
let seq = 0;
const novaTransacao = () => `TX-TESTE-${execucao}-${++seq}`;

function compra({ produtoId = 900001, telefone = '(11) 90000-0000', email = 'maria.exemplo@example.com', transacao = novaTransacao(), evento = 'PURCHASE_APPROVED' } = {}) {
  return {
    id: `evt-${transacao}`,
    event: evento,
    version: '2.0.0',
    data: {
      product: { id: produtoId, name: 'Curso Planilhas na Prática' },
      buyer: { name: 'Maria Exemplo', email, checkout_phone: telefone },
      purchase: { transaction: transacao, status: 'APPROVED', price: { value: 49.9, currency_value: 'BRL' } },
    },
  };
}

async function post(caminho, corpo, headers = {}) {
  const r = await fetch(`${N8N}/webhook/${caminho}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // resposta sem JSON cai na asserção de status/corpo
  }
  return { status: r.status, json, texto };
}

const enviarCompra = (corpo, token = TOKEN) => post('compra-aprovada', corpo, token === null ? {} : { 'x-webhook-token': token });
const perguntar = (pergunta) => post('agente-rag', { pergunta });

const controle = (caminho, corpo) => fetch(`${MOCK}${caminho}`, { method: 'POST', body: JSON.stringify(corpo ?? {}) });
const chamadas = async (rota) => (await (await fetch(`${MOCK}/__chamadas`)).json()).filter((c) => !rota || c.rota.startsWith(rota));

function confere(condicao, descricao) {
  if (!condicao) throw new Error(descricao);
}
function igual(atual, esperado, rotulo) {
  confere(JSON.stringify(atual) === JSON.stringify(esperado), `${rotulo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`);
}

const casos = [
  ['sucesso mensal', async () => {
    const r = await enviarCompra(compra());
    igual(r.status, 200, 'http');
    igual(r.json?.status, 'processado', 'status');
    igual(r.json?.plano, 'mensal', 'plano');
    const [crm] = await chamadas('/crm');
    const [wa] = await chamadas('/whatsapp');
    igual(crm.corpo.tags, ['aluno-mensal'], 'tags crm');
    igual(crm.corpo.telefone, '5511900000000', 'telefone crm');
    igual(wa.corpo.para, '5511900000000', 'telefone whatsapp');
    confere(wa.corpo.texto.includes('assinatura mensal'), 'mensagem deve ser a do mensal');
    return `200 ${r.json.status}, crm ${crm.corpo.tags}, whatsapp para ${wa.corpo.para}`;
  }],

  ['sucesso anual', async () => {
    const r = await enviarCompra(compra({ produtoId: 900002, telefone: '+55 21 90000-0001' }));
    igual(r.status, 200, 'http');
    igual(r.json?.plano, 'anual', 'plano');
    const [crm] = await chamadas('/crm');
    const [wa] = await chamadas('/whatsapp');
    igual(crm.corpo.tags, ['aluno-anual'], 'tags crm');
    igual(crm.corpo.diasAcesso, 365, 'dias de acesso');
    igual(wa.corpo.para, '5521900000001', 'telefone whatsapp');
    confere(wa.corpo.texto.includes('plano anual'), 'mensagem deve ser a do anual');
    return `200 ${r.json.status}, crm ${crm.corpo.tags}, ${crm.corpo.diasAcesso} dias`;
  }],

  ['token inválido', async () => {
    const errado = await enviarCompra(compra(), 'token-errado');
    const ausente = await enviarCompra(compra(), null);
    igual(errado.status, 401, 'http token errado');
    igual(ausente.status, 401, 'http sem token');
    igual((await chamadas()).length, 0, 'chamadas no mock');
    return '401 com token errado e sem header, nenhuma chamada externa';
  }],

  ['evento duplicado', async () => {
    const transacao = novaTransacao();
    const primeira = await enviarCompra(compra({ transacao }));
    const segunda = await enviarCompra(compra({ transacao }));
    igual(primeira.json?.status, 'processado', 'primeira entrega');
    igual(segunda.status, 200, 'http segunda entrega');
    igual(segunda.json?.status, 'duplicado', 'segunda entrega');
    igual((await chamadas('/crm')).length, 1, 'chamadas crm');
    igual((await chamadas('/whatsapp')).length, 1, 'chamadas whatsapp');
    return '1a processado, 2a duplicado, 1 crm e 1 whatsapp no total';
  }],

  ['telefone inválido', async () => {
    const r = await enviarCompra(compra({ telefone: '123' }));
    igual(r.status, 200, 'http');
    igual(r.json?.status, 'processado_sem_whatsapp', 'status');
    igual(r.json?.motivo, 'telefone_invalido', 'motivo');
    const [crm] = await chamadas('/crm');
    igual(crm.corpo.tags, ['aluno-mensal', 'telefone-invalido'], 'tags crm');
    igual(crm.corpo.telefone, null, 'telefone crm');
    igual((await chamadas('/whatsapp')).length, 0, 'chamadas whatsapp');
    return `200 ${r.json.status}, crm com tag telefone-invalido, sem whatsapp`;
  }],

  ['pergunta com contexto', async () => {
    const r = await perguntar('Qual o prazo para pedir reembolso?');
    igual(r.status, 200, 'http');
    igual(r.json?.usouFallback, false, 'usouFallback');
    igual(r.json?.fontes, [{ id: 'KB-01', titulo: 'Política de reembolso' }], 'fontes');
    igual(r.json?.modelo, 'claude-sonnet-5-5', 'modelo');
    confere(r.json.resposta.includes('[KB-01]'), 'resposta deve citar KB-01');
    const [api] = await chamadas('/anthropic');
    igual(api.corpo.model, 'claude-sonnet-5-5', 'modelo enviado');
    igual(api.versao, '2026-10-21', 'anthropic-version');
    confere(api.corpo.messages[0].content.includes('7 dias corridos'), 'contexto deve ir na mensagem');
    confere(api.corpo.messages[0].content.includes('prazo para pedir reembolso'), 'pergunta deve ir na mensagem');
    return `200 "${r.json.resposta}" fontes ${r.json.fontes.map((f) => f.id)}`;
  }],

  ['pergunta sem contexto', async () => {
    const r = await perguntar('Qual a capital da França?');
    igual(r.status, 200, 'http');
    igual(r.json?.usouFallback, true, 'usouFallback');
    igual(r.json?.motivo, 'sem_contexto', 'motivo');
    igual(r.json?.fontes, [], 'fontes');
    igual((await chamadas('/anthropic')).length, 0, 'chamadas anthropic');
    return '200 fallback sem_contexto, API não foi chamada';
  }],

  // Casos extras de tratamento de erro

  ['extra: evento que não é compra aprovada', async () => {
    const r = await enviarCompra(compra({ evento: 'PURCHASE_REFUNDED' }));
    igual(r.status, 200, 'http');
    igual(r.json?.status, 'ignorado', 'status');
    igual((await chamadas()).length, 0, 'chamadas no mock');
    return '200 ignorado, nenhuma chamada externa';
  }],

  ['extra: payload sem e-mail', async () => {
    const r = await enviarCompra(compra({ email: '' }));
    igual(r.status, 400, 'http');
    igual((await chamadas()).length, 0, 'chamadas no mock');
    return '400 payload_invalido';
  }],

  ['extra: produto desconhecido', async () => {
    const r = await enviarCompra(compra({ produtoId: 123 }));
    igual(r.status, 422, 'http');
    igual(r.json?.status, 'plano_desconhecido', 'status');
    igual((await chamadas()).length, 0, 'chamadas no mock');
    return '422 plano_desconhecido, nenhuma chamada externa';
  }],

  ['extra: telefone sem DDI e sem nono dígito', async () => {
    const r = await enviarCompra(compra({ telefone: '11 9000-0000' }));
    igual(r.json?.status, 'processado', 'status');
    const [wa] = await chamadas('/whatsapp');
    igual(wa.corpo.para, '5511990000000', 'telefone whatsapp');
    return `normalizado para ${wa.corpo.para}`;
  }],

  ['extra: CRM fora do ar e reentrega', async () => {
    const transacao = novaTransacao();
    await controle('/__modo', { crm: 'falha' });
    const falha = await enviarCompra(compra({ transacao }));
    igual(falha.status, 502, 'http com CRM fora');
    igual(falha.json?.etapa, 'crm', 'etapa');
    igual((await chamadas('/whatsapp')).length, 0, 'whatsapp com CRM fora');
    await controle('/__modo', {});
    const reentrega = await enviarCompra(compra({ transacao }));
    igual(reentrega.json?.status, 'processado', 'reentrega');
    igual((await chamadas('/whatsapp')).length, 1, 'whatsapp na reentrega');
    return '502 etapa crm, sem whatsapp; reentrega processada, não marcada como duplicada';
  }],

  ['extra: WhatsApp fora do ar e reentrega', async () => {
    const transacao = novaTransacao();
    await controle('/__modo', { whatsapp: 'falha' });
    const falha = await enviarCompra(compra({ transacao }));
    igual(falha.status, 502, 'http com WhatsApp fora');
    igual(falha.json?.etapa, 'whatsapp', 'etapa');
    await controle('/__modo', {});
    const reentrega = await enviarCompra(compra({ transacao }));
    igual(reentrega.json?.status, 'processado', 'reentrega');
    return '502 etapa whatsapp; reentrega processada';
  }],

  ['extra: pergunta vazia', async () => {
    const r = await perguntar('   ');
    igual(r.status, 400, 'http');
    igual((await chamadas()).length, 0, 'chamadas no mock');
    return '400 pergunta_invalida';
  }],

  ['extra: API fora do ar', async () => {
    await controle('/__modo', { anthropic: 'falha' });
    const r = await perguntar('Como funciona o certificado de conclusão?');
    igual(r.status, 502, 'http');
    igual(r.json?.etapa, 'anthropic', 'etapa');
    return '502 etapa anthropic';
  }],

  ['extra: modelo recusa a resposta', async () => {
    await controle('/__modo', { anthropic: 'recusa' });
    const r = await perguntar('Como funciona o certificado de conclusão?');
    igual(r.status, 200, 'http');
    igual(r.json?.motivo, 'recusa_do_modelo', 'motivo');
    igual(r.json?.usouFallback, true, 'usouFallback');
    return '200 fallback recusa_do_modelo';
  }],

  ['extra: trechos não respondem à pergunta', async () => {
    await controle('/__modo', { anthropic: 'sem_resposta' });
    const r = await perguntar('Como funciona o certificado de conclusão?');
    igual(r.status, 200, 'http');
    igual(r.json?.motivo, 'sem_resposta_nos_trechos', 'motivo');
    return '200 fallback sem_resposta_nos_trechos';
  }],
];

const mock = await iniciarMock();
let falhas = 0;
console.log(`n8n: ${N8N} | mock: ${MOCK} | API real da Anthropic: não usada\n`);

for (const [nome, executar] of casos) {
  await controle('/__reset');
  try {
    const detalhe = await executar();
    console.log(`PASSOU  ${nome}: ${detalhe}`);
  } catch (erro) {
    falhas++;
    console.log(`FALHOU  ${nome}: ${erro.message}`);
  }
}

console.log(`\n${casos.length - falhas} de ${casos.length} casos passaram`);
mock.close();
process.exit(falhas ? 1 : 0);
