# Plan: de demo a sistema real (Supabase + Vercel)

Hoy `hostal-sta-home.vercel.app` es la **demo**: pagos simulados, datos de
ejemplo y todo guardado en el navegador de cada visitante. El código del
servidor real (`server/`) ya existe, pero usa SQLite en disco, que Vercel no
tiene. Este plan cambia la base de datos a Supabase (Postgres) y deja todo
corriendo en Vercel.

## Qué cambia

| Hoy (demo) | Después (real) |
|---|---|
| Datos en el navegador (`web/demo.js`) | Postgres en Supabase |
| SQLite (`server/store-sqlite.js`) | Conexión Postgres desde funciones de Vercel |
| Usuario de panel propio (scrypt) | Supabase Auth (correo y contraseña) |
| Fotos en disco (`uploads/`) | Supabase Storage |
| Pagos simulados | Webpay Plus (integración primero, producción después) |
| Tareas con `setInterval` (iCal, correos, vencer reservas) | `pg_cron` de Supabase llamando a endpoints protegidos |
| Reservas y cargos de ejemplo | Base vacía; solo habitaciones y políticas reales |

La lógica de precios, disponibilidad y reservas (`core/`) no se reescribe:
se adapta para que el almacenamiento sea asíncrono.

## Lo que tienes que hacer tú (no lo puede hacer Claude)

1. **Crear el proyecto en Supabase** (supabase.com → New project, región
   São Paulo `sa-east-1`, la más cercana a Chile). Guarda la contraseña de la
   base de datos.
2. **Copiar las llaves** de Project Settings → API y Database:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y la
   cadena de conexión del pooler (`DATABASE_URL`, modo *transaction*, puerto 6543).
3. **Pegarlas en Vercel** (Project → Settings → Environment Variables), nunca
   en el código ni en el chat. En tu computador van en `.env.local`, que no se sube.
4. **Crear tu usuario del panel** en Supabase → Authentication → Users.
5. Más adelante: **contratar Webpay Plus** y pegar el código de comercio y la
   llave de producción en Vercel.

## Costos (revisados el 28-09-2026)

| Servicio | Plan | Costo | Ojo |
|---|---|---|---|
| Supabase | Free | USD 0 | 500 MB de base, 1 GB de fotos, **se pausa tras 1 semana sin uso**, sin respaldos automáticos. Sirve para probar. |
| Supabase | Pro | USD 25/mes | 8 GB, 100 GB de fotos, no se pausa, respaldos diarios por 7 días. Recomendado al abrir al público. |
| Vercel | Hobby | USD 0 | Solo uso personal y **no comercial**; tareas programadas máximo una vez al día. |
| Vercel | Pro | USD 20/mes por usuario | Necesario para un sitio de negocio. |
| Webpay Plus | — | Sin mensualidad | 1,75 % + IVA débito, 2,35 % + IVA crédito. |

Fuentes: [supabase.com/pricing](https://supabase.com/pricing),
[vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby),
[vercel.com/docs/cron-jobs/usage-and-pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Para probar con clientes basta el plan gratis de ambos. Para operar de verdad:
unos USD 45 al mes (Supabase Pro + Vercel Pro). La alternativa sin Supabase es
Render con SQLite (USD 7,25 al mes, ya configurado en `render.yaml`).

## Orden de trabajo

1. Esquema y migraciones en `supabase/migrations/`.
2. Store de Postgres con la misma interfaz que el de SQLite, y `core/` asíncrono.
3. API como funciones de Vercel (`api/`), con las mismas rutas que `server/index.js`.
4. Panel con Supabase Auth y fotos en Storage.
5. Tareas programadas con `pg_cron`.
6. Carga de datos reales (sin reservas de ejemplo) y prueba completa con
   Webpay de integración.
7. La demo sigue disponible en `/demo` para mostrar a clientes.

---

## Prompt para Claude Code (VS Code)

Abre la carpeta del repositorio `hostal-sta-home` en VS Code, abre Claude Code
y pega todo lo que está dentro del bloque:

````text
Trabaja en este repositorio (hostal-sta-home). Es un sistema de reservas directas para el Hostal Santa Elena de Maipo Home (Temuco, Chile). Hoy lo publicado en Vercel es la demo (web/demo.js + scripts/build-demo.mjs, datos en localStorage, pagos simulados). El servidor real existe en server/ pero usa node:sqlite en disco. Objetivo: dejar el sistema real funcionando en Vercel con Supabase (Postgres, Auth y Storage), sin datos de ejemplo, manteniendo la demo accesible en /demo.

Antes de cambiar nada, lee README.md, GUIA.md, core/service.js, core/pricing.js, core/seed.js, core/rpc.js, server/index.js, server/store-sqlite.js, server/auth.js, server/payments/webpay.js, server/ical.js, server/mailer.js, web/api.js y tests/. Luego muéstrame un plan corto por etapas y espera mi OK antes de empezar la etapa 1. Al terminar cada etapa, corre las pruebas y dime qué quedó y qué falta.

Reglas que no se negocian:
- La lógica de precios y reservas de core/ se conserva. No cambies cómo se calcula un precio; si algo debe cambiar, pregúntame.
- Nunca guardar datos de tarjeta. De Webpay solo se guarda token, código de autorización, tipo de tarjeta y últimos 4 dígitos (como hoy).
- Ninguna llave o contraseña en el código ni en commits. Todo por variables de entorno; crea .env.example con los nombres y agrega .env* (excepto .env.example) a .gitignore.
- La llave service_role de Supabase solo se usa en el servidor (funciones de Vercel). El navegador solo conoce SUPABASE_URL y SUPABASE_ANON_KEY.
- Todo texto visible sigue en español de Chile y la moneda en CLP.
- No agregues frameworks de frontend: el sitio sigue siendo JS sin compilar en web/.

Etapa 1 · Base de datos (supabase/migrations/*.sql, con la CLI de Supabase)
- Tablas: settings (una fila, jsonb), rooms, seasons, discounts, charges, bookings, booking_items, guests, payments, blocks, night_locks, email_outbox, audit_log, ical_feeds. Usa columnas reales para lo que se filtra o suma (fechas, estados, montos en integer CLP, room_id, booking_id) y jsonb solo para lo flexible. Mira qué campos usa core/service.js para decidir.
- Doble reserva: night_locks con PRIMARY KEY (room_id, night). Reservar, bloquear y cambiar fechas insertan ahí dentro de una transacción; si choca, la base rechaza (código 23505) y se traduce a ConflictError como hoy. Las reservas pendientes de pago apartan noches con vencimiento (hold_until) y se liberan al vencer.
- Row Level Security activado en TODAS las tablas, sin políticas para anon: el navegador nunca lee tablas directo; todo pasa por la API. Excepción opcional: lectura pública de rooms activas.
- Storage: bucket público "fotos" para fotos de habitaciones; subir solo desde el servidor con admin autenticado; limitar a imágenes y 5 MB.
- Índices para búsquedas del panel (código de reserva, correo, fechas, estado).

Etapa 2 · Store de Postgres y core asíncrono
- Crea server/store-postgres.js con la misma interfaz que server/store-sqlite.js (getSettings, saveSettings, list, get, insert, update, remove, findBookingByCode, locksFor, addLocks, removeLocks, tx), usando el paquete "postgres" (porsager) con DATABASE_URL del pooler en modo transaction (prepare: false). tx debe ser una transacción real de Postgres.
- Como Postgres es asíncrono, convierte core/service.js y core/rpc.js a async/await sin cambiar su lógica. Adapta core/memory-store.js para que también sea async y la demo siga funcionando igual.
- Actualiza tests/ para que corran contra el memory store y agrega una prueba de 12 reservas simultáneas contra Postgres real (usa supabase start local o una base de prueba), igual a la que existe para SQLite. Debe ganar una y las otras 11 recibir conflicto.

Etapa 3 · API en Vercel
- Funciones en api/ con las mismas rutas que server/index.js: /api/public/:method, /api/admin/:method, /pago/ir, /pago/retorno (GET y POST; token_ws, TBK_TOKEN y timeout), /ical/:room.ics, /salud. Usa rewrites en vercel.json para mantener las URLs.
- Mantén: verificación de origen, límite de intentos (guárdalo en Postgres, no en memoria, porque las funciones no comparten memoria), cabeceras de seguridad y CSP, enlaces firmados HMAC para que el huésped vea su reserva (secreto en APP_SECRET).
- Actualiza vercel.json: el sitio real en /, la demo compilada en /demo. La demo no debe tocar la API real.

Etapa 4 · Panel con Supabase Auth
- Reemplaza server/auth.js por Supabase Auth (correo y contraseña). El panel inicia sesión con supabase-js en el navegador y manda el access token; el servidor lo valida con supabase.auth.getUser(token) y además revisa que el correo esté en una tabla admins. Sin registro público.
- Fotos: el panel sube a Storage a través de la API (o con URL firmada de subida) y guarda la URL pública en rooms.photos. Mantén el achicado de imágenes que ya hace el panel.
- El registro de acciones (audit_log) guarda quién hizo cada cambio.

Etapa 5 · Tareas programadas
- Vercel Hobby solo permite cron una vez al día, así que usa pg_cron + pg_net de Supabase para llamar cada 15 minutos a /api/cron/ical (importar calendarios de Booking) y cada 1 minuto a /api/cron/correos (enviar email_outbox con Resend si hay RESEND_API_KEY). Protege esas rutas con CRON_SECRET en un header.
- Vencer reservas no pagadas: hazlo en SQL (función que libera night_locks con hold_until vencido) llamada por pg_cron cada minuto, y también al inicio de cada búsqueda como hoy.

Etapa 6 · Sin datos de ejemplo
- Crea supabase/seed.sql SOLO con: settings reales (de core/seed.js seedSettings sin demo), las 5 habitaciones reales, temporadas y descuentos marcados como borrador (active=false) y los cargos almuerzo, cena y lavandería apagados sin precio. Nada de reservas, huéspedes ni pagos ficticios.
- core/seed.js y web/demo.js quedan solo para la demo. El servidor real no debe sembrar nada automáticamente si la base está vacía; en vez de eso muestra un aviso en el panel.
- Tarifas: las 5 habitaciones siguen con rateStatus 'estimada' hasta que el dueño las confirme en el panel.

Etapa 7 · Pagos y prueba final
- Webpay: WEBPAY_ENV=integracion con las credenciales públicas de prueba de Transbank (ya están en server/payments/webpay.js) hasta que el dueño entregue las de producción. BASE_URL debe ser la URL pública de Vercel.
- Prueba de punta a punta en la URL de Vercel: buscar, elegir habitación, pagar anticipo con la tarjeta de prueba de Transbank, ver la reserva, cambiar fechas, cancelar con devolución, y revisar en el panel el pago, la comisión y el neto. También en celular (390 px) y modo oscuro.
- Actualiza README.md (variables de entorno, cómo desplegar, cómo respaldar) y GUIA.md (qué es real ahora y qué falta).

Variables de entorno esperadas (.env.example): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, APP_SECRET, CRON_SECRET, BASE_URL, WEBPAY_ENV, WEBPAY_COMMERCE_CODE, WEBPAY_API_KEY, RESEND_API_KEY, MAIL_FROM.

Trabaja en una rama nueva (produccion-supabase), haz commits pequeños por etapa y no la mezcles a main sin mi OK. Si falta una llave o un dato, deja la tarea marcada como pendiente y sigue con lo demás.
````
