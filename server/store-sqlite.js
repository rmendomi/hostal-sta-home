// Base de datos SQLite (un archivo, sin servidor aparte). Cada tipo de registro
// es una tabla (id, data JSON). Las noches ocupadas viven en su propia tabla con
// clave primaria (habitación, noche): la base de datos misma impide que dos
// reservas tomen la misma noche, aunque lleguen al mismo tiempo.

import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { ConflictError } from '../core/service.js';

const KINDS = ['rooms', 'seasons', 'discounts', 'charges', 'bookings', 'blocks', 'payments', 'outbox', 'admins', 'sessions', 'audit'];

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)');
  for (const k of KINDS) db.exec(`CREATE TABLE IF NOT EXISTS ${k} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS night_locks (
      room_id TEXT NOT NULL,
      night TEXT NOT NULL,
      booking_id TEXT,
      block_id TEXT,
      PRIMARY KEY (room_id, night)
    );
    CREATE INDEX IF NOT EXISTS night_locks_booking ON night_locks (booking_id);
    CREATE INDEX IF NOT EXISTS night_locks_block ON night_locks (block_id);
    CREATE UNIQUE INDEX IF NOT EXISTS bookings_code ON bookings (json_extract(data, '$.code'));
    CREATE INDEX IF NOT EXISTS bookings_status ON bookings (json_extract(data, '$.status'));
    CREATE INDEX IF NOT EXISTS payments_booking ON payments (json_extract(data, '$.bookingId'));
    CREATE INDEX IF NOT EXISTS payments_ref ON payments (json_extract(data, '$.providerRef'));
    CREATE INDEX IF NOT EXISTS sessions_hash ON sessions (json_extract(data, '$.tokenHash'));
  `);

  const cache = new Map();
  const q = (sql) => { if (!cache.has(sql)) cache.set(sql, db.prepare(sql)); return cache.get(sql); };
  const check = (kind) => { if (!KINDS.includes(kind)) throw new Error(`Tipo desconocido: ${kind}`); };
  const row = (r) => (r ? JSON.parse(r.data) : null);
  let depth = 0;

  return {
    db,
    close: () => db.close(),
    getSettings() { return row(q('SELECT data FROM settings WHERE id = 1').get()) || {}; },
    saveSettings(s) { q('INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data').run(JSON.stringify(s)); },
    list(kind, filter) {
      check(kind);
      const keys = Object.keys(filter || {});
      for (const k of keys) if (!/^[a-zA-Z0-9_]+$/.test(k)) throw new Error('Filtro inválido');
      const where = keys.length ? ` WHERE ${keys.map((k) => `json_extract(data, '$.${k}') = ?`).join(' AND ')}` : '';
      const vals = keys.map((k) => (typeof filter[k] === 'boolean' ? (filter[k] ? 1 : 0) : filter[k]));
      return q(`SELECT data FROM ${kind}${where}`).all(...vals).map(row);
    },
    get(kind, id) { check(kind); return row(q(`SELECT data FROM ${kind} WHERE id = ?`).get(id)); },
    insert(kind, obj) {
      check(kind);
      const id = obj.id || `${kind.slice(0, 2)}_${randomBytes(6).toString('hex')}`;
      const full = { ...obj, id };
      q(`INSERT INTO ${kind} (id, data) VALUES (?, ?)`).run(id, JSON.stringify(full));
      return full;
    },
    update(kind, id, patch) {
      check(kind);
      const cur = this.get(kind, id);
      if (!cur) throw new Error(`No existe ${kind}/${id}`);
      const full = { ...cur, ...patch, id };
      q(`UPDATE ${kind} SET data = ? WHERE id = ?`).run(JSON.stringify(full), id);
      return full;
    },
    remove(kind, id) { check(kind); q(`DELETE FROM ${kind} WHERE id = ?`).run(id); },
    findBookingByCode(code) { return row(q("SELECT data FROM bookings WHERE json_extract(data, '$.code') = ?").get(code)); },
    locksFor(roomIds, from, to) {
      if (!roomIds.length) return [];
      const ph = roomIds.map(() => '?').join(',');
      return q(`SELECT room_id AS roomId, night, booking_id AS bookingId, block_id AS blockId FROM night_locks WHERE room_id IN (${ph}) AND night BETWEEN ? AND ? ORDER BY night`)
        .all(...roomIds, from, to).map((r) => ({ ...r }));
    },
    addLocks(locks) {
      const ins = q('INSERT INTO night_locks (room_id, night, booking_id, block_id) VALUES (?, ?, ?, ?)');
      this.tx(() => {
        for (const l of locks) {
          try {
            ins.run(l.roomId, l.night, l.bookingId || null, l.blockId || null);
          } catch (e) {
            if (String(e.message).includes('UNIQUE') || String(e.message).includes('PRIMARY KEY')) throw new ConflictError();
            throw e;
          }
        }
      });
    },
    removeLocks({ bookingId, blockId }) {
      if (bookingId) q('DELETE FROM night_locks WHERE booking_id = ?').run(bookingId);
      if (blockId) q('DELETE FROM night_locks WHERE block_id = ?').run(blockId);
    },
    // Transacciones anidadas con SAVEPOINT; la exterior usa BEGIN IMMEDIATE
    // para tomar el candado de escritura antes de leer disponibilidad.
    tx(fn) {
      const sp = `sp${depth}`;
      if (depth === 0) db.exec('BEGIN IMMEDIATE'); else db.exec(`SAVEPOINT ${sp}`);
      depth++;
      try {
        const r = fn();
        depth--;
        if (depth === 0) db.exec('COMMIT'); else db.exec(`RELEASE ${sp}`);
        return r;
      } catch (e) {
        depth--;
        if (depth === 0) db.exec('ROLLBACK'); else db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    },
  };
}
