# Tareas programadas en cPanel

La aplicación ya hace sola casi todo el mantenimiento cada vez que alguien usa
el sitio o el panel: envía los correos pendientes, libera las reservas que no
se pagaron a tiempo y hace el respaldo del día si todavía no existe. Los Cron
Jobs son solo un respaldo para los momentos sin visitas, así que bastan dos.

En cPanel → **Cron Jobs** → "Add New Cron Job", escribe los campos a mano y pega
el comando. Reemplaza `TU-FRASE` por tu `TAREAS_SECRET` (la misma frase que
pusiste en Setup Node.js App).

| Qué hace | Minuto | Hora | Día | Mes | Día semana | Comando |
|---|---|---|---|---|---|---|
| Enviar correos en cola y liberar reservas no pagadas | `*/30` | `*` | `*` | `*` | `*` | `curl -fsS --max-time 60 -X POST -d "" -H "X-Tarea-Clave: TU-FRASE" https://hostalsantaelena.cl/tareas/correos > /dev/null` |
| Respaldo diario de la base | `0` | `4` | `*` | `*` | `*` | `curl -fsS --max-time 120 -X POST -d "" -H "X-Tarea-Clave: TU-FRASE" https://hostalsantaelena.cl/tareas/respaldo > /dev/null` |

**Importante:** el `-d ""` es obligatorio. El hosting descarta los POST que
llegan sin cuerpo y responde 404 antes de que lleguen a la aplicación.

La tarea `/tareas/correos` también libera las reservas vencidas, así que no
hace falta un cron aparte para `/tareas/vencer` (la ruta sigue existiendo por
si se quiere usar).

## Avisos por correo

Con `-fsS` y `> /dev/null`, cPanel solo manda un correo cuando una tarea falla.
Si prefieres no recibir ninguno, borra el correo en "Cron Email", arriba de la
lista de Cron Jobs. El estado de cada tarea se puede ver igual en Panel →
Ajustes → "Tareas programadas" (muestra la hora de la última llamada).
