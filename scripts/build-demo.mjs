// Arma la versión de demostración: un solo HTML con todo incluido, que corre
// sin servidor (lógica en el navegador, pagos simulados, datos en este navegador).
// Uso: npm run demo   → genera demo/index.html
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.PROJECT_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [join(ROOT, 'web/app.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2022', charset: 'utf8',
  legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// Pantalla de entrada: la misma de web/index.html.
const index = await readFile(join(ROOT, 'web/index.html'), 'utf8');
const boot = index.match(/<style id="boot-css">[\s\S]*?<\/style>/)[0] + index.match(/<div id="app">[\s\S]*?<\/div><\/div>/)[0];
const css = (await readFile(join(ROOT, 'web/styles.css'), 'utf8')) + (await readFile(join(ROOT, 'web/admin.css'), 'utf8'));
const html = `<title>Santa Elena de Maipo Home</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=Montserrat:wght@400;500;600;700&display=swap">
<style>${css}</style>
${boot}
<script>window.SE_DEMO = true;</script>
<script>${js}</script>
`;
await mkdir(join(ROOT, 'demo'), { recursive: true });
await writeFile(join(ROOT, 'demo/index.html'), html);
// Logo e íconos de la marca junto al HTML (la portada usa /img/logo.jpg).
await cp(join(ROOT, 'web/img'), join(ROOT, 'demo/img'), { recursive: true });
for (const f of ['favicon.svg', 'apple-touch-icon.png']) await cp(join(ROOT, 'web', f), join(ROOT, 'demo', f));
console.log(`demo/index.html (${(html.length / 1024).toFixed(0)} KB)`);
