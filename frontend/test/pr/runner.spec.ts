import { test, expect } from '@playwright/test';
import { matrixC4 } from '../../../backend/scripts/lib/validation/matrixC4';
import { c3Fixture } from '../../../backend/test/validation-support';
test('JSON no puede introducir una función ejecutable ni una matriz vacía', () => { expect(() => matrixC4({ schemaVersion: 1, kind: 'c4', cases: [], runnerCase: 'eval' }, c3Fixture())).toThrow(); });
