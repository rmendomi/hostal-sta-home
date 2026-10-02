// Datos iniciales. Habitaciones, servicios y hora de salida confirmados por la
// familia (26-09-2026). Las políticas de la casa y la hora de llegada vienen de
// la ficha pública del hostal. Las tarifas son ESTIMADAS: el único precio
// público era "desde 53 € por noche". Lo marcado 'por_confirmar' o 'estimada'
// debe revisarlo el dueño en el panel.

export const PROVIDER_WEBPAY = {
  provider: 'webpay',
  providerName: 'Webpay Plus (Transbank)',
  environment: 'integracion', // 'integracion' (pruebas) | 'produccion'
  // Comisiones publicadas por Transbank para nuevos comercios, sin IVA.
  rates: { credit: 0.0235, debit: 0.0175, prepaid: 0.0175 },
  minFeeUF: { credit: 0.003515, debit: 0.00226, prepaid: 0.00226 },
  feeVatRate: 0.19,
  ufValue: 41016, // UF del 25-09-2026 (mindicador.cl). Actualizar en el panel.
  monthlyFee: 0,
  payoutDays: { debit: '24 horas hábiles', credit: '48 horas hábiles' },
  source: 'https://ayuda.transbank.cl/tarifas-vender-webpay',
  verifiedAt: '2026-09-26',
};

export function seedSettings({ demo = false } = {}) {
  return {
    demo,
    business: {
      name: 'Santa Elena de Maipo Home',
      shortName: 'Santa Elena',
      legalName: '',
      rut: '',
      address: 'San Lucas 02125, Villa Santa Elena de Maipo, Temuco, Araucanía',
      city: 'Temuco',
      phone: '+56 9 5519 5410',
      whatsapp: '56955195410',
      email: '',
      checkinFrom: '15:00',
      checkoutUntil: '11:00',
      timezone: 'America/Santiago',
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=San+Lucas+02125+Temuco',
      googleRating: 4.7,
      googleReviews: 133,
    },
    currency: 'CLP',
    pricesIncludeVat: true,
    vatRate: 0.19,
    rateRounding: 100,
    maxDaysAhead: 540,
    holdMinutes: 15,
    deposit: { mode: 'percent', percent: 30, fullIfWithinDays: 2 },
    cancellation: { freeUntilDays: 7 },
    modification: { freeUntilDays: 3 },
    payment: { ...PROVIDER_WEBPAY },
    houseRules: [
      'Llegada desde las 15:00 y salida hasta las 11:00.',
      'No se admiten mascotas.',
      'Habitaciones para no fumadores; hay zona habilitada para fumar.',
      'No se permiten fiestas ni eventos.',
      'Niños de cualquier edad son bienvenidos. Menores de 12 años no pagan usando las camas existentes.',
    ],
    dataStatus: 'por_confirmar',
  };
}

// Habitaciones confirmadas por la familia el 26-09-2026. Las tarifas siguen
// siendo ESTIMADAS (rateStatus: 'estimada') hasta que el dueño las confirme.
const COMMON = ['Desayuno incluido', 'Wifi', 'TV', 'Calefacción', 'Toallas y ropa de cama', 'Estacionamiento'];

export const seedRooms = [
  {
    id: 'hab-doble',
    name: 'Habitación doble',
    shortName: 'Doble',
    description: 'Una cama doble para dos personas, abrigada y tranquila. Baño compartido con las otras habitaciones de la casa. Desayuno incluido.',
    sizeM2: null, beds: '1 cama doble', bathroom: 'compartido', kitchen: false, view: '',
    baseOccupancy: 2, maxGuests: 2, baseRate: 38000, extraGuestFee: 0, minNights: 1,
    amenities: [...COMMON, 'Baño compartido'],
    photos: [], active: true, sort: 1, dataStatus: 'confirmado', rateStatus: 'estimada',
  },
  {
    id: 'hab-twin',
    name: 'Habitación con dos camas',
    shortName: 'Dos camas',
    description: 'Dos camas de una plaza, para amigos, colegas o quien prefiera dormir por separado. Baño compartido. Desayuno incluido.',
    sizeM2: null, beds: '2 camas de una plaza', bathroom: 'compartido', kitchen: false, view: '',
    baseOccupancy: 2, maxGuests: 2, baseRate: 38000, extraGuestFee: 0, minNights: 1,
    amenities: [...COMMON, 'Baño compartido'],
    photos: [], active: true, sort: 2, dataStatus: 'confirmado', rateStatus: 'estimada',
  },
  {
    id: 'hab-triple',
    name: 'Habitación triple',
    shortName: 'Triple',
    description: 'Una cama doble y una de una plaza: cabe una pareja con un hijo o tres amigos. Baño compartido. Desayuno incluido.',
    sizeM2: null, beds: '1 cama doble y 1 cama de una plaza', bathroom: 'compartido', kitchen: false, view: '',
    baseOccupancy: 2, maxGuests: 3, baseRate: 45000, extraGuestFee: 10000, minNights: 1,
    amenities: [...COMMON, 'Baño compartido'],
    photos: [], active: true, sort: 3, dataStatus: 'confirmado', rateStatus: 'estimada',
  },
  {
    id: 'hab-privado',
    name: 'Habitación triple con baño privado',
    shortName: 'Baño privado',
    description: 'Tres camas de una plaza y baño propio. Cómoda para grupos de trabajo o viajeros que quieren su propio espacio. Desayuno incluido.',
    sizeM2: null, beds: '3 camas de una plaza', bathroom: 'privado', kitchen: false, view: '',
    baseOccupancy: 2, maxGuests: 3, baseRate: 48000, extraGuestFee: 10000, minNights: 1,
    amenities: [...COMMON, 'Baño privado'],
    photos: [], active: true, sort: 4, dataStatus: 'confirmado', rateStatus: 'estimada',
  },
  {
    id: 'cabana',
    name: 'Cabaña',
    shortName: 'Cabaña',
    description: 'Independiente de la casa, con cama doble, una cama de una plaza, baño y cocina propios. Para familias o estadías largas.',
    sizeM2: null, beds: '1 cama doble y 1 cama de una plaza', bathroom: 'privado', kitchen: true, view: '',
    baseOccupancy: 2, maxGuests: 3, baseRate: 55000, extraGuestFee: 10000, minNights: 1,
    amenities: [...COMMON.filter((a) => a !== 'Desayuno incluido'), 'Baño privado', 'Cocina propia'],
    photos: [], active: true, sort: 5, dataStatus: 'confirmado', rateStatus: 'estimada',
  },
];

export const seedSeasons = [
  { id: 'temp-verano', name: 'Verano 2027', start: '2026-12-26', end: '2027-02-28', adjustPct: 15, minNights: 2, priority: 1, roomIds: [], active: true },
  { id: 'temp-fiestas', name: 'Fiestas Patrias 2027', start: '2027-09-16', end: '2027-09-19', adjustPct: 20, minNights: 2, priority: 2, roomIds: [], active: true },
  { id: 'temp-invierno', name: 'Vacaciones de invierno 2027', start: '2027-07-05', end: '2027-07-18', adjustPct: 10, minNights: null, priority: 1, roomIds: [], active: true },
];

export const seedDiscounts = [
  { id: 'desc-semana', name: 'Estadía de 7 noches o más', type: 'estadia', pct: 10, minNights: 7, minDaysAhead: null, active: true },
  { id: 'desc-anticipada', name: 'Reserva con 45 días de anticipación', type: 'anticipacion', pct: 5, minNights: null, minDaysAhead: 45, active: true },
];

// Servicios que ofrece la casa. Sin precio aún: quedan desactivados (no se
// ofrecen en línea) hasta que el dueño ponga el monto en Tarifas → Cargos extra.
export const seedCharges = [
  { id: 'cargo-almuerzo', name: 'Almuerzo', description: 'Almuerzo casero, a pedido.', unit: 'persona', amount: 0, mandatory: false, active: false, status: 'por_confirmar' },
  { id: 'cargo-cena', name: 'Cena', description: 'Cena casera, a pedido.', unit: 'persona', amount: 0, mandatory: false, active: false, status: 'por_confirmar' },
  { id: 'cargo-lavanderia', name: 'Lavandería', description: 'Lavado de ropa durante la estadía.', unit: 'reserva', amount: 0, mandatory: false, active: false, status: 'por_confirmar' },
];

export function seedAll(store, { demo = false } = {}) {
  store.saveSettings(seedSettings({ demo }));
  for (const r of seedRooms) store.insert('rooms', r);
  for (const s of seedSeasons) store.insert('seasons', s);
  for (const d of seedDiscounts) store.insert('discounts', d);
  for (const c of seedCharges) store.insert('charges', c);
}

// Siembra para el sistema real: solo datos verdaderos del hostal. Temporadas y
// descuentos quedan como borrador (apagados) hasta que el dueño los revise;
// nunca se crean reservas, huéspedes ni pagos.
export function seedProduction(store) {
  const settings = seedSettings({ demo: false });
  store.saveSettings({ ...settings, business: { ...settings.business, email: '' } });
  for (const r of seedRooms) store.insert('rooms', r);
  for (const s of seedSeasons) store.insert('seasons', { ...s, active: false });
  for (const d of seedDiscounts) store.insert('discounts', { ...d, active: false });
  for (const c of seedCharges) store.insert('charges', c);
}
