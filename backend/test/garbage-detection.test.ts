/**
 * Contrato del detector de texto ilegible (hallazgo A-3).
 *
 * Esta función no tenía ninguna prueba, y salió caro: un falso positivo dejó
 * fuera del índice 430 documentos del corpus real — entre ellos los boletines
 * de calidad del aire, que son tablas de mediciones perfectamente legítimas y
 * se parecen al ruido si solo se miran longitudes de palabra.
 *
 * Los casos de abajo reproducen las tres familias reales que se midieron, con
 * sus estadísticas: no son ejemplos inventados, son la forma que de verdad
 * tiene cada una en `data/`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeGarbage } from '../src/services/documentPreprocessor.js';

/**
 * Capa de texto rota: el PDF extrae cada carácter duplicado y separado.
 * Forma real de concejo_envigado/documentos/acuerdos/acuerdo-032-de-2004.pdf
 * (avgLen 2,39 · tokens cortos 0,71 · de ellos numéricos 0,09).
 */
const CAPA_ROTA = 'A AC CU UE ER RD DO O 0 03 32 2 ((S Se ep pttiie em mb brre e 2 23 3 d de e 2 20 00 04 4)) '
  + '““P Po orr m me ed diio o d de ell c cu ua all s se e d de ec clla arra a L LA A U UT TIIL LIID DA AD D '
  + 'P PU UB BL LIIC CA A Y Y L LA A U UR RG GE EN NC CIIA A p pa arra a d de ec crre etta arr';

/**
 * Tabla de mediciones diarias, con "ND" para los días sin dato. Forma real de
 * ambientometro/documentos/pdf/boletines-calidad-de-aire-noviembre-2025.pdf
 * (avgLen 2,85 · tokens cortos 0,78 · de ellos numéricos 0,82).
 */
const TABLA_DE_DATOS = 'ND 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 '
  + '22 17 15 17 12 ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND ND '
  + '18 21 19 16 14 13 20 22 25 19 17 16 15 14 18 21 23 20 19 17 16 15 14 13 12 11 10 9 8 7 6';

const PROSA = 'El Concejo Municipal de Envigado, en uso de sus facultades constitucionales y legales, '
  + 'y en especial las conferidas por la Ley 136 de 1994, considera que la gestión ambiental del '
  + 'municipio requiere un plan de inversión acorde con las necesidades de la comunidad.';

test('detecta una capa de texto rota, con cada carácter duplicado', () => {
  assert.equal(looksLikeGarbage(CAPA_ROTA), true);
});

test('NO marca una tabla de mediciones como basura', () => {
  // El falso positivo que dejó 430 documentos fuera del índice. Se parece al
  // ruido en longitud de palabra, pero sus tokens cortos son números.
  assert.equal(looksLikeGarbage(TABLA_DE_DATOS), false);
});

test('NO marca prosa normal', () => {
  assert.equal(looksLikeGarbage(PROSA), false);
});

test('NO marca una tabla presupuestal, que mezcla cifras y prosa', () => {
  const presupuesto = 'ACUERDO N° 044 Plan de Inversión Vigencia Fiscal 2005 '
    + 'Sector Educación 1 250 000 Sector Salud 2 300 000 Sector Ambiental 890 000 '
    + 'Total de la inversión proyectada para la vigencia 3 440 000 pesos';
  assert.equal(looksLikeGarbage(presupuesto), false);
});

test('una muestra demasiado corta nunca se marca: no hay con qué decidir', () => {
  assert.equal(looksLikeGarbage('A AC CU UE ER RD DO O'), false);
  assert.equal(looksLikeGarbage(''), false);
  assert.equal(looksLikeGarbage('   '), false);
});

test('los separadores de página de pdf-parse no cuentan como contenido', () => {
  // "-- 1 of 22 --" es boilerplate de la librería: son tokens cortos y
  // numéricos, así que sin quitarlos sesgarían las dos señales a la vez.
  const soloSeparadores = Array.from({ length: 22 }, (_, i) => `-- ${i + 1} of 22 --`).join(' ');
  assert.equal(looksLikeGarbage(soloSeparadores), false, 'sin contenido real, no hay nada que juzgar');
});

test('ruido de OCR sobre letra manuscrita sí se marca', () => {
  // Forma aproximada de lo que produce Tesseract sobre el acuerdo de 1899 en
  // cursiva: fragmentos de letras sueltas, casi sin números.
  const manuscrito = 'e l i a n o s d e r t u m p q w x z f g h j k l ñ v b n m c d s a e i o u '
    + 'rr ll ch qu ue ae io ou ei ia ao eu ui oa ea ie oi au eo ay ey oy uy ah eh ih oh uh '
    + 'ba be bi bo bu ca ce ci co cu da de di do du fa fe fi fo fu ga ge gi go gu';
  assert.equal(looksLikeGarbage(manuscrito), true);
});
