// Tareas de administración por consola.
//   npm run admin:crear -- correo@dominio.cl   (pide la contraseña)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { openStore } from './store-sqlite.js';
import { createAuth } from './auth.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, email] = process.argv.slice(2);
const dataDir = process.env.DATA_DIR || join(ROOT, 'data');
mkdirSync(dataDir, { recursive: true });
const store = openStore(process.env.DB_FILE || join(dataDir, 'reservas.db'));

if (cmd === 'crear-admin') {
  if (!email) { console.error('Uso: npm run admin:crear -- correo@dominio.cl'); process.exit(1); }
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('Contraseña (mínimo 10 caracteres): ');
    rl.close();
  }
  createAuth({ store }).createAdmin({ email, password });
  console.log(`Usuario del panel listo: ${email}`);
} else {
  console.error('Comandos: crear-admin');
  process.exit(1);
}
store.close();
