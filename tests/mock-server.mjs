// Servidor mock local que imita CRM, WhatsApp e a Messages API da Anthropic.
// Escuta só em 127.0.0.1. Nenhuma chamada sai para a internet.
import { createServer } from 'node:http';

export const MOCK_PORT = Number(process.env.MOCK_PORT ?? 4010);

const estado = { chamadas: [], contatos: new Map(), modo: {} };

function reiniciar() {
  estado.chamadas = [];
  estado.contatos = new Map();
  estado.modo = {};
}

function responder(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let bruto = '';
    req.on('data', (parte) => (bruto += parte));
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(bruto ? JSON.parse(bruto) : {});
      } catch {
        resolve({ __jsonInvalido: bruto });
      }
    });
  });
}

function crm(req, res, corpo) {
  if (estado.modo.crm === 'falha') return responder(res, 500, { erro: 'crm_indisponivel' });
  if (req.headers.authorization !== 'Bearer chave-crm-de-teste') return responder(res, 401, { erro: 'nao_autorizado' });
  if (!corpo.email) return responder(res, 400, { erro: 'email_obrigatorio' });
  const criado = !estado.contatos.has(corpo.email);
  estado.contatos.set(corpo.email, corpo);
  return responder(res, 200, { id: `crm-${estado.contatos.size}`, criado });
}

function whatsapp(req, res, corpo) {
  if (estado.modo.whatsapp === 'falha') return responder(res, 503, { erro: 'whatsapp_indisponivel' });
  if (req.headers.authorization !== 'Bearer chave-whatsapp-de-teste') return responder(res, 401, { erro: 'nao_autorizado' });
  if (!/^55\d{11}$/.test(corpo.para ?? '')) return responder(res, 400, { erro: 'numero_invalido' });
  return responder(res, 200, { id: 'msg-teste', status: 'enfileirada' });
}

// Valida a requisição como a API real exigiria e devolve o mesmo formato de resposta.
function anthropic(req, res, corpo) {
  const erro = (status, tipo, mensagem) =>
    responder(res, status, { type: 'error', error: { type: tipo, message: mensagem } });

  if (estado.modo.anthropic === 'falha') return erro(500, 'api_error', 'erro simulado');
  if (req.headers['x-api-key'] !== 'chave-anthropic-de-teste') return erro(401, 'authentication_error', 'chave ausente ou incorreta');
  if (!req.headers['anthropic-version']) return erro(400, 'invalid_request_error', 'anthropic-version ausente');
  if (corpo.fallbacks === 'default' && req.headers['anthropic-beta'] !== 'server-side-fallback-2026-07-01') {
    return erro(400, 'invalid_request_error', 'fallbacks exige o header beta');
  }
  if (typeof corpo.model !== 'string' || typeof corpo.max_tokens !== 'number') {
    return erro(400, 'invalid_request_error', 'model e max_tokens são obrigatórios');
  }
  if ('temperature' in corpo) return erro(400, 'invalid_request_error', 'temperature não é aceito');
  const ultima = corpo.messages?.at(-1);
  if (ultima?.role !== 'user' || typeof ultima.content !== 'string') {
    return erro(400, 'invalid_request_error', 'messages inválido');
  }

  const base = { id: 'msg_mock', type: 'message', role: 'assistant', model: corpo.model, usage: { input_tokens: 1, output_tokens: 1 } };
  if (estado.modo.anthropic === 'recusa') {
    return responder(res, 200, { ...base, content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null } });
  }

  // Cita o primeiro trecho recebido, o que prova que o contexto chegou até aqui.
  const id = ultima.content.match(/<trecho id="([^"]+)"/)?.[1];
  const texto = estado.modo.anthropic === 'sem_resposta' || !id ? 'SEM_RESPOSTA' : `Resposta simulada pelo mock com base em [${id}].`;
  return responder(res, 200, { ...base, content: [{ type: 'text', text: texto }], stop_reason: 'end_turn' });
}

const rotas = {
  'POST /crm/contacts/upsert': crm,
  'POST /whatsapp/messages': whatsapp,
  'POST /anthropic/v1/messages': anthropic,
};

export function iniciarMock(porta = MOCK_PORT) {
  const servidor = createServer(async (req, res) => {
    const corpo = await lerCorpo(req);
    const rota = `${req.method} ${req.url}`;

    if (rota === 'POST /__reset') {
      reiniciar();
      return responder(res, 200, { ok: true });
    }
    if (rota === 'POST /__modo') {
      estado.modo = corpo;
      return responder(res, 200, estado.modo);
    }
    if (rota === 'GET /__chamadas') return responder(res, 200, estado.chamadas);

    const manipulador = rotas[rota];
    if (!manipulador) return responder(res, 404, { erro: 'rota_desconhecida', rota });

    // Header de auth fica fora do log do mock.
    estado.chamadas.push({ rota: req.url, corpo, versao: req.headers['anthropic-version'] ?? null });
    return manipulador(req, res, corpo);
  });

  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(porta, '127.0.0.1', () => resolve(servidor));
  });
}

if (process.argv[1]?.endsWith('mock-server.mjs')) {
  await iniciarMock();
  console.log(`mock em http://127.0.0.1:${MOCK_PORT}`);
}
