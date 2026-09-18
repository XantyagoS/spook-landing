// Copia public/legal.html a docs/, que es lo ÚNICO que publica GitHub Pages.
//
// Existe porque la app publicada enlaza sus Términos y su Privacidad a
// https://xantyagos.github.io/spook-landing/legal.html (spook-frontend,
// src/constants/legal.ts). Esa URL tiene que seguir viva hasta que la app
// apunte al dominio propio; entonces docs/ y este script se borran.
//
// Allá no existe la landing, así que la copia quita los enlaces a sus
// secciones y la marca apunta a la propia página.
//
//   npm run legal:pages   (después de tocar public/legal.html)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const origen = readFileSync('public/legal.html', 'utf8');

const secciones = /\n\s*<nav aria-label="Secciones">[\s\S]*?<\/nav>/;
if (!secciones.test(origen)) throw new Error('No encontré el <nav> de secciones en public/legal.html');

const copia = origen
  .replace(secciones, '')
  .replace('<a class="brand" href="/">', '<a class="brand" href="legal.html">')
  // Sin la lista del medio, el navbar queda en dos columnas: marca y botón.
  // Y la marca se ve también en teléfono (allá se escondía para dar sitio).
  .replace(
    '</head>',
    '<style>.bar .inner{grid-template-columns:1fr auto}@media(max-width:640px){.bar .brand{display:block}}</style>\n</head>',
  )
  .replace(
    '<!DOCTYPE html>',
    '<!DOCTYPE html>\n<!-- GENERADO por scripts/legal-pages.mjs desde public/legal.html. No editar aquí. -->',
  );

mkdirSync('docs/assets/landing', { recursive: true });
writeFileSync('docs/legal.html', copia);
// Sin Jekyll: que Pages sirva los archivos tal cual.
writeFileSync('docs/.nojekyll', '');
for (const f of ['favicon.png', 'apple-touch-icon.png']) {
  copyFileSync(`public/assets/landing/${f}`, `docs/assets/landing/${f}`);
}
console.log('docs/legal.html listo');
