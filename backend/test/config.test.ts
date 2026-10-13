/**
 * Contrato de la lectura de configuración (hallazgo M-8).
 *
 * El caso que motiva todo esto es `OCR_MIN_TEXT_CHARS=8O` —con la letra O—:
 * hoy caía al defecto sin decir nada, y el síntoma aparecía horas después como
 * "el OCR se comporta raro". Ahora sigue cayendo al defecto, pero avisando.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boolFromEnv, floatFromEnv, intFromEnv, intListFromEnv, resetConfigWarnings } from '../src/services/config.js';

const NAME = 'TEST_CONFIG_VALUE';

function withEnv(value: string | undefined, run: () => void) {
  const previous = process.env[NAME];
  resetConfigWarnings();
  if (value === undefined) delete process.env[NAME];
  else process.env[NAME] = value;
  try { run(); } finally {
    if (previous === undefined) delete process.env[NAME];
    else process.env[NAME] = previous;
  }
}

/** Captura lo que se avisa por consola, para comprobar que NO se calla. */
function capturingWarnings(run: () => void): string[] {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => { messages.push(args.join(' ')); };
  try { run(); } finally { console.warn = original; }
  return messages;
}

test('intFromEnv: ausente o vacío usa el defecto, sin avisar', () => {
  for (const value of [undefined, '', '   ']) {
    withEnv(value, () => {
      const warnings = capturingWarnings(() => {
        assert.equal(intFromEnv(NAME, 42, 1, 100), 42);
      });
      assert.deepEqual(warnings, [], 'no configurar algo opcional no es un error');
    });
  }
});

test('intFromEnv: valor válido se respeta', () => {
  withEnv('7', () => assert.equal(intFromEnv(NAME, 42, 1, 100), 7));
});

test('intFromEnv: un valor no numérico cae al defecto Y avisa', () => {
  // El caso real del hallazgo: "8O" con la letra O en vez del cero.
  withEnv('8O', () => {
    const warnings = capturingWarnings(() => {
      assert.equal(intFromEnv(NAME, 80, 1, 1000), 80);
    });
    assert.equal(warnings.length, 1, 'esto es exactamente lo que antes se tragaba en silencio');
    assert.match(warnings[0], /TEST_CONFIG_VALUE="8O"/);
    assert.match(warnings[0], /no es un número/);
    assert.match(warnings[0], /se aplica 80/);
  });
});

test('intFromEnv: fuera de rango se recorta al extremo y avisa', () => {
  withEnv('9999', () => {
    const warnings = capturingWarnings(() => {
      assert.equal(intFromEnv(NAME, 4, 1, 32), 32, 'se recorta, no se descarta');
    });
    assert.match(warnings[0], /fuera del rango \[1, 32\]/);
  });
  withEnv('0', () => {
    capturingWarnings(() => assert.equal(intFromEnv(NAME, 4, 1, 32), 1));
  });
});

test('intFromEnv: no repite el mismo aviso una y otra vez', () => {
  withEnv('basura', () => {
    const warnings = capturingWarnings(() => {
      for (let i = 0; i < 5; i++) intFromEnv(NAME, 1, 0, 10);
    });
    assert.equal(warnings.length, 1, 'una consulta por segundo no debe llenar el log');
  });
});

test('floatFromEnv: respeta decimales y recorta fuera de rango', () => {
  withEnv('0.42', () => assert.equal(floatFromEnv(NAME, 0.6, 0, 1), 0.42));
  withEnv('5', () => {
    capturingWarnings(() => assert.equal(floatFromEnv(NAME, 0.6, 0, 1), 1));
  });
  withEnv('-3', () => {
    capturingWarnings(() => assert.equal(floatFromEnv(NAME, 0.6, 0, 1), 0));
  });
});

test('floatFromEnv: valores negativos legítimos se admiten si el rango los permite', () => {
  // MIN_RERANK_SCORE vive en logits, que son negativos casi siempre.
  withEnv('-8.5', () => assert.equal(floatFromEnv(NAME, 0, -20, 20), -8.5));
});

test('boolFromEnv: solo true/false, el resto avisa', () => {
  withEnv('true', () => assert.equal(boolFromEnv(NAME, false), true));
  withEnv('FALSE', () => assert.equal(boolFromEnv(NAME, true), false));
  withEnv('si', () => {
    const warnings = capturingWarnings(() => {
      assert.equal(boolFromEnv(NAME, true), true, 'cae al defecto');
    });
    assert.match(warnings[0], /no es "true" ni "false"/);
  });
});

test('intListFromEnv: ordena, elimina duplicados y rechaza listas inválidas', () => {
  withEnv('90, 10,25,25', () => {
    assert.deepEqual(intListFromEnv(NAME, [10, 100], 1, 100), [10, 25, 90]);
  });
  withEnv('10,fuera,90', () => {
    const warnings = capturingWarnings(() => {
      assert.deepEqual(intListFromEnv(NAME, [10, 100], 1, 100), [10, 100]);
    });
    assert.equal(warnings.length, 1);
  });
});

