// Abre cada fluxo no n8n local com Playwright headless e salva um PNG do canvas em docs/.
// Pré-requisito: `npm run n8n` em outro terminal.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { lerEnvArquivo } from './env.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N8N = `http://127.0.0.1:${process.env.N8N_PORT ?? 5678}`;
const env = lerEnvArquivo();

// CHROMIUM_PATH permite usar um Chromium já instalado.
const navegador = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const contexto = await navegador.newContext({ viewport: { width: 2400, height: 1000 }, deviceScaleFactor: 2 });
const pagina = await contexto.newPage();

const login = await contexto.request.post(`${N8N}/rest/login`, {
  data: { emailOrLdapLoginId: env.N8N_TEST_OWNER_EMAIL, password: env.N8N_TEST_OWNER_PASSWORD },
});
if (!login.ok()) throw new Error(`login falhou: ${login.status()}`);

const lista = await (await contexto.request.get(`${N8N}/rest/workflows`)).json();
const alvos = { 'Compra aprovada (demonstração)': 'compra-aprovada.png', 'Agente RAG (demonstração)': 'agente-rag.png' };

for (const fluxo of lista.data) {
  const arquivo = alvos[fluxo.name];
  if (!arquivo) continue;
  await pagina.goto(`${N8N}/workflow/${fluxo.id}`);
  await pagina.waitForSelector('.vue-flow__node', { timeout: 30000 });
  await pagina.waitForTimeout(1500);

  // Tecla 1 ajusta o fluxo inteiro na tela.
  await pagina.locator('.vue-flow__pane').first().click({ position: { x: 5, y: 500 } });
  await pagina.keyboard.press('1');
  await pagina.waitForTimeout(1500);

  // Recorta na área dos nós para não sobrar canvas vazio.
  const caixa = await pagina.evaluate(() => {
    const r = [...document.querySelectorAll('.vue-flow__node')].map((n) => n.getBoundingClientRect());
    const x = Math.min(...r.map((b) => b.left));
    const y = Math.min(...r.map((b) => b.top));
    return { x, y, right: Math.max(...r.map((b) => b.right)), bottom: Math.max(...r.map((b) => b.bottom)) };
  });
  const margem = 50;
  await pagina.screenshot({
    path: join(raiz, 'docs', arquivo),
    clip: {
      x: Math.max(0, caixa.x - margem),
      y: Math.max(0, caixa.y - margem),
      width: caixa.right - caixa.x + 2 * margem,
      height: caixa.bottom - caixa.y + 2 * margem,
    },
  });
  console.log(`salvo docs/${arquivo}`);
}

await navegador.close();
