/**
 * Contrato de la reescritura de consultas de seguimiento (hallazgo M-2).
 *
 * Lo que se fija aquí es la decisión —¿esta pregunta se sostiene sola?— y el
 * recorte del contexto. Cómo usa cada motor ese contexto se prueba en
 * bm25-contract (pesos) y se documenta en `hybridSearch`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsPreviousContext, tailAtWordBoundary } from '../src/services/contextBudget.js';
import { weighQueryTerms } from '../src/services/retrievalMath.js';

test('needsPreviousContext: preguntas que NO se sostienen solas', () => {
  for (const message of [
    '¿Y el plazo?',
    'y cuánto cuesta',
    '¿Qué dice ese artículo sobre las sanciones?',
    'Según lo anterior, ¿cuál es el procedimiento?',
    '¿Dónde se menciona eso?',
    'Explícame dicha resolución',
    '¿Y esta cláusula qué implica?',
  ]) {
    assert.equal(needsPreviousContext(message), true, `debería necesitar contexto: ${message}`);
  }
});

test('needsPreviousContext: preguntas autocontenidas NO se tocan', () => {
  // Es la mayoría del tráfico real, y es justo lo que el umbral de 160
  // caracteres enriquecía sin motivo: todas estas son cortas y se bastan solas.
  for (const message of [
    '¿Cuál es el horario de atención?',
    '¿Qué dice el Acuerdo 034 de 2019?',
    '¿Cuánto cuesta el impuesto predial?',
    'Requisitos para licencia de construcción',
    '¿Dónde está el documento del presupuesto?',   // "está" no es "esta"
    '¿Esta es la sede principal?',                  // demostrativo + verbo
  ]) {
    assert.equal(needsPreviousContext(message), false, `NO debería necesitar contexto: ${message}`);
  }
});

test('needsPreviousContext: la longitud deja de decidir', () => {
  // Larga pero de seguimiento: el umbral viejo (<160) la habría dejado pasar
  // sin contexto justo cuando más falta le hacía.
  const larga = '¿Y podrías explicarme con detalle cuál es exactamente el plazo máximo que aplica en ese caso, contando desde la radicación y hasta la notificación final al interesado?';
  assert.ok(larga.length > 160);
  assert.equal(needsPreviousContext(larga), true);

  // Corta y autocontenida: el umbral viejo la habría contaminado con el tema
  // anterior sin ninguna necesidad.
  const corta = '¿Qué es el POT?';
  assert.ok(corta.length < 160);
  assert.equal(needsPreviousContext(corta), false);
});

test('tailAtWordBoundary: no parte palabras por la mitad', () => {
  const texto = 'el concejo municipal aprobo el presupuesto anual del municipio de envigado';
  const recortado = tailAtWordBoundary(texto, 30);
  assert.ok(recortado.length <= 30);
  assert.ok(texto.endsWith(recortado), 'sigue siendo el final del original');
  // La primera palabra del recorte está entera: existe en el texto original
  // precedida de un espacio.
  assert.ok(texto.includes(` ${recortado.split(' ')[0]} `) || texto.endsWith(recortado.split(' ')[0]));
});

test('tailAtWordBoundary: textos cortos pasan intactos y una palabra larguísima no se pierde', () => {
  assert.equal(tailAtWordBoundary('corto', 500), 'corto');
  const unaPalabra = 'a'.repeat(50);
  assert.equal(tailAtWordBoundary(unaPalabra, 10), 'a'.repeat(10));
});

test('weighQueryTerms: la pregunta anterior pesa menos que la actual', () => {
  const weights = weighQueryTerms([
    { text: 'plazo notificacion', weight: 1 },
    { text: 'licencia construccion plazo', weight: 0.3 },
  ]);
  assert.equal(weights.get('plazo'), 1, 'un término repetido en ambas se queda con el peso mayor');
  assert.equal(weights.get('notificacion'), 1);
  assert.equal(weights.get('licencia'), 0.3);
  assert.equal(weights.get('construccion'), 0.3);
});

test('weighQueryTerms: un string suelto equivale a un solo tramo de peso 1', () => {
  const asString = weighQueryTerms('ruido ambiental acustica');
  const asSegment = weighQueryTerms([{ text: 'ruido ambiental acustica', weight: 1 }]);
  assert.deepEqual([...asString].sort(), [...asSegment].sort());
  for (const weight of asString.values()) assert.equal(weight, 1);
});

test('weighQueryTerms: un tramo con peso 0 no aporta términos', () => {
  const weights = weighQueryTerms([
    { text: 'actual', weight: 1 },
    { text: 'ignorado completamente', weight: 0 },
  ]);
  assert.equal(weights.has('ignorado'), false);
  assert.equal(weights.get('actual'), 1);
});
