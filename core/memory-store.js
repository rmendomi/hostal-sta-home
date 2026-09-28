// Store en memoria con la misma interfaz que el de SQLite. Lo usan la demo del
// navegador (con persistencia opcional en localStorage) y las pruebas.

import { ConflictError } from './service.js';

export function createMemoryStore(initial = null, { persist = null } = {}) {
  let state = initial ? structuredClone(initial) : { settings: {}, seq: 1, tables: {}, locks: {} };
  let depth = 0;
  let snapshot = null;

  const table = (k) => (state.tables[k] ||= {});
  const save = () => { if (depth === 0 && persist) persist(state); };
  const matches = (row, filter) => !filter || Object.entries(filter).every(([k, v]) => row[k] === v);
  const lockKey = (roomId, night) => `${roomId}|${night}`;

  return {
    raw: () => state,
    getSettings: () => structuredClone(state.settings),
    saveSettings(s) { state.settings = structuredClone(s); save(); },
    list(kind, filter) { return Object.values(table(kind)).filter((r) => matches(r, filter)).map((r) => structuredClone(r)); },
    get(kind, id) { const r = table(kind)[id]; return r ? structuredClone(r) : null; },
    insert(kind, obj) {
      const id = obj.id || `${kind.slice(0, 2)}_${(state.seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      table(kind)[id] = structuredClone({ ...obj, id });
      save();
      return structuredClone(table(kind)[id]);
    },
    update(kind, id, patch) {
      if (!table(kind)[id]) throw new Error(`No existe ${kind}/${id}`);
      table(kind)[id] = structuredClone({ ...table(kind)[id], ...patch, id });
      save();
      return structuredClone(table(kind)[id]);
    },
    remove(kind, id) { delete table(kind)[id]; save(); },
    findBookingByCode(code) { return this.list('bookings', { code })[0] || null; },
    locksFor(roomIds, from, to) {
      const set = new Set(roomIds);
      return Object.values(state.locks).filter((l) => set.has(l.roomId) && l.night >= from && l.night <= to).map((l) => ({ ...l }));
    },
    addLocks(locks) {
      for (const l of locks) if (state.locks[lockKey(l.roomId, l.night)]) throw new ConflictError();
      for (const l of locks) state.locks[lockKey(l.roomId, l.night)] = { roomId: l.roomId, night: l.night, bookingId: l.bookingId || null, blockId: l.blockId || null };
      save();
    },
    removeLocks({ bookingId, blockId }) {
      for (const [k, l] of Object.entries(state.locks)) {
        if ((bookingId && l.bookingId === bookingId) || (blockId && l.blockId === blockId)) delete state.locks[k];
      }
      save();
    },
    // Transacción: si algo falla dentro, se vuelve al estado anterior.
    tx(fn) {
      if (depth === 0) snapshot = structuredClone(state);
      depth++;
      try {
        const r = fn();
        depth--;
        save();
        return r;
      } catch (e) {
        depth--;
        if (depth === 0) state = snapshot;
        throw e;
      }
    },
  };
}
