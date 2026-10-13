/**
 * Nombres descriptivos de las páginas de la matriz (bug nombres-pagina-duplicados;
 * RF-C3-IV-11, RF-C3-IV-12): las URLs de la captura de la matriz y los 12 meses.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cargarConfig, validarConfig } from "../src/kb/config.js";
import { candidatosDesambiguados, nombreDescriptivo, nombreUnico } from "../src/kb/nombres.js";

const A = "https://ambientometroenvigado.com/docs";
const config = cargarConfig();

test("páginas de mes: categoría, mes y año salen de la URL", () => {
  const casos: Array<[string, string]> = [
    [`${A}/boletines-2025/meteorologia/abril/`, "Meteorología – Abril 2025"],
    [`${A}/boletines-2025/calidad-de-aire/abril/`, "Calidad del aire – Abril 2025"],
    [`${A}/boletines-2025/ruido/agosto/`, "Ruido – Agosto 2025"],
    [`${A}/boletines-2023/calidad-de-aire-2023/agosto/`, "Calidad del aire – Agosto 2023"],
    [`${A}/boletines-2024/calidad-del-aire-2024/abril/`, "Calidad del aire – Abril 2024"],
    [`${A}/boletines-2024/meteorologia-2024/agosto/`, "Meteorología – Agosto 2024"],
    [`${A}/boletines-2023/ruido-2023/abril/`, "Ruido – Abril 2023"],
    [`${A}/2022-2/ruido/agosto/`, "Ruido – Agosto 2022"],
    [`${A}/2022-2/calidad-de-aire-2022/abril/`, "Calidad del aire – Abril 2022"],
    [`${A}/2022-2/meteorologia/abril/`, "Meteorología – Abril 2022"],
  ];
  for (const [url, esperado] of casos) assert.equal(nombreDescriptivo(url, "Abril", config), esperado, url);
});

test("las 144 páginas de mes del Ambientómetro (4 boletines × 3 categorías × 12 meses) quedan con nombre único", () => {
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const boletines: Array<[string, string]> = [
    ["boletines-2023", "-2023"], ["boletines-2024", "-2024"], ["boletines-2025", ""], ["2022-2", ""],
  ];
  const nombres = new Set<string>();
  let total = 0;
  for (const [boletin, sufijo] of boletines) {
    for (const categoria of ["calidad-de-aire", "meteorologia", "ruido"]) {
      for (const mes of meses) {
        nombres.add(nombreDescriptivo(`${A}/${boletin}/${categoria}${sufijo}/${mes}/`, mes, config));
        total++;
      }
    }
  }
  assert.equal(nombres.size, total);
});

test("la página índice de una categoría no se llama como otra categoría", () => {
  assert.equal(nombreDescriptivo(`${A}/boletines-2023/ruido-2023/`, "Meteorología", config), "Ruido – Boletín 2023");
  assert.equal(nombreDescriptivo(`${A}/boletines-2025/calidad-de-aire/`, "Meteorología 2025", config), "Calidad del aire – Boletín 2025");
});

test("una URL que no es de boletín conserva su título", () => {
  assert.equal(nombreDescriptivo("https://ambientometroenvigado.com/campana-de-adopcion/", "Animales de Compañía", config), "Animales de Compañía");
  assert.equal(nombreDescriptivo(`${A}/boletines-2025/`, "Boletines", config), "Boletines");
  assert.equal(nombreDescriptivo(`${A}/boletines-2025/ruido/mayo/otro/`, "Mayo", config), "Mayo");
  assert.equal(nombreDescriptivo("https://www.envigado.gov.co/docs/boletines-2025/ruido/abril/", "Abril", config), "Abril");
  assert.equal(nombreDescriptivo("no es una url", "X", config), "X");
});

test("una categoría desconocida se humaniza en lugar de perderse", () => {
  assert.equal(nombreDescriptivo(`${A}/boletines-2025/olores/mayo/`, "Mayo", config), "Olores – Mayo 2025");
});

test("nombreUnico: si el nombre está libre no cambia", () => {
  assert.equal(nombreUnico("Contacto", "https://www.envigado.gov.co/contactenos/", () => false), "Contacto");
});

test("nombreUnico añade el último segmento de la URL cuando el nombre está ocupado", () => {
  const ocupados = new Set(["Alcaldía de Envigado"]);
  assert.equal(nombreUnico("Alcaldía de Envigado", "https://www.envigado.gov.co/contactenos/", c => ocupados.has(c)),
    "Alcaldía de Envigado – Contactenos");
});

test("nombreUnico salta el segmento que repite el nombre (par «Desarrollo Rural y Agropecuario»)", () => {
  const nombre = "Desarrollo Rural y Agropecuario";
  const ocupados = new Set([nombre]);
  const a = nombreUnico(nombre, "https://ambientometroenvigado.com/desarrollo-rural-y-agropecuario/", c => ocupados.has(c));
  assert.notEqual(a, nombre);
  assert.deepEqual(candidatosDesambiguados(nombre, "https://ambientometroenvigado.com/desarrollo-rural-y-agropecuario/"),
    [`${nombre} – ambientometroenvigado.com`]);
  const b = nombreUnico(nombre, "https://ambientometroenvigado.com/secreatria/informacion-ambiental/desarrollo-agropecuario/", c => ocupados.has(c));
  assert.equal(b, `${nombre} – Desarrollo agropecuario`);
});

test("nombreUnico garantiza unicidad en cualquier orden, incluso con URLs que no distinguen", () => {
  const filas: Array<[string, string]> = [
    ["Desarrollo Rural y Agropecuario", "https://ambientometroenvigado.com/secreatria/informacion-ambiental/desarrollo-agropecuario/"],
    ["Desarrollo Rural y Agropecuario", "https://ambientometroenvigado.com/desarrollo-rural-y-agropecuario/"],
    ["Desarrollo Rural y Agropecuario", "https://ambientometroenvigado.com/desarrollo-rural-y-agropecuario/"],
    ["Alcaldía de Envigado", "https://www.envigado.gov.co/contactenos/"],
    ["Alcaldía de Envigado", "https://www.envigado.gov.co/peticiones-quejas-reclamos/"],
  ];
  for (const orden of [filas, [...filas].reverse()]) {
    const usados = new Set<string>();
    for (const [n, u] of orden) usados.add(nombreUnico(n, u, c => usados.has(c)));
    assert.equal(usados.size, orden.length);
  }
});

test("la configuración valida la regla de boletines", () => {
  const base = JSON.parse(JSON.stringify({
    procedimientos: { "GT-P-004": "gestion_ambiental" }, hosts_permitidos: [{ host: "a.co", tipo: "host_exacto" }],
  }));
  assert.throws(() => validarConfig({ ...base, boletines: { host: "", prefijo: "docs", categorias: { x: "" } } }), /boletines/);
  assert.equal(validarConfig(base).boletines, undefined);
});
