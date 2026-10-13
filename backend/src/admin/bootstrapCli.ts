/**
 * Crea la cuenta de administrador técnico inicial. SOLO en una instalación sin cuentas: nunca
 * reemplaza ni repone usuarios existentes (para eso está la recuperación reservada, `admin:recover`).
 *
 *   docker compose run --rm -T backend node dist/admin/bootstrapCli.js correo@dominio "Nombre" < archivo-con-la-contraseña
 *   (desarrollo: ADMIN_DATABASE_URL=… node --import tsx scripts/bootstrap-admin.ts correo@dominio "Nombre")
 *
 * La contraseña temporal se lee por stdin o TTY (oculta), jamás de argumentos ni de
 * variables de entorno, y no se imprime. La cuenta queda obligada a cambiarla al entrar.
 */
import readline from "node:readline";
import { adminTx, closeAdminPool } from "./db.js";
import { hashPassword, checkNewPassword } from "./passwords.js";

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

const [email, nombre] = process.argv.slice(2);
if (!email || !nombre) { console.error('Uso: bootstrap-admin.ts <correo> "<nombre>" (contraseña por stdin)'); process.exit(1); }
const password = await readSecret("Contraseña temporal (mínimo 12 caracteres): ");
const check = checkNewPassword(password);
if (!check.ok) { console.error(check.mensaje); process.exit(1); }
try {
  const phc = await hashPassword(password);
  const created = await adminTx(async c => {
    // Candado: dos arranques simultáneos no pueden crear dos «primeras» cuentas.
    await c.query("SELECT pg_advisory_xact_lock(hashtext('admin.bootstrap'))");
    const r = await c.query(
      `INSERT INTO admin.account (email, display_name, profile, password_phc, must_change_password)
       SELECT lower(btrim($1)), $2, 'administrador técnico', $3, true
        WHERE NOT EXISTS (SELECT 1 FROM admin.account)
       RETURNING id`, [email, nombre, phc]);
    return (r.rowCount ?? 0) > 0;
  });
  if (!created) {
    console.error("La instalación ya tiene cuentas: el arranque inicial no las modifica. Use la recuperación reservada.");
    process.exitCode = 1;
  } else {
    console.log(`Administrador técnico listo: ${email.trim().toLowerCase()} (debe cambiar la contraseña al entrar).`);
  }
} catch (error) {
  console.error("No se pudo crear la cuenta:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeAdminPool();
}
