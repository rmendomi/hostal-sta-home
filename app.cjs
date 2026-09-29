// Archivo de inicio para cPanel → Setup Node.js App (Passenger/LiteSpeed).
// Passenger carga este archivo con require(), así que arranca el servidor
// (módulo ES) con import() y escucha en el puerto que Passenger asigna.
const http = require('node:http');

// Passenger no pasa opciones de línea de comando: se silencia aquí el aviso
// "SQLite is an experimental feature", que solo ensucia el registro.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (/SQLite is an experimental feature/.test(text || '')) return;
  return emitWarning.call(process, warning, ...args);
};

// Detrás de Passenger la IP real del visitante llega en X-Forwarded-For.
if (process.env.TRUST_PROXY === undefined) process.env.TRUST_PROXY = '1';

const port = process.env.PORT || 3000;

import('./server/index.js')
  .then(({ createApp }) => createApp())
  .then((app) => {
    app.server.listen(port, () => {
      console.log(`Santa Elena de Maipo Home en ${app.cfg.baseUrl}`);
      if (!app.auth.hasAdmins()) console.log('Aún no hay usuario del panel: define ADMIN_EMAIL y ADMIN_PASSWORD y reinicia.');
    });
  })
  .catch((err) => {
    // En vez de caerse sin explicación, muestra qué falta en la página.
    console.error('No se pudo iniciar el servidor:', err);
    const dataDir = process.env.DATA_DIR || '(no definida)';
    const hint = /EACCES|EPERM|ENOENT|ENOTDIR|EROFS/.test(String(err?.code || err?.message))
      ? `No se puede escribir en la carpeta de datos <code>${escape(dataDir)}</code>. Revisa que exista y que la variable <code>DATA_DIR</code> tenga la ruta completa, por ejemplo <code>/home/USUARIO/santaelena-data</code>.`
      : 'Revisa las variables de entorno en cPanel → Setup Node.js App y el registro de errores (stderr.log en la carpeta de la aplicación).';
    http.createServer((req, res) => {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><html lang="es-CL"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>El sitio no pudo iniciar</title><body style="font-family:system-ui,sans-serif;max-width:620px;margin:40px auto;padding:0 16px;line-height:1.5"><h1>El sitio no pudo iniciar</h1><p>${hint}</p><p>Después de corregirlo, aprieta <b>Restart</b> en Setup Node.js App.</p><p style="color:#666">Detalle: ${escape(String(err?.message || err))}</p></body></html>`);
    }).listen(port);
  });

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
