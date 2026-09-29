# Plan: de demo a sistema real en NinjaHosting

Hoy `hostal-sta-home.vercel.app` es la **demo**: pagos simulados, datos de
ejemplo y todo guardado en el navegador de cada visitante. Vercel queda solo
para esa demo.

El sistema real ya está programado en `server/`: es un servidor Node.js con su
propia base de datos SQLite (un archivo). No necesita Supabase ni otro servicio
de base de datos.

## Hosting contratado

| Dato | Valor |
|---|---|
| Proveedor | NinjaHosting, plan **Wako** (cPanel, CloudLinux, LiteSpeed) |
| Dominio | **hostalsantaelena.cl** |
| Node.js | "Setup Node.js App" en cPanel, versiones 20.20.2 y **24.18.0** → usar **24** |
| Conexiones salientes | HTTPS sin restricción (Transbank, Resend, Booking) |
| ModSecurity | Activo; soporte puede desactivarlo para el sitio |
| SSH / Terminal | **No hay.** Todo se hace desde cPanel |
| DNS | Editor de zonas disponible (para Resend: TXT y CNAME) |

Respuestas de soporte NinjaHosting, ticket #499054 (29-09-2026).

## Cómo queda armado (sin SSH)

```
/home/USUARIO/
├── repositories/hostal-sta-home/   ← código, clonado de GitHub con "Git Version Control"
│                                     y usado directo como carpeta de la app Node
├── santaelena-data/                ← DATA_DIR: base reservas.db, fotos, .secret, respaldos
│                                     (fuera de public_html: nunca se puede descargar desde la web)
└── public_html/                    ← no se usa para la app (Passenger la publica en el dominio)
```

- **Código:** cPanel → Git Version Control clona el repositorio público de
  GitHub. Para actualizar: "Pull or Deploy" → "Update from Remote" y luego
  "Restart" en Setup Node.js App.
- **Arranque:** Setup Node.js App con Node 24.18.0, archivo de inicio `app.js`.
- **Base de datos:** un archivo en `santaelena-data/`. El sistema no necesita
  instalar paquetes para funcionar (Node 24 trae SQLite).
- **Tareas repetidas:** cPanel → Cron Jobs llama a la app con `curl` (Booking
  cada 15 minutos, correos y reservas vencidas cada 5 minutos) y hace un
  respaldo diario de la base.
- **Respaldos:** los guarda el cron en `santaelena-data/respaldos/` (últimos
  14) y además NinjaHosting tiene sus puntos de restauración. Para bajar uno:
  cPanel → Administrador de archivos.
- **Primer usuario del panel:** como no hay terminal, se crea con las
  variables `ADMIN_EMAIL` y `ADMIN_PASSWORD` la primera vez; después se borran.
- **SSL:** cPanel → SSL/TLS Status → "Run AutoSSL" (gratis).

## Paso a paso en cPanel (lo haces tú)

No compartas la contraseña de cPanel en el chat. Estos pasos se hacen una vez,
**después** de que Claude Code termine las etapas del prompt de abajo y estén
en GitHub.

1. **SSL:** cPanel → SSL/TLS Status → marca `hostalsantaelena.cl` y
   `www.hostalsantaelena.cl` → Run AutoSSL.
2. **Carpeta de datos:** cPanel → Administrador de archivos → en tu carpeta
   principal crea `santaelena-data`.
3. **Código:** cPanel → Git Version Control → Create → Clone URL
   `https://github.com/rmendomi/hostal-sta-home.git`, Repository Path
   `repositories/hostal-sta-home` → Create.
4. **App Node:** cPanel → Setup Node.js App → Create Application:
   - Node.js version: **24.18.0**
   - Application mode: **Production**
   - Application root: `repositories/hostal-sta-home`
   - Application URL: `hostalsantaelena.cl`
   - Application startup file: `app.js`
   - Variables de entorno (botón "Add variable"), ver tabla abajo.
   - Create → luego "Run NPM Install" → "Restart".
5. **Iniciar la base:** agrega la variable `INICIAR_BASE=1`, Restart, abre
   `https://hostalsantaelena.cl` y revisa que aparezcan las 5 habitaciones.
   Luego borra `INICIAR_BASE`, `ADMIN_EMAIL` y `ADMIN_PASSWORD` y Restart.
6. **Cron:** cPanel → Cron Jobs → copia las líneas de `docs/CRON.md`.
7. **ModSecurity:** abre un ticket pidiendo desactivarlo para
   hostalsantaelena.cl (o al menos para la ruta `/pago/retorno`), porque
   Transbank devuelve al huésped con un POST ahí.
8. **Prueba:** entra a `https://hostalsantaelena.cl/#/panel`, pon tus
   tarifas reales y haz una reserva de prueba con la tarjeta de prueba de
   Transbank (sigue en modo integración: no se cobra nada).

### Variables de entorno (Setup Node.js App)

| Variable | Valor |
|---|---|
| `BASE_URL` | `https://hostalsantaelena.cl` |
| `DATA_DIR` | `/home/USUARIO/santaelena-data` (USUARIO = tu usuario de cPanel, aparece arriba a la derecha) |
| `TRUST_PROXY` | `1` |
| `TAREAS_SECRET` | una frase larga inventada por ti (la misma va en los cron) |
| `WEBPAY_ENV` | `integracion` (hasta tener contrato con Transbank) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | solo la primera vez (contraseña de 10+ caracteres) |
| `INICIAR_BASE` | `1` solo la primera vez |
| `RESEND_API_KEY`, `MAIL_FROM` | cuando crees la cuenta de Resend |
| `WEBPAY_COMMERCE_CODE`, `WEBPAY_API_KEY` | cuando Transbank te entregue las de producción, y ahí `WEBPAY_ENV=produccion` |

## Costos

| Servicio | Costo | Fuente |
|---|---|---|
| NinjaHosting Wako | $59.900 + IVA al año (ya contratado) | [ninjahosting.cl](https://www.ninjahosting.cl/web-hosting-chile) |
| Dominio hostalsantaelena.cl | $9.990 al año (ya comprado) | [nic.cl](https://www.nic.cl/dominios/tarifas.html) |
| SSL, cron, base de datos | Incluidos | — |
| Webpay Plus | Sin mensualidad; 1,75 % + IVA débito, 2,35 % + IVA crédito | [Transbank](https://ayuda.transbank.cl/tarifas-vender-webpay) |
| Correos (Resend) | Gratis hasta 3.000 al mes | [resend.com](https://resend.com/pricing) |
| Demo en Vercel | Gratis | — |

---

## Prompt para Claude Code (VS Code)

Abre la carpeta del repositorio `hostal-sta-home` en VS Code (haz `git pull`
primero), abre Claude Code y pega todo lo que está dentro del bloque:

````text
Trabaja en este repositorio (hostal-sta-home). Es un sistema de reservas directas para el Hostal Santa Elena de Maipo Home (Temuco, Chile). Lo publicado en Vercel es solo la demo (web/demo.js + scripts/build-demo.mjs, datos en localStorage, pagos simulados) y debe seguir funcionando igual. El sistema real es server/ (Node.js sin dependencias, base node:sqlite en un archivo). Objetivo: dejarlo listo para el hosting compartido de NinjaHosting, plan Wako, dominio hostalsantaelena.cl, sin datos de ejemplo.

Datos del hosting (confirmados por soporte):
- cPanel con "Setup Node.js App" (Phusion Passenger sobre LiteSpeed/CloudLinux). Se usará Node 24.18.0.
- NO hay SSH ni Terminal: todo lo que el dueño deba hacer tiene que poder hacerse desde cPanel (variables de entorno, botones Run NPM Install / Restart, Cron Jobs, Administrador de archivos, Git Version Control).
- El código llega con cPanel Git Version Control clonando este repositorio en ~/repositories/hostal-sta-home, y esa misma carpeta es la raíz de la app Node.
- Datos en DATA_DIR=/home/USUARIO/santaelena-data (fuera de public_html).
- Conexiones salientes HTTPS permitidas. ModSecurity lo desactiva soporte para el sitio.

Antes de cambiar nada, lee README.md, GUIA.md, docs/PLAN-PRODUCCION.md, server/index.js, server/store-sqlite.js, server/auth.js, server/cli.js, server/mailer.js, server/ical.js, server/payments/webpay.js, core/service.js, core/seed.js y tests/. Muéstrame un plan corto por etapas y espera mi OK antes de empezar. Al terminar cada etapa corre `npm test` y dime qué quedó y qué falta.

Reglas que no se negocian:
- La lógica de precios y reservas de core/ no cambia. Si algo debe cambiar, pregúntame.
- Se mantiene la garantía contra doble reserva: tabla night_locks con PRIMARY KEY (room_id, night) dentro de transacciones BEGIN IMMEDIATE. Passenger puede levantar varios procesos: usa journal_mode=WAL y busy_timeout, y agrega una prueba con dos procesos Node reservando la misma noche a la vez (debe ganar uno).
- Nunca guardar datos de tarjeta. De Webpay solo token, código de autorización, tipo de tarjeta y últimos 4 dígitos (como hoy).
- Ninguna llave o contraseña en el código ni en commits. Todo por variables de entorno. Crea .env.example con los nombres.
- La app no debe depender de paquetes de npm en producción (Node 24 trae node:sqlite). esbuild sigue solo como devDependency para la demo.
- Textos en español de Chile, moneda CLP. Sin frameworks nuevos.

Etapa 1 · Arranque en cPanel/Passenger
- Crea app.js en la raíz como archivo de inicio: importa server/index.js y escucha en process.env.PORT (Passenger lo asigna). Suprime el aviso experimental de node:sqlite sin depender de flags de línea de comando (Passenger no los pasa).
- Revisa que node:sqlite funcione en Node 24 y ajusta "engines" en package.json.
- TRUST_PROXY=1 por defecto en producción; revisa que BASE_URL, /pago/retorno (GET y POST), /ical/*.ics, /uploads/* y /#/panel funcionen detrás de Passenger. Si hace falta, agrega un .htaccess de ejemplo en docs/.
- Si DATA_DIR no existe o no se puede escribir, el servidor debe mostrar un error claro en la página en vez de caerse sin explicación.

Etapa 2 · Tareas programadas con cron de cPanel
- Passenger apaga la app si no hay visitas, así que los setInterval (iCal cada 15 min en server/index.js, correos en server/mailer.js) no son confiables. Mantenlos solo para desarrollo local y crea endpoints: POST /tareas/ical, POST /tareas/correos, POST /tareas/vencer (libera reservas no pagadas), POST /tareas/respaldo. Protégelos con el header X-Tarea-Clave = TAREAS_SECRET (comparación en tiempo constante) y responde 404 si TAREAS_SECRET no está definido.
- /tareas/respaldo copia la base con la API de backup de SQLite (no copiar el archivo en caliente) a DATA_DIR/respaldos/reservas-AAAA-MM-DD.db y conserva los últimos 14.
- Crea docs/CRON.md con las líneas exactas para cPanel → Cron Jobs usando curl (iCal cada 15 min, correos y vencer cada 5 min, respaldo diario a las 4:00), con `-fsS --max-time 60` y salida a /dev/null.

Etapa 3 · Sin datos de ejemplo y sin terminal
- El servidor real no siembra nada salvo que INICIAR_BASE=1 y la base esté vacía. En ese caso siembra solo lo real: settings (seedSettings sin demo, con business.email vacío para que el dueño lo complete), las 5 habitaciones reales de core/seed.js con rateStatus 'estimada', temporadas y descuentos como borrador (active=false), y los cargos almuerzo, cena y lavandería apagados sin precio. Nunca reservas, huéspedes ni pagos de ejemplo. Si la base está vacía y falta INICIAR_BASE, muestra una página que explique qué variable agregar.
- El primer usuario del panel se crea con ADMIN_EMAIL y ADMIN_PASSWORD solo si no hay ninguno (ya existe esa lógica; verifica). Agrega en Panel → Ajustes la opción de cambiar el correo y la contraseña, y una sección "Respaldos" que liste los archivos de DATA_DIR/respaldos y permita descargarlos (solo admin).
- core/seed.js y web/demo.js siguen existiendo para la demo; confirma que `npm run demo` genera lo mismo.

Etapa 4 · Pagos, documentación y prueba final
- Webpay: WEBPAY_ENV=integracion con las credenciales públicas de prueba de Transbank (ya están en server/payments/webpay.js) hasta que el dueño entregue las de producción.
- Crea docs/DESPLIEGUE-NINJAHOSTING.md con el paso a paso para el dueño solo con cPanel (SSL, carpeta de datos, Git Version Control, Setup Node.js App con Node 24.18.0, variables, Run NPM Install, Restart, iniciar base, cron, ticket de ModSecurity, cómo actualizar con "Update from Remote" + Restart, cómo restaurar un respaldo con el Administrador de archivos). Usa como base la sección "Paso a paso en cPanel" de docs/PLAN-PRODUCCION.md.
- Recorrido completo en local con PAYMENTS=simulado y luego con Webpay de integración: buscar, elegir habitación, pagar anticipo con la tarjeta de prueba de Transbank, ver la reserva, cambiar fechas, cancelar con devolución, y revisar en el panel el pago, la comisión y el neto. También en celular (390 px).
- Actualiza README.md y GUIA.md (qué es real ahora y qué falta).

Variables de entorno esperadas (.env.example): PORT, BASE_URL, DATA_DIR, TRUST_PROXY, TAREAS_SECRET, INICIAR_BASE, WEBPAY_ENV, WEBPAY_COMMERCE_CODE, WEBPAY_API_KEY, RESEND_API_KEY, MAIL_FROM, ADMIN_EMAIL, ADMIN_PASSWORD.

Trabaja en una rama nueva (produccion-ninjahosting), commits pequeños por etapa, y no la mezcles a main sin mi OK. Si falta una llave o un dato, déjalo marcado como pendiente y sigue con lo demás.
````
