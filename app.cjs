// Archivo de inicio para cPanel → Setup Node.js App (Passenger/LiteSpeed).
// Passenger carga este archivo con require(), así que arranca el servidor
// (módulo ES) con import() y escucha en el puerto que Passenger asigna.
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
    console.error('No se pudo iniciar el servidor:', err);
    process.exit(1);
  });
