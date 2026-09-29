# Guía rápida · Reservas directas Santa Elena de Maipo Home

## Qué es real y qué es de demostración

| Parte | Estado |
|---|---|
| Búsqueda, disponibilidad, bloqueo de noches, reserva, cambio y cancelación | **Operativo.** Probado, incluido el caso de dos personas reservando la misma noche al mismo tiempo. |
| Cálculo de precios, anticipo, saldo, IVA y comisiones | **Operativo.** Probado con casos reales de temporada, descuento, persona extra y niños. |
| Panel: reservas, calendario, habitaciones, fotos, tarifas, cobros | **Operativo.** |
| Pago con Webpay Plus | **Programado según la API de Transbank, falta conectarlo.** En la demo el pago es simulado. |
| Correos de confirmación | **Listos; falta la cuenta de envío.** Mientras tanto quedan en cola en el panel. |
| Habitaciones, camas, baños, servicios y hora de salida | **Datos reales**, confirmados por la familia. |
| Tarifas por noche | **Estimadas.** Aparecen como "Estimada" en Tarifas hasta que pongas el precio real y guardes. |
| Almuerzo, cena y lavandería | **Sin precio.** Están creados pero apagados; al ponerles monto en Tarifas → Cargos extra y activarlos, el huésped puede agregarlos al reservar. Mientras tanto el sitio dice que se piden y pagan en el hostal. |
| Fotos | **No hay.** Se muestra un plano referencial de cada habitación hasta que subas fotos. |
| Reservas del panel de la demo | **Ficticias**, con la palabra "(ejemplo)" en el nombre. El sitio real en hostalsantaelena.cl parte sin reservas ni datos de ejemplo. |
| Temporadas y descuentos | **Borrador.** En el sitio real vienen apagados; enciéndelos en Tarifas si los quieres usar. |
| Respaldos | **Automáticos** una vez al día; se descargan en Panel → Ajustes → Respaldos. |

La demo guarda todo en tu navegador. Para volver al inicio: Panel → Ajustes → Reiniciar demostración.

## Administrar el día a día

- **Hoy**: quién llega, quién sale, a quién cobrar el saldo, y un resumen del mes (cobrado, comisiones, lo que recibes, ocupación).
- **Reservas**: busca por nombre, código o teléfono. Al abrir una reserva ves los datos del huésped, cada pago con su comisión y lo que recibes, y el historial. Desde ahí registras el pago del saldo (efectivo, transferencia o tarjeta en el hostal), marcas llegada y salida, cambias fechas o cancelas.
- **Nueva reserva**: para reservas por teléfono o WhatsApp. Queda confirmada y bloquea las noches.
- **Calendario**: una fila por habitación. Toca una noche libre para bloquearla (mantención, uso propio) o crear una reserva.
- **Habitaciones**: nombre, descripción, camas, capacidad, fotos (se achican solas al subirlas). Marca "Revisé estos datos" cuando estén correctos.
- **Tarifas**: tarifa base por noche, temporadas (sube o baja un %), descuentos (se aplica solo el mejor) y cargos extra. El simulador muestra exactamente lo que verá y pagará un huésped.
- **Cobros**: anticipo, cancelación y plazos; resumen de lo cobrado, comisiones de Webpay, devoluciones y neto.
- **Ajustes**: datos del hostal, reglas de la casa, respaldos, correo y contraseña.

## Cómo se calcula lo que paga el huésped

1. Cada noche vale la tarifa base de la habitación, ajustada si cae en una temporada.
2. Se suma la persona adicional (adultos sobre los incluidos). Menores de 12 no pagan.
3. Se descuenta el mejor descuento que corresponda, solo sobre el alojamiento.
4. Se suman los extras que el huésped elige (y los obligatorios, si creas alguno).
5. El total incluye IVA. El huésped paga hoy el anticipo (30 %) y el resto al llegar. Si faltan 2 días o menos, paga el total.

La comisión de Webpay la pagas tú, no el huésped. El sitio se lo explica y en el panel ves el neto de cada pago.

## Costos de operación

| Concepto | Costo | Fuente |
|---|---|---|
| Webpay Plus | Sin mensualidad. 1,75 % + IVA por venta con débito o prepago, 2,35 % + IVA con crédito (mínimo 0,00226 / 0,003515 UF). Abono en 24 h hábiles (débito) y 48 h hábiles (crédito). | [Transbank](https://ayuda.transbank.cl/tarifas-vender-webpay), revisado 26-09-2026 |
| Hosting NinjaHosting Wako | $59.900 + IVA al año | [NinjaHosting](https://www.ninjahosting.cl/web-hosting-chile) |
| Dominio .cl | $9.990 al año | [NIC Chile](https://www.nic.cl/dominios/tarifas.html) |
| Correos (Resend) | Gratis hasta 3.000 al mes y 100 al día | [Resend](https://resend.com/pricing) |

Ejemplo: una reserva de 2 noches en la Habitación doble ($76.000 con la tarifa estimada) con anticipo de $22.800 pagado con débito deja una comisión de $475 (IVA incluido). El saldo de $53.200 pagado en efectivo no tiene comisión.

Como comparación: Flow cobra 2,89 % + IVA ([Flow](https://web.flow.cl/es-cl/tarifas/)) y Mercado Pago 3,19 % + IVA. Webpay es el más barato de los tres.

## Pendiente para publicar

1. **Tus datos reales**: tarifa de cada habitación y de la cabaña, precio del almuerzo, la cena y la lavandería, y fotos. Se cambian en el panel.
2. **Decisiones de cobro**: confirmar anticipo 30 %, cancelación gratis hasta 7 días antes y cambios hasta 3 días antes (se ajustan en Cobros).
3. **Transbank**: contratar Webpay Plus. Si no tienes inicio de actividades en el SII, cada pago queda limitado a $200.000. Transbank valida la integración antes de entregar el código de comercio y la llave de producción.
4. **Publicar en NinjaHosting**: seguir [docs/DESPLIEGUE-NINJAHOSTING.md](docs/DESPLIEGUE-NINJAHOSTING.md) (hosting Wako y dominio hostalsantaelena.cl ya contratados).
5. **Correo**: crear cuenta gratuita en Resend y verificar el dominio para que los correos no lleguen a spam.
6. **Textos legales**: revisar con tu contador si emites boleta electrónica y si aplicará la exención de IVA a turistas extranjeros.
