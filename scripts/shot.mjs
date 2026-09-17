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
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const url = arg('url', 'http://localhost:4321/');
const width = Number(arg('w', 390));
const height = Number(arg('h', 844));
const scale = Number(arg('dpr', 2));
const outDir = resolve(arg('out', 'shots'));
const evalExpr = arg('eval', null);
const scrolls = arg('scroll', '0').split(',').map(Number);
const port = 9333 + Math.floor(Math.random() * 400);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--hide-scrollbars',
  '--disable-gpu',
  '--no-first-run',
  '--user-data-dir=/tmp/spook-shot-profile',
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
await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: scale, mobile: width < 700,
});

await send('Page.navigate', { url });
await sleep(1800); // tipografías + animaciones de entrada

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
    await sleep(650);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const name = `${String(Math.round(frac * 100)).padStart(3, '0')}.png`;
    writeFileSync(resolve(outDir, name), Buffer.from(data, 'base64'));
    console.log(`  ${name}  (y=${y})`);
  }
}

ws.close();
chrome.kill();
process.exit(0);
