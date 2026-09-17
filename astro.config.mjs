// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://spook.app', // TODO: cambiar al dominio real cuando lo compres
  devToolbar: { enabled: false },
  vite: { plugins: [tailwindcss()] },
});
