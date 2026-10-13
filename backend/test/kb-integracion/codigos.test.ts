/**
 * Enlaces de códigos desde la matriz (T024): el chat lee la vista de códigos
 * publicados con el rol de solo lectura, y nada pendiente o derogado se enlaza.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { linkDocumentCodes, loadDocumentCodeIndex, reiniciarIndiceCodigos } from "../../src/services/documentLinks.js";
import { crearBaseDePrueba, type BaseDePrueba } from "./helpers.js";

let base: BaseDePrueba;
before(async () => { base = await crearBaseDePrueba(); });
after(async () => { await reiniciarIndiceCodigos(); await base?.borrar(); });

test("solo se enlazan códigos publicados; un formato enlaza a su descarga", async () => {
  const fila = (clave: string, estado: string, descarga: string | null) => base.kb.query(
    `INSERT INTO kb.kb_elemento (clave, codigo, nombre, tipo, direccion, url_origen, url_descarga, estado,
       version_documento, fecha_actualizacion, formato_original, procedimientos_origen, fuente)
     VALUES ($1, $1, 'x', 'formato', 'bienestar_animal', 'https://gmas2.envigado.gov.co/gmas/v?d=' || $1, $3, $2,
       '01', '2024-01-01', 'docx', '{GT-P-021}', 'gmas2_envigado')`, [clave, estado, descarga]);
  await fila("GT-F-015", "publicado", "https://gmas2.envigado.gov.co/gmas/downloadFile.public?repositorioArchivo=15");
  await fila("GT-F-014", "pendiente_aprobacion", null);
  await fila("GT-F-066", "derogado", null);
  process.env.APP_DATABASE_URL = base.appUrl;
  await reiniciarIndiceCodigos();
  const indice = await loadDocumentCodeIndex();
  assert.equal(linkDocumentCodes("GT-F-015", indice), "[GT-F-015](https://gmas2.envigado.gov.co/gmas/downloadFile.public?repositorioArchivo=15)");
  assert.equal(linkDocumentCodes("GT-F-014 y GT-F-066", indice), "GT-F-014 y GT-F-066");
});

test("sin base de datos los códigos quedan como texto, sin fallar", async () => {
  delete process.env.APP_DATABASE_URL;
  await reiniciarIndiceCodigos();
  const indice = await loadDocumentCodeIndex();
  assert.equal(indice.size, 0);
});
