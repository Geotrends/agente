/**
 * SPEC008 FR-016: ningún servicio de runtime recibe contraseñas de base ni llaves de proveedores
 * que no usa. Se lee docker-compose.yml como texto (sin Docker) y se comprueba, por servicio, los
 * mapas que vacían esas variables.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const compose = fs.readFileSync(path.resolve(import.meta.dirname, "../../../docker-compose.yml"), "utf8");

function servicio(nombre: string): string {
  const inicio = compose.indexOf(`\n  ${nombre}:\n`);
  assert.ok(inicio >= 0, `servicio ${nombre}`);
  const resto = compose.slice(inicio + 1);
  const fin = resto.slice(nombre.length + 4).search(/\n  [a-z-]+:\n/);
  return fin < 0 ? resto : resto.slice(0, fin + nombre.length + 4);
}

test("los mapas de vaciado existen y cubren contraseñas y proveedores", () => {
  const m = compose.match(/x-sin-contrasenas-de-base: &sin-contrasenas-de-base\n((?:  .+\n)+)/);
  assert.ok(m);
  for (const v of ["POSTGRES_PASSWORD", "KB_DB_PASSWORD", "APP_DB_PASSWORD", "CHAT_DB_PASSWORD", "ADMIN_DB_PASSWORD", "MAINT_DB_PASSWORD"]) {
    assert.match(m![1], new RegExp(`${v}: ""`));
  }
  const p = compose.match(/x-sin-proveedores: &sin-proveedores\n((?:  .+\n)+)/);
  assert.ok(p);
  for (const v of ["GEMINI_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "OLLAMA_BASE_URL"]) {
    assert.match(p![1], new RegExp(`${v}: ""`));
  }
});

test("todo servicio con env_file aplica ambos mapas", () => {
  for (const s of ["backend", "chat-migrate", "chat-purge", "kb-worker"]) {
    const bloque = servicio(s);
    assert.match(bloque, /env_file: \.env/, `${s} usa env_file`);
    assert.match(bloque, /<<: \[[^\]]*\*sin-contrasenas-de-base[^\]]*\*sin-proveedores[^\]]*\]/, `${s} vacía lo ajeno`);
  }
});

test("solo el migrador recibe las contraseñas de los roles que crea", () => {
  const migrador = servicio("chat-migrate");
  for (const v of ["CHAT_DB_PASSWORD", "ADMIN_DB_PASSWORD", "MAINT_DB_PASSWORD"]) assert.match(migrador, new RegExp(`${v}: \\$\\{${v}\\}`));
  for (const s of ["backend", "chat-purge", "kb-worker"]) {
    for (const v of ["CHAT_DB_PASSWORD: ${", "ADMIN_DB_PASSWORD: ${", "MAINT_DB_PASSWORD: ${", "POSTGRES_PASSWORD: ${"]) {
      assert.ok(!servicio(s).includes(v), `${s} no reasigna ${v}`);
    }
  }
});
