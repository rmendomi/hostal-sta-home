# Santa Elena de Maipo Home · Reservas directas

Sitio de reservas y panel de administración para el hostal. Sin dependencias en
producción: Node.js 22 y su SQLite integrado.

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `core/` | Lógica compartida: precios (`pricing.js`), reservas y disponibilidad (`service.js`), datos iniciales (`seed.js`). La usan el servidor y la demo, así ambos calculan igual. |
| `server/` | Servidor HTTP, base de datos SQLite, pagos con Flow, acceso al panel, correos, respaldos. |
| `web/` | Sitio público (`app.js`), panel (`admin.js`), estilos e ilustraciones. |
| `tests/` | 30 pruebas: precios, temporadas, descuentos, comisiones, reservas simultáneas (también entre dos procesos), cancelación, cambios, pagos, seguridad del panel, tareas programadas y respaldos. |
| `app.cjs` | Archivo de inicio para cPanel (Setup Node.js App). |
| `scripts/build-demo.mjs` | Genera `demo/index.html`, la versión sin servidor para revisar. |

## Correr en local

```bash
PAYMENTS=simulado INICIAR_BASE=1 ADMIN_EMAIL=tu@correo.cl ADMIN_PASSWORD='una-clave-larga' npm start
# sitio: http://localhost:3000   panel: http://localhost:3000/#/panel
npm test
```

La base parte vacía; `INICIAR_BASE=1` carga una sola vez las habitaciones y
políticas reales (sin reservas de ejemplo; temporadas y descuentos apagados).
`PAYMENTS=simulado` reemplaza Flow por una pasarela de prueba. Sin esa variable
se usa Flow con `FLOW_API_KEY` y `FLOW_SECRET_KEY`; si faltan, el sitio funciona
igual pero sin pago en línea.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `BASE_URL` | Dirección pública con https, ej. `https://www.santaelenademaipo.cl`. Flow devuelve al huésped a `BASE_URL/pago/retorno` y avisa cada pago a `BASE_URL/pago/confirmacion`. |
| `DATA_DIR` | Carpeta persistente para la base de datos, las fotos y la clave de firma. |
| `FLOW_ENV` | `sandbox` (pruebas) o `produccion`. |
| `FLOW_API_KEY`, `FLOW_SECRET_KEY` | Llaves de Flow (Mi cuenta → Integraciones). Las de sandbox y las de producción son distintas. |
| `RESEND_API_KEY`, `MAIL_FROM` | Envío de correos de confirmación con Resend. Sin llave, los correos quedan en cola en el panel. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Crean el primer usuario del panel si no existe ninguno. También: `npm run admin:crear -- correo@dominio.cl`. |
| `TAREAS_SECRET` | Activa las rutas `/tareas/correos`, `/tareas/vencer` y `/tareas/respaldo` (POST con cabecera `X-Tarea-Clave`) para llamarlas desde cron, y apaga los relojes internos. Ver `docs/CRON.md`. |
| `INICIAR_BASE` | `1` la primera vez para cargar los datos reales del hostal si la base está vacía. |
| `TRUST_PROXY` | `1` si el servidor está detrás de un proxy (Render, Nginx), para limitar intentos por IP real. |

## Cómo se evita vender dos veces la misma noche

Cada noche tomada es una fila en `night_locks` con clave primaria
(habitación, noche). Reservar, bloquear y cambiar fechas escriben ahí dentro de
una transacción `BEGIN IMMEDIATE`, así que si dos personas pagan la misma noche
al mismo tiempo, la base de datos rechaza a la segunda (probado con 12 reservas
simultáneas: gana una, 11 reciben aviso). Las reservas sin pagar apartan sus
noches durante `holdMinutes` (15 por defecto) y luego se liberan solas.

El sitio es el único canal de venta: no se conecta con Booking ni con otras
agencias. Las noches que se venden por fuera se cierran a mano en el panel
(Calendario → Bloquear).

## Datos personales y pagos

- Los datos de tarjeta los escribe el huésped en la página de pago de Flow. Aquí
  solo se guarda el token de la transacción, código de autorización, tipo de
  tarjeta y últimos 4 dígitos.
- El huésped ve su reserva con su código y correo, o con un enlace firmado (HMAC).
- Panel: contraseñas con scrypt, sesión en cookie HttpOnly + SameSite=Strict,
  verificación de origen, límite de intentos de acceso, registro de acciones.
- Cabeceras de seguridad (CSP, HSTS con https, X-Frame-Options).
- Respaldos: `/tareas/respaldo` (cron diario) guarda una copia consistente en
  `DATA_DIR/respaldos` (últimas 14), descargables desde Panel → Ajustes. Las
  fotos (`uploads/`) y `.secret` también viven en `DATA_DIR`.

## Publicar en NinjaHosting (hosting actual)

Paso a paso para cPanel sin SSH: [docs/DESPLIEGUE-NINJAHOSTING.md](docs/DESPLIEGUE-NINJAHOSTING.md).
Tareas programadas: [docs/CRON.md](docs/CRON.md). Variables: `.env.example`.

## Publicar en Render (alternativa)

`render.yaml` deja el servicio listo (plan Starter con disco de 1 GB). Hay que
completar `BASE_URL`, llaves de Flow y Resend, y apuntar el dominio.

## Demo

```bash
npm i -D esbuild && npm run demo   # genera demo/index.html
```

## Demo en Vercel

`vercel.json` publica la versión de demostración (pagos simulados, datos en el
navegador de cada visitante). Al importar el repositorio en Vercel no hay que
cambiar nada: instala con `npm install`, arma con `npm run demo` y publica la
carpeta `demo/`. La versión real, con base de datos y pago en línea, necesita disco
permanente y va en Render (`render.yaml`).
