// Arma la versión de demostración: un solo HTML con todo incluido, que corre
// sin servidor (lógica en el navegador, pagos simulados, datos en este navegador).
// Uso: npm run demo   → genera demo/index.html
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.PROJECT_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [join(ROOT, 'web/app.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2022', charset: 'utf8',
  legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = (await readFile(join(ROOT, 'web/styles.css'), 'utf8')) + (await readFile(join(ROOT, 'web/admin.css'), 'utf8'));
const html = `<title>Santa Elena de Maipo Home</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=IBM+Plex+Mono:wght@400;600&family=Onest:wght@400..700&display=swap">
<style>${css}</style>
<div id="app"><p style="padding:40px 20px;font-family:system-ui">Cargando…</p></div>
<script>window.SE_DEMO = true;</script>
<script>${js}</script>
`;
await mkdir(join(ROOT, 'demo'), { recursive: true });
await writeFile(join(ROOT, 'demo/index.html'), html);
console.log(`demo/index.html (${(html.length / 1024).toFixed(0)} KB)`);
