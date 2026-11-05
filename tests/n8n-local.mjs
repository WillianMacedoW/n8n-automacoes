// Sobe um n8n de teste via npx, em 127.0.0.1, com pasta de dados própria (.n8n-local).
// As URLs de CRM, WhatsApp e Anthropic são forçadas para o mock local, com chaves de teste.
// Ctrl+C encerra o n8n.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerEnvArquivo } from './env.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N8N_VERSAO = '2.46.6';
const PORTA = Number(process.env.N8N_PORT ?? 5678);
const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 4010}`;

function ambiente(env) {
  return {
    ...process.env,
    N8N_USER_FOLDER: join(raiz, '.n8n-local'),
    N8N_PORT: String(PORTA),
    N8N_HOST: '127.0.0.1',
    N8N_LISTEN_ADDRESS: '127.0.0.1',
    N8N_SECURE_COOKIE: 'false',
    N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_TEMPLATES_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'false',
    WEBHOOK_TOKEN: env.WEBHOOK_TOKEN,
    CRM_BASE_URL: `${MOCK}/crm`,
    CRM_API_KEY: 'chave-crm-de-teste',
    WHATSAPP_BASE_URL: `${MOCK}/whatsapp`,
    WHATSAPP_API_KEY: 'chave-whatsapp-de-teste',
    ANTHROPIC_BASE_URL: `${MOCK}/anthropic`,
    ANTHROPIC_API_KEY: 'chave-anthropic-de-teste',
    ANTHROPIC_MODEL: 'claude-sonnet-5-5',
  };
}

// N8N_BIN aponta para um n8n já instalado. Sem ele, usa npx.
function comando(args) {
  if (process.env.N8N_BIN) return { cmd: process.execPath, args: [process.env.N8N_BIN, ...args], shell: false };
  // No Windows o npx só roda via shell, e aí argumento com espaço precisa de aspas.
  const shell = process.platform === 'win32';
  const lista = ['--yes', `n8n@${N8N_VERSAO}`, ...args].map((a) => (shell && a.includes(' ') ? `"${a}"` : a));
  return { cmd: 'npx', args: lista, shell };
}

function n8n(args, env) {
  const c = comando(args);
  const r = spawnSync(c.cmd, c.args, { env, encoding: 'utf8', shell: c.shell });
  if (r.status !== 0) throw new Error(`n8n ${args.join(' ')} falhou:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

async function esperarNoAr() {
  for (let i = 0; i < 180; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORTA}/healthz/readiness`)).ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('n8n não respondeu em 3 minutos');
}

const env = lerEnvArquivo();
const processoEnv = ambiente(env);
const primeiraVez = !existsSync(join(raiz, '.n8n-local', '.n8n', 'database.sqlite'));

if (primeiraVez) {
  mkdirSync(join(raiz, '.n8n-local'), { recursive: true });
  for (const pasta of ['compra-aprovada', 'agente-rag']) {
    n8n([`import:workflow`, `--input=${join(raiz, pasta, 'workflow.json')}`], processoEnv);
  }
  for (const linha of n8n(['list:workflow'], processoEnv).split(/\r?\n/)) {
    const id = linha.split('|')[0].trim();
    if (id && linha.includes('demonstração')) n8n(['publish:workflow', `--id=${id}`], processoEnv);
  }
}

const c = comando(['start']);
const filho = spawn(c.cmd, c.args, { env: processoEnv, stdio: 'inherit', shell: c.shell });
filho.on('exit', (codigo) => process.exit(codigo ?? 0));
process.on('SIGINT', () => filho.kill('SIGINT'));

await esperarNoAr();

if (primeiraVez) {
  const r = await fetch(`http://127.0.0.1:${PORTA}/rest/owner/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: env.N8N_TEST_OWNER_EMAIL,
      password: env.N8N_TEST_OWNER_PASSWORD,
      firstName: 'Conta',
      lastName: 'Teste',
    }),
  });
  if (!r.ok) throw new Error(`owner setup falhou: ${r.status} ${await r.text()}`);
}

console.log(`\nn8n de teste pronto em http://127.0.0.1:${PORTA}`);
