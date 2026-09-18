#!/usr/bin/env node
/**
 * Sirve dist/ en el 4321 y prohíbe la caché.
 *
 * Reemplaza a `astro dev` a propósito: su servidor se quedó tres veces con
 * módulos viejos en memoria y devolvía CSS que ya no existía en el disco —
 * el archivo decía una cosa y el navegador pintaba otra. Aquí lo que se ve
 * es literalmente lo que se publica.
 *
 * Contrapartida: no hay recarga en caliente. Hay que correr `npm run build`.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';

  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    const info = await stat(file);
    if (info.isDirectory()) throw new Error('directorio');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      // Lo que mata el problema: el navegador nunca reutiliza nada.
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}).listen(PORT, () => {
  console.log(`dist/ servido en http://localhost:${PORT} (sin caché)`);
});
