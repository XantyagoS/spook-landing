#!/usr/bin/env node
/**
 * Herramienta de revisión visual: abre la página en Chrome sin interfaz,
 * la mide y la fotografía a distintas alturas de scroll.
 *
 *   node scripts/shot.mjs --w 390 --h 844 --scroll 0,0.5,1 --out shots/
 *   node scripts/shot.mjs --eval "document.documentElement.scrollWidth"
 *
 * Existe porque diseñar una landing sin verla es adivinar.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

// Por defecto se mide el BUILD (puerto 4322), no el servidor de desarrollo:
// el de Astro se queda con módulos viejos en memoria y devuelve CSS que ya no
// existe. Pasó dos veces y en ambas costó media hora. dist/ es lo que se
// publica, así que es lo único que vale medir.
const url = arg('url', 'http://localhost:4321/');
const width = Number(arg('w', 390));
const height = Number(arg('h', 844));
const scale = Number(arg('dpr', 2));
const outDir = resolve(arg('out', 'shots'));
const evalExpr = arg('eval', null);
const theme = arg('theme', null); // 'light' | 'dark' — fuerza el tema guardado
const scrolls = arg('scroll', '0').split(',').map(Number);
// Por defecto Chrome oculta la barra de scroll, lo que hace imposible
// comprobar si la CSS la oculta de verdad. Con --scrollbars se deja visible.
const showScrollbars = argv.includes('--scrollbars');
// JS a ejecutar justo antes de fotografiar. Sirve para congelar una animación
// en un instante concreto: una captura estática no puede pillar un parpadeo.
const preJs = arg('js', null);
// Selector sobre el que dejar el puntero antes de fotografiar. Un `mouseover`
// lanzado desde JavaScript NO activa `:hover` de CSS: hace falta un evento de
// ratón real, y eso solo lo puede mandar el protocolo de depuración.
const hoverSel = arg('hover', null);
// Rueda REAL por el protocolo de depuración. Un `new WheelEvent` disparado
// desde JS activa los listeners pero no pasa por la maquinaria de scroll del
// navegador: no sirve para reproducir lo que hace un trackpad.
const wheelDelta = arg('wheel', null);
const port = 9333 + Math.floor(Math.random() * 400);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Perfil NUEVO en cada corrida. Con uno compartido, lanzar Chrome cuando ya hay
// una instancia viva con ese perfil simplemente le pasa la orden a la vieja: se
// termina midiendo la página anterior con el CSS anterior. Pasó de verdad, y
// costó tres diagnósticos.
const profile = resolve(tmpdir(), `spook-shot-${process.pid}-${Date.now()}`);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  ...(showScrollbars ? [] : ['--hide-scrollbars']),
  '--disable-gpu',
  '--no-first-run',
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(120);
  }
  throw new Error('Chrome no respondió en el puerto de depuración');
}

const wsUrl = await findTarget();
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: res, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : res(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: res, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const { result } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.value;
};

await send('Page.enable');
await send('Runtime.enable');
// Sin esto, Chrome reutiliza el CSS de la sesión anterior y se mide la página
// vieja creyendo que es la nueva. Pasó: un cambio de tamaño que no se veía.
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: scale, mobile: width < 700,
});

if (theme) {
  // Se siembra antes de que el documento cargue, para que el script en línea
  // del <head> lo lea y la página nunca pinte el tema equivocado.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('spook-theme', '${theme}'); } catch {}`,
  });
}

await send('Page.navigate', { url });
await sleep(1800); // tipografías + animaciones de entrada

// El estado y el puntero se preparan en AMBOS modos: si solo se hicieran
// antes de fotografiar, una medición con --eval no vería el hover.
if (preJs) await evaluate(preJs);

if (hoverSel) {
  const punto = await evaluate(
    `(() => { const e = document.querySelector(${JSON.stringify(hoverSel)});
      if (!e) return null; const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  );
  if (punto) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: punto.x, y: punto.y });
    await sleep(400);
  }
}

if (evalExpr) {
  console.log(JSON.stringify(await evaluate(evalExpr), null, 2));
} else {
  mkdirSync(outDir, { recursive: true });
  const docHeight = await evaluate('document.documentElement.scrollHeight');
  const overflow = await evaluate(`(() => {
    const vw = document.documentElement.clientWidth;
    const over = [...document.querySelectorAll('body *')]
      .filter(el => el.getBoundingClientRect().right > vw + 1 ||
                    el.getBoundingClientRect().left < -1)
      .slice(0, 6)
      .map(el => el.tagName.toLowerCase() + '.' + [...el.classList].join('.') +
                 ' → ' + Math.round(el.getBoundingClientRect().left) + '..' +
                 Math.round(el.getBoundingClientRect().right));
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, culprits: over };
  })()`);
  console.log('ancho:', JSON.stringify(overflow));
  console.log('alto del documento:', docHeight, `(${(docHeight / height).toFixed(2)} pantallas)`);

  for (const frac of scrolls) {
    const y = Math.round((docHeight - height) * frac);
    await evaluate(`window.scrollTo(0, ${y}); true`);
    await sleep(1500); // la secuencia del hero dura ~1.15s
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const name = `${String(Math.round(frac * 100)).padStart(3, '0')}.png`;
    writeFileSync(resolve(outDir, name), Buffer.from(data, 'base64'));
    console.log(`  ${name}  (y=${y})`);
  }
}

ws.close();
chrome.kill('SIGKILL');
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
