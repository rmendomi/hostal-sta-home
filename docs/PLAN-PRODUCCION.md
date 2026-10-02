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
| Conexiones salientes | HTTPS sin restricción (Flow, Resend) |
| ModSecurity | Activo; soporte puede desactivarlo para el sitio |
| SSH / Terminal | **No hay.** Todo se hace desde cPanel |
| Git en cPanel | **No soportado.** El código se sube por FTP (FileZilla) |
| DNS | Editor de zonas disponible (para Resend: TXT y CNAME) |

Respuestas de soporte NinjaHosting, ticket #499054 (29-09-2026).

## Estado (29-09-2026)

Las cuatro etapas del plan están hechas en el código:

1. **Arranque en cPanel:** `app.cjs` como archivo de inicio (Passenger lo carga con `require()`), sin avisos de SQLite, `TRUST_PROXY` automático y una página que explica el problema si la carpeta de datos no sirve.
2. **Tareas programadas:** `/tareas/correos`, `/tareas/vencer` y `/tareas/respaldo`, protegidas con `TAREAS_SECRET`, para llamarlas desde Cron Jobs ([CRON.md](CRON.md)). Respaldo diario consistente con los últimos 14.
3. **Sin datos de ejemplo:** la base parte vacía y `INICIAR_BASE=1` carga solo lo real (5 habitaciones, políticas; temporadas y descuentos apagados; almuerzo, cena y lavandería sin precio). Panel → Ajustes permite cambiar correo y contraseña y descargar respaldos.
4. **Documentación y pruebas:** [DESPLIEGUE-NINJAHOSTING.md](DESPLIEGUE-NINJAHOSTING.md) con el paso a paso solo con cPanel y FileZilla; 30 pruebas automáticas (incluida una reserva simultánea entre dos procesos) y recorrido completo en navegador con pago simulado.

Queda para el dueño: los pasos de cPanel de [DESPLIEGUE-NINJAHOSTING.md](DESPLIEGUE-NINJAHOSTING.md), tarifas y fotos reales, crear la cuenta de Flow y crear la cuenta de Resend.

## Costos

| Servicio | Costo | Fuente |
|---|---|---|
| NinjaHosting Wako | $59.900 + IVA al año (ya contratado) | [ninjahosting.cl](https://www.ninjahosting.cl/web-hosting-chile) |
| Dominio hostalsantaelena.cl | $9.990 al año (ya comprado) | [nic.cl](https://www.nic.cl/dominios/tarifas.html) |
| SSL, cron, base de datos | Incluidos | — |
| Flow | Sin mensualidad; 3,19 % + IVA con Webpay, abono al día hábil siguiente | [Flow](https://www.flow.cl) |
| Correos (Resend) | Gratis hasta 3.000 al mes | [resend.com](https://resend.com/pricing) |
| Demo en Vercel | Gratis | — |
