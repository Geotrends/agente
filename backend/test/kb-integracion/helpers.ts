/**
 * Infraestructura de las pruebas de integración de la base de conocimiento.
 *
 * Cada archivo de prueba crea su propia base de datos (con los mismos roles y
 * el mismo esquema que crea `backend/db/init/01-roles.sh` en producción) y su
 * propio prefijo de colecciones en Qdrant, y los borra al terminar: las pruebas
 * nunca comparten estado entre sí ni tocan datos reales.
 *
 * Local:  docker run -d --name geobot-test-pg -e POSTGRES_USER=geobot_admin \
 *           -e POSTGRES_PASSWORD=dev-admin -e POSTGRES_DB=geobot_test -p 127.0.0.1:55432:5432 postgres:16
 *         docker run -d --name geobot-test-qdrant -p 127.0.0.1:56333:6333 qdrant/qdrant:v1.19.2-unprivileged
 * CI:     KB_TEST_ADMIN_URL y QDRANT_URL los fija .github/workflows/ci.yml.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { aplicarMigraciones, crearPool, type Pool } from "../../src/kb/db.js";

export const ADMIN_URL = process.env.KB_TEST_ADMIN_URL || "postgres://geobot_admin:dev-admin@localhost:55432/geobot_test";
export const QDRANT_URL_PRUEBAS = process.env.QDRANT_URL || "http://localhost:56333";

const PASS_KB = "kb-writer-pruebas";
const PASS_APP = "app-reader-pruebas";

export type BaseDePrueba = {
  nombre: string;
  kbUrl: string;
  appUrl: string;
  kb: Pool;
  borrar: () => Promise<void>;
};

function conBase(url: string, base: string, usuario?: string, clave?: string): string {
  const u = new URL(url);
  u.pathname = `/${base}`;
  if (usuario) { u.username = usuario; u.password = clave ?? ""; }
  return u.toString();
}

/** Crea una base vacía con los roles de producción y aplica todas las migraciones. */
export async function crearBaseDePrueba(): Promise<BaseDePrueba> {
  const nombre = `kb_prueba_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    // Los roles son de todo el clúster: se crean una vez y se reutilizan.
    for (const [rol, clave] of [["kb_writer", PASS_KB], ["app_reader", PASS_APP]] as const) {
      const { rowCount } = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [rol]);
      if (!rowCount) await admin.query(`CREATE ROLE ${rol} LOGIN PASSWORD '${clave}'`);
    }
    await admin.query(`CREATE DATABASE ${nombre}`);
  } finally {
    await admin.end();
  }

  const enBase = new pg.Client({ connectionString: conBase(ADMIN_URL, nombre) });
  await enBase.connect();
  try {
    await enBase.query("CREATE SCHEMA kb AUTHORIZATION kb_writer");
    await enBase.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await enBase.query("GRANT USAGE ON SCHEMA kb TO app_reader");
  } finally {
    await enBase.end();
  }

  const kbUrl = conBase(ADMIN_URL, nombre, "kb_writer", PASS_KB);
  const appUrl = conBase(ADMIN_URL, nombre, "app_reader", PASS_APP);
  const kb = crearPool(kbUrl);
  await aplicarMigraciones(kb);

  return {
    nombre, kbUrl, appUrl, kb,
    borrar: async () => {
      await kb.end();
      const limpieza = new pg.Client({ connectionString: ADMIN_URL });
      await limpieza.connect();
      try {
        await limpieza.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
      } finally {
        await limpieza.end();
      }
    },
  };
}
