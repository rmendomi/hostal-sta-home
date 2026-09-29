# Tareas programadas en cPanel

El hosting apaga la aplicación cuando no hay visitas, así que las tareas que se
repiten las dispara cPanel → **Cron Jobs**. Cada línea llama a la aplicación con
la clave `TAREAS_SECRET` (la misma frase que pusiste en Setup Node.js App).

En cPanel → Cron Jobs → "Add New Cron Job", en "Common Settings" elige
"Once Per Five Minutes" o escribe los campos a mano, y pega el comando.
Reemplaza `TU-FRASE` por tu `TAREAS_SECRET`.

| Qué hace | Minuto | Hora | Día | Mes | Día semana | Comando |
|---|---|---|---|---|---|---|
| Enviar correos en cola | `*/5` | `*` | `*` | `*` | `*` | `curl -fsS --max-time 60 -X POST -H "X-Tarea-Clave: TU-FRASE" https://hostalsantaelena.cl/tareas/correos > /dev/null` |
| Liberar reservas no pagadas | `*/5` | `*` | `*` | `*` | `*` | `curl -fsS --max-time 60 -X POST -H "X-Tarea-Clave: TU-FRASE" https://hostalsantaelena.cl/tareas/vencer > /dev/null` |
| Respaldo diario de la base | `0` | `4` | `*` | `*` | `*` | `curl -fsS --max-time 120 -X POST -H "X-Tarea-Clave: TU-FRASE" https://hostalsantaelena.cl/tareas/respaldo > /dev/null` |

Arriba de la lista de Cron Jobs, en "Cron Email", puedes dejar tu correo: si
una tarea falla, cPanel te avisa (con `-fsS` solo escribe cuando hay error).

Para comprobar que funcionan: Panel → Ajustes muestra la lista de respaldos
(aparece uno nuevo cada día).
