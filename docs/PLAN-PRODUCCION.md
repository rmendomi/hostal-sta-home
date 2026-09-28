# Plan: de demo a sistema real en NinjaHosting

Hoy `hostal-sta-home.vercel.app` es la **demo**: pagos simulados, datos de
ejemplo y todo guardado en el navegador de cada visitante. Vercel queda solo
para esa demo.

El sistema real ya está programado en `server/`: es un servidor Node.js con su
propia base de datos SQLite (un archivo). No necesita Supabase ni otro servicio
de base de datos. El hosting final será NinjaHosting (Santiago, Chile).

## Lo que hay que confirmar con NinjaHosting antes de pagar

En su sitio NinjaHosting solo ofrece hosting compartido con cPanel, PHP y
MySQL (planes Ninja, Wako y Sakura). **No menciona Node.js ni VPS.** Sus
servidores usan CloudLinux, que a veces trae la opción "Setup Node.js App" en
cPanel, pero eso no está publicado. Pregúntales por escrito, antes de
contratar:

1. ¿El plan incluye **"Setup Node.js App"** (Node.js Selector) en cPanel?
2. ¿Qué **versiones de Node.js** tienen? El sistema necesita **Node 22.13 o
   superior** (ideal 22 o 24).
3. ¿La aplicación puede hacer **conexiones salientes HTTPS** a
   `webpay3g.transbank.cl` (Webpay), `api.resend.com` (correos) y
   `admin.booking.com` (calendarios)?
4. ¿Hay **acceso SSH** (en su sitio dice "bajo petición")?
5. ¿Qué **límite de RAM y procesos** tiene cada plan?

Texto listo para mandarles:

> Hola, quiero contratar un plan para una aplicación Node.js (servidor propio
> con base de datos SQLite). ¿El plan incluye "Setup Node.js App" en cPanel?
> ¿Qué versiones de Node.js ofrecen? Necesito 22.13 o superior. ¿La aplicación
> puede conectarse por HTTPS a webpay3g.transbank.cl, api.resend.com y
> admin.booking.com? ¿Incluye acceso SSH y cuánta RAM tiene cada plan? Gracias.

### Según lo que respondan

| Respuesta | Qué hacer |
|---|---|
| Sí a Node 22.13+ y conexiones salientes | Contratar el plan **Ninja** (alcanza: 1 sitio, 15 GB) y seguir el prompt de abajo. |
| Tienen Node, pero una versión más antigua (18 o 20) | Igual sirve: el prompt cambia la base a un módulo que funciona en esas versiones. Avísale a Claude Code qué versión es. |
| No tienen Node.js | Ese plan no puede correr el sistema. Opciones: pedirles un VPS, o dejar la app en Render (USD 7,25 al mes, ya configurado en `render.yaml`) y usar NinjaHosting solo para el dominio y los correos. Reescribir todo en PHP no conviene. |

## Costos (revisados el 28-09-2026)

| Servicio | Costo | Fuente |
|---|---|---|
| NinjaHosting plan Ninja | $49.900 + IVA al año (unos $59.400 con IVA; oferta, precio normal $74.900) | [ninjahosting.cl](https://www.ninjahosting.cl/web-hosting-chile) |
| NinjaHosting plan Wako | $59.900 + IVA al año | ídem |
| Certificado SSL | Incluido (Let's Encrypt) | ídem |
| Tareas programadas (cron) | Incluidas en cPanel | ídem |
| Base de datos | Incluida: es un archivo dentro del hosting | — |
| Webpay Plus | Sin mensualidad; 1,75 % + IVA débito, 2,35 % + IVA crédito | [Transbank](https://ayuda.transbank.cl/tarifas-vender-webpay) |
| Correos (Resend) | Gratis hasta 3.000 al mes | [resend.com](https://resend.com/pricing) |
| Demo en Vercel | Gratis (plan Hobby: uso no comercial, sirve para mostrar la demo) | [vercel.com](https://vercel.com/docs/plans/hobby) |

Comparado con Supabase + Vercel Pro (unos USD 45 al mes), NinjaHosting sale
cerca de $5.000 al mes.

## Lo que tienes que hacer tú

1. Mandar las preguntas de arriba a NinjaHosting y contratar el plan.
2. Apuntar el dominio (por ejemplo `santaelenademaipo.cl`) al hosting y
   activar el SSL gratis en cPanel.
3. Crear en cPanel la aplicación Node.js (Setup Node.js App) y pegar ahí las
   variables de entorno: nunca en el código ni en el chat.
4. Más adelante: contratar Webpay Plus y pegar el código de comercio y la
   llave de producción en esas mismas variables.

## Orden de trabajo

1. Preparar el servidor para cPanel (Passenger): arranque, rutas y carpeta de datos fuera de `public_html`.
2. Cambiar los relojes internos (Booking cada 15 minutos, correos, reservas vencidas) por tareas cron de cPanel, porque Passenger apaga la app cuando no hay visitas.
3. Base vacía: solo las 5 habitaciones reales y las políticas, sin reservas de ejemplo.
4. Respaldo diario de la base.
5. Webpay en modo de prueba y un recorrido completo en el dominio real.
6. La demo sigue en Vercel para mostrar a clientes.

---

## Prompt para Claude Code (VS Code)

Abre la carpeta del repositorio `hostal-sta-home` en VS Code (haz `git pull`
primero), abre Claude Code y pega todo lo que está dentro del bloque:

````text
Trabaja en este repositorio (hostal-sta-home). Es un sistema de reservas directas para el Hostal Santa Elena de Maipo Home (Temuco, Chile). Lo publicado en Vercel es solo la demo (web/demo.js + scripts/build-demo.mjs, datos en localStorage, pagos simulados) y debe seguir funcionando igual. El sistema real es server/ (Node.js sin dependencias, base node:sqlite en un archivo). Objetivo: dejar el sistema real listo para correr en un hosting compartido cPanel de NinjaHosting con "Setup Node.js App" (Phusion Passenger, CloudLinux), sin datos de ejemplo.

Antes de cambiar nada, lee README.md, GUIA.md, docs/PLAN-PRODUCCION.md, server/index.js, server/store-sqlite.js, server/auth.js, server/mailer.js, server/ical.js, server/payments/webpay.js, core/service.js, core/seed.js y tests/. Luego muéstrame un plan corto por etapas y espera mi OK antes de empezar. Al terminar cada etapa corre `npm test` y dime qué quedó y qué falta.

Versión de Node en el hosting: [ESCRIBE AQUÍ LA VERSIÓN QUE CONFIRMÓ NINJAHOSTING].

Reglas que no se negocian:
- La lógica de precios y reservas de core/ no cambia. Si algo debe cambiar, pregúntame.
- Se mantiene la garantía contra doble reserva: tabla night_locks con PRIMARY KEY (room_id, night) dentro de transacciones BEGIN IMMEDIATE. Como Passenger puede levantar varios procesos a la vez, usa journal_mode=WAL y busy_timeout, y agrega una prueba con dos procesos Node reservando la misma noche al mismo tiempo (debe ganar uno).
- Nunca guardar datos de tarjeta. De Webpay solo token, código de autorización, tipo de tarjeta y últimos 4 dígitos (como hoy).
- Ninguna llave o contraseña en el código ni en commits. Todo por variables de entorno. Crea .env.example con los nombres.
- Textos en español de Chile, moneda CLP. Sin frameworks nuevos.

Etapa 1 · Compatibilidad con cPanel/Passenger
- Crea app.js en la raíz como archivo de inicio para "Setup Node.js App", que arranque server/index.js escuchando en process.env.PORT (Passenger lo asigna).
- Si la versión de Node del hosting es menor a 22.13 (sin node:sqlite), crea server/store-sqlite-compat.js con la misma interfaz usando un paquete que no requiera compilar en el servidor (evalúa node-sqlite3-wasm o sql.js con escritura a disco y bloqueo de archivo) y elígelo automáticamente según la versión. Si hay que elegir entre opciones, explícame ventajas y espera mi OK.
- DATA_DIR debe apuntar fuera de public_html (por ejemplo /home/USUARIO/santaelena-data) para que la base, las fotos subidas y .secret nunca se puedan descargar.
- TRUST_PROXY=1 detrás de LiteSpeed/Passenger, para que el límite de intentos use la IP real.
- Revisa que las rutas /pago/retorno, /ical/*.ics y /uploads/* funcionen detrás de Passenger. Si hace falta, agrega un .htaccess de ejemplo en docs/.

Etapa 2 · Tareas programadas con cron
- Passenger apaga la app si no hay visitas, así que los setInterval (iCal cada 15 min en server/index.js, correos en server/mailer.js) no son confiables. Mantén los intervalos solo para desarrollo local y crea endpoints protegidos: POST /tareas/ical, POST /tareas/correos, POST /tareas/vencer (libera reservas no pagadas). Protégelos con el header X-Tarea-Clave = TAREAS_SECRET.
- Deja en docs/CRON.md las líneas exactas para cPanel → Cron Jobs (curl a esas rutas: iCal cada 15 min, correos y vencer cada 5 min) y el respaldo diario.
- Respaldo: script scripts/respaldo.mjs que copie la base con la API de backup de SQLite (no copiar el archivo en caliente) a DATA_DIR/respaldos con fecha, guardando los últimos 14.

Etapa 3 · Sin datos de ejemplo
- El servidor real no debe sembrar nada automático cuando la base está vacía salvo lo real: settings (seedSettings sin demo), las 5 habitaciones reales de core/seed.js con rateStatus 'estimada', temporadas y descuentos como borrador (active=false) y los cargos almuerzo, cena y lavandería apagados sin precio. Nunca reservas, huéspedes ni pagos de ejemplo. Mueve esa siembra a un comando explícito `npm run base:iniciar` y que el servidor muestre un aviso en el panel si falta.
- core/seed.js y web/demo.js siguen existiendo para la demo; revisa que el build de la demo (npm run demo) no cambie.
- El primer usuario del panel se crea con `npm run admin:crear -- correo@dominio.cl` por SSH, o con ADMIN_EMAIL y ADMIN_PASSWORD la primera vez.

Etapa 4 · Pagos y prueba final
- Webpay: WEBPAY_ENV=integracion con las credenciales públicas de prueba de Transbank (ya están en server/payments/webpay.js) hasta que el dueño entregue las de producción. BASE_URL = el dominio real con https.
- Crea docs/DESPLIEGUE-NINJAHOSTING.md con el paso a paso para el dueño: subir el código (Git en cPanel o FTP), crear la app en "Setup Node.js App" (versión, carpeta, archivo de inicio app.js, variables de entorno), correr npm install y `npm run base:iniciar`, crear el usuario del panel, activar SSL, configurar los cron y cómo restaurar un respaldo.
- Recorrido completo en local con PAYMENTS=simulado y luego con Webpay de integración: buscar, elegir habitación, pagar anticipo con la tarjeta de prueba de Transbank, ver la reserva, cambiar fechas, cancelar con devolución, y revisar en el panel el pago, la comisión y el neto. También en celular (390 px).
- Actualiza README.md y GUIA.md (qué es real ahora y qué falta).

Variables de entorno esperadas (.env.example): PORT, BASE_URL, DATA_DIR, TRUST_PROXY, TAREAS_SECRET, WEBPAY_ENV, WEBPAY_COMMERCE_CODE, WEBPAY_API_KEY, RESEND_API_KEY, MAIL_FROM, ADMIN_EMAIL, ADMIN_PASSWORD.

Trabaja en una rama nueva (produccion-ninjahosting), commits pequeños por etapa, y no la mezcles a main sin mi OK. Si falta una llave o un dato, déjalo marcado como pendiente y sigue con lo demás.
````
