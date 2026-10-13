/**
 * Arnés de las pruebas de integración de SPEC004 (interfaz, valoración, contactos).
 *
 * Reutiliza el del bloque 2 (PostgreSQL real aislado con roles/esquema de producción, reloj y
 * proveedor doble sin red). Cada resultado se etiqueta `controlled`: la base es real, el proveedor
 * y el portal no, por lo que NO acredita aceptación integrada (T081). No usa volúmenes del usuario.
 */
import { createHarness, FakeClock, FakeConverse, type DiHarness } from "../di-integracion/harness.js";

export { FakeClock, FakeConverse };
export type UiHarness = DiHarness & { adapter: "controlled" };

export async function createUiHarness(): Promise<UiHarness> {
  const base = await createHarness();
  return Object.assign(base, { adapter: "controlled" as const });
}
