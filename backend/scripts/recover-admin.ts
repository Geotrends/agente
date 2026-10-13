/**
 * Recuperación de contraseña de una cuenta del panel — SOLO operación reservada del contratista.
 *
 *   ADMIN_RECOVERY_DATABASE_URL=postgres://contractor_recovery:…@host/db \
 *     npm run admin:recover -- correo@dominio < archivo-con-la-contraseña-temporal
 *
 * La contraseña temporal se lee por stdin o TTY (oculta), jamás de argumentos ni variables de
 * entorno, y no se imprime. La cuenta queda con cambio obligatorio y sus sesiones revocadas.
 */
import readline from "node:readline";
import pg from "pg";
import { recoverPassword } from "../src/admin/recovery.js";

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const mute = rl as unknown as { _writeToOutput: (s: string) => void };
  process.stdout.write(prompt);
  mute._writeToOutput = () => {};
  return new Promise(resolve => rl.question("", answer => { rl.close(); process.stdout.write("\n"); resolve(answer); }));
}

const [email, ...extra] = process.argv.slice(2);
const url = process.env.ADMIN_RECOVERY_DATABASE_URL;
if (!email || extra.length) { console.error("Uso: recover-admin.ts <correo> (contraseña temporal por stdin)"); process.exit(1); }
if (!url) { console.error("Falta ADMIN_RECOVERY_DATABASE_URL (rol contractor_recovery)."); process.exit(1); }

const password = await readSecret("Contraseña temporal (mínimo 12 caracteres): ");
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const r = await recoverPassword(pool, email, password);
  if (r.ok) console.log(`Recuperación aplicada a ${email.trim().toLowerCase()}: deberá cambiar la contraseña al entrar.`);
  else { console.error(`No se aplicó la recuperación (${r.reason}).`); process.exitCode = 1; }
} catch (error) {
  console.error("Recuperación fallida:", (error as { code?: string }).code ?? "error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
