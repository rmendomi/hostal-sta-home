// Acceso al panel: contraseñas con scrypt, sesiones con token aleatorio
// guardado solo como hash, cookie HttpOnly + SameSite=Strict.

import { scryptSync, randomBytes, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { ServiceError } from '../core/service.js';

const SESSION_DAYS = 14;

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, { salt, hash }) {
  const test = Buffer.from(hashPassword(password, salt).hash, 'hex');
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && timingSafeEqual(test, real);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

export function createAuth({ store, secure }) {
  function createAdmin({ email, password, name = '' }) {
    email = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Correo inválido');
    if (String(password).length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres');
    const existing = store.list('admins', { email })[0];
    const { salt, hash } = hashPassword(password);
    if (existing) return store.update('admins', existing.id, { salt, hash, name: name || existing.name });
    return store.insert('admins', { email, name, salt, hash, createdAt: new Date().toISOString() });
  }

  function login(email, password) {
    const admin = store.list('admins', { email: String(email || '').trim().toLowerCase() })[0];
    // Se calcula el hash igual aunque no exista el usuario, para no revelar qué correos existen por tiempo de respuesta.
    const ok = admin ? verifyPassword(String(password || ''), admin) : (hashPassword('x'), false);
    if (!ok) return null;
    const token = randomBytes(32).toString('base64url');
    store.insert('sessions', { tokenHash: sha(token), adminId: admin.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() });
    return { token, admin: { id: admin.id, email: admin.email, name: admin.name } };
  }

  function fromRequest(req) {
    const m = /(?:^|;\s*)se_admin=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
    if (!m) return null;
    const s = store.list('sessions', { tokenHash: sha(m[1]) })[0];
    if (!s || s.expiresAt < new Date().toISOString()) return null;
    const admin = store.get('admins', s.adminId);
    return admin ? { session: s, admin: { id: admin.id, email: admin.email, name: admin.name } } : null;
  }

  function logout(req) {
    const who = fromRequest(req);
    if (who) store.remove('sessions', who.session.id);
  }

  function cookie(token, maxAgeDays = SESSION_DAYS) {
    return `se_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeDays * 86400}${secure ? '; Secure' : ''}`;
  }

  function checkPassword(adminId, password) {
    const admin = store.get('admins', adminId);
    return !!admin && verifyPassword(String(password || ''), admin);
  }

  function changeEmail(adminId, email) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError('valor', 'Correo inválido.');
    const other = store.list('admins', { email })[0];
    if (other && other.id !== adminId) throw new ServiceError('valor', 'Ese correo ya tiene acceso al panel.');
    const a = store.update('admins', adminId, { email });
    return { id: a.id, email: a.email, name: a.name };
  }

  return { createAdmin, login, fromRequest, logout, cookie, checkPassword, changeEmail, hasAdmins: () => store.list('admins').length > 0 };
}

export function signer(secret) {
  return (value) => createHmac('sha256', secret).update(String(value)).digest('base64url').slice(0, 22);
}
