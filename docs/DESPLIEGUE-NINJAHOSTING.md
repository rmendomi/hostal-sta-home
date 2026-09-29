# Publicar el sitio en NinjaHosting (paso a paso)

Todo se hace desde cPanel (o FileZilla): el plan no tiene SSH ni Git.
**Nunca compartas tu contraseña de cPanel en el chat.**

En estas instrucciones, `USUARIO` es tu usuario de cPanel (aparece arriba a la
derecha en cPanel y en "Información general").

## 1. Pedir a soporte que desactive ModSecurity

Abre un ticket en NinjaHosting:

> Hola, por favor desactiven ModSecurity para el dominio hostalsantaelena.cl
> (o al menos para la ruta /pago/retorno). Transbank Webpay devuelve al
> cliente con un POST a esa ruta y el filtro puede bloquearlo. Gracias.

## 2. Activar el certificado SSL (https)

cPanel → **SSL/TLS Status** → marca `hostalsantaelena.cl` y
`www.hostalsantaelena.cl` → **Run AutoSSL**. Puede tardar unos minutos.

## 3. Subir el código

Hay dos caminos; usa uno.

### A. Administrador de archivos de cPanel (más simple)

1. Descarga el paquete `hostalsantaelena-app.zip` (lo entrega Claude en el
   proyecto; contiene solo lo necesario: `app.cjs`, `package.json`, `core`,
   `server` y `web`).
2. cPanel → **Administrador de archivos**. Estás en `/home/USUARIO`.
3. Crea las carpetas `hostalsantaelena-app` y `santaelena-data` (botón
   "+ Carpeta"). No las crees dentro de `public_html`.
4. Entra a `hostalsantaelena-app` → **Cargar** → sube el ZIP.
5. Vuelve, marca el ZIP → **Extraer** → destino `/home/USUARIO/hostalsantaelena-app`.
   Debe quedar `app.cjs` directamente dentro de `hostalsantaelena-app`.
6. Borra el ZIP. `santaelena-data` queda vacía: la aplicación la llena sola.

### B. FileZilla

1. En https://github.com/rmendomi/hostal-sta-home → **Code** → **Download ZIP**
   y descomprímelo en tu computador.
2. FileZilla → Archivo → **Gestor de sitios** → Nuevo sitio: Servidor
   `ftp.hostalsantaelena.cl`, puerto `21`, cifrado **Requiere FTP explícito
   sobre TLS**, tu usuario y contraseña de cPanel.
3. En el servidor quédate en `/home/USUARIO` (no en `public_html`), crea
   `hostalsantaelena-app` y `santaelena-data`, y sube a `hostalsantaelena-app`:
   `app.cjs`, `package.json` y las carpetas `core`, `server` y `web`.
   No subas `node_modules`, `.git`, `demo`, `docs`, `tests` ni `scripts`.

## 4. Crear la aplicación Node.js

cPanel → **Setup Node.js App** → **Create Application**:

| Campo | Valor |
|---|---|
| Node.js version | **24.18.0** |
| Application mode | **Production** |
| Application root | `hostalsantaelena-app` |
| Application URL | `hostalsantaelena.cl` |
| Application startup file | `app.cjs` |

En "Environment variables" → **Add variable**, una por una:

| Variable | Valor |
|---|---|
| `BASE_URL` | `https://hostalsantaelena.cl` |
| `DATA_DIR` | `/home/USUARIO/santaelena-data` |
| `TAREAS_SECRET` | una frase larga inventada por ti, sin espacios (ej. `nubes-araucaria-2026-copihue-llaima`) |
| `WEBPAY_ENV` | `integracion` |
| `INICIAR_BASE` | `1` (solo la primera vez) |
| `ADMIN_EMAIL` | tu correo (solo la primera vez) |
| `ADMIN_PASSWORD` | una contraseña de 10 o más caracteres (solo la primera vez) |

Aprieta **Create**. "Run NPM Install" no es necesario: el sistema no usa
paquetes externos. Luego **Restart**.

## 5. Revisar y limpiar

1. Abre https://hostalsantaelena.cl: deben aparecer las 5 habitaciones.
2. Entra al panel: https://hostalsantaelena.cl/#/panel con tu correo y contraseña.
3. Vuelve a Setup Node.js App → edita la app → **borra** `INICIAR_BASE`,
   `ADMIN_EMAIL` y `ADMIN_PASSWORD` → Save → **Restart**. Tu usuario ya quedó
   guardado; desde el panel (Ajustes → Seguridad) puedes cambiar correo y contraseña.

Si en vez del sitio aparece "El sitio no pudo iniciar", la página dice qué
revisar (casi siempre la ruta de `DATA_DIR`).

## 6. Tareas programadas

cPanel → **Cron Jobs**: agrega las 4 líneas de [CRON.md](CRON.md) con tu
`TAREAS_SECRET`.

## 7. Poner tus datos reales

En el panel:
- **Tarifas**: el precio real de cada habitación y la cabaña → Guardar (se quita "Estimada").
- **Tarifas → Temporadas y Descuentos**: vienen apagados; enciende los que quieras usar.
- **Tarifas → Cargos extra**: precio de almuerzo, cena y lavandería, y actívalos.
- **Habitaciones**: fotos y medidas.
- **Cobros**: anticipo, cancelación y plazos.
- **Ajustes**: correo de contacto, razón social y RUT.

## 8. Probar un pago (sin cobrar)

Haz una reserva en el sitio. En Webpay de prueba usa la tarjeta de prueba de
Transbank: VISA `4051 8856 0044 6623`, CVV `123`, cualquier fecha futura;
RUT `11.111.111-1`, clave `123`. Revisa la reserva en el panel: pago,
comisión y neto.

## Actualizar el sitio más adelante

1. Descarga el `hostalsantaelena-app.zip` nuevo (o el ZIP de GitHub).
2. Súbelo a `hostalsantaelena-app` y extráelo encima (acepta sobrescribir),
   con el Administrador de archivos o con FileZilla.
3. cPanel → Setup Node.js App → **Restart**.

Nunca borres ni reemplaces `santaelena-data`: ahí están las reservas.

## Respaldos

- Se hace uno al día (cron) y se guardan los últimos 14 en
  `santaelena-data/respaldos`. También puedes crear uno en Panel → Ajustes →
  Respaldos → "Respaldar ahora" y descargarlo.
- **Restaurar** (solo si algo salió mal): en Setup Node.js App → **Stop App**.
  En FileZilla, dentro de `santaelena-data`, borra `reservas.db`,
  `reservas.db-wal` y `reservas.db-shm`, copia el respaldo elegido desde
  `respaldos/` y renómbralo `reservas.db`. Luego **Start App**.

## Cuando tengas Webpay de producción

Transbank te entrega el código de comercio y la llave. En Setup Node.js App:
`WEBPAY_ENV=produccion`, `WEBPAY_COMMERCE_CODE=…`, `WEBPAY_API_KEY=…` →
Restart. Desde ese momento los pagos son reales.

## Correos de confirmación (Resend)

Crea una cuenta gratis en resend.com, agrega el dominio `hostalsantaelena.cl`
y copia los registros TXT/CNAME que te da en cPanel → **Zone Editor**. Cuando
Resend lo marque como verificado, crea una API key y agrégala en Setup Node.js
App: `RESEND_API_KEY=…` y `MAIL_FROM=Hostal Santa Elena <reservas@hostalsantaelena.cl>` → Restart.
