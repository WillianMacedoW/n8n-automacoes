import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function lerEnvArquivo() {
  const arquivo = join(raiz, '.env');
  if (!existsSync(arquivo)) throw new Error('Crie o .env a partir do .env.example antes de rodar.');
  return Object.fromEntries(
    readFileSync(arquivo, 'utf8')
      .split(/\r?\n/)
      .filter((linha) => linha.includes('=') && !linha.startsWith('#'))
      .map((linha) => [linha.slice(0, linha.indexOf('=')).trim(), linha.slice(linha.indexOf('=') + 1).trim()]),
  );
}
