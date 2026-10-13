# Hallazgos (T098) — registro parcial

Se registra cada defecto con su causa, prioridad contractual y corrección. **T098 sigue abierto**: exige repetir T091–T097 completos tras los cambios relevantes y T092–T097 no se han ejecutado (AWS, navegador, firma).

## Corregidos durante la implementación

| # | Hallazgo (REAL) | Causa | Prioridad | Corrección | Verificación |
|---|---|---|---|---|---|
| 1 | El inicio de sesión del panel **se colgaba** con la base caída | Express 4 no captura el rechazo de un manejador `async` | RNF-AD-05 (base caída) | `safe()` traduce a 503 y las lecturas de estado usan el registro en memoria | `admin-operations.test.ts` (base caída) |
| 2 | Los cortes forzados (DI-18) **fallaban** con "nada respaldado cabe" | El tope visible reutilizaba `BEDROCK_MAX_OUTPUT_TOKENS`, que baja cuando se fuerza el corte | RF-DI-18 / RNF-DI-03 | `VISIBLE_TOKEN_LIMIT = 2200` independiente del `maxTokens` | `eval-di.test.ts`, `di-output-limit.test.ts` |
| 3 | Los artículos de una sola línea larga no daban encabezado (metadata) | Se descartaban encabezados de más de 200 caracteres | RF-DI-13 | El encabezado es el inicio de la línea | `di-chunking.test.ts` |
| 4 | Un fallo de la auditoría se disfrazaba de error de validación (422) | El mapeo de `check_violation` alcanzaba cualquier tabla | RF-AD-41 | Solo se mapean restricciones de `contact_*` | `admin-contacts.test.ts` |
| 5 | `.env.example` bloqueaba la readiness al copiarlo | Traía `OLLAMA_BASE_URL` y claves vacías de otros proveedores activas | RNF-DI-02 | Variables heredadas comentadas y aviso | revisión + `make check-env` |
| 6 | La prueba de smoke y la de proveedores ejercían el contrato retirado y llamaban a terceros | Contrato antiguo (`message`, `provider`, `/providers`) | RNF-DI-02 | Eliminadas; las reemplaza la suite DI | `integracion-final.md` |
| 7 | La captura de destinos de red no registraba nada | `net.connect` entrega argumentos normalizados `[opciones, cb]` | RNF-DI-02 | Se lee la primera posición del arreglo | `load-runner.test.ts` |
| 8 | Dos vulnerabilidades altas en `next` y `source-map-js` (frontend) | Versión anterior al parche | constitución X | `npm audit fix` (0 vulnerabilidades) | CI / `npm audit` |
| 9 | La calibración no había sido pensada para colección candidata | El alias se consultaba directo | RF-DI-05 | La búsqueda resuelve la colección y atan umbral y corpus | `retrieval-publication.test.ts` |

## Abiertos (dependen de datos o de AWS reales)

| # | Hallazgo | Tipo | Qué hace falta |
|---|---|---|---|
| A | Tablas > 1000 caracteres del corpus real bloquearán su publicación | Datos / Recuperación | Medir con `kb sincronizar --completa` en un entorno con el corpus; corregir en la fuente |
| B | La publicación incremental no recalibra | Recuperación | Decidir si toda publicación pasa por reconstrucción calibrada |
| C | Cédula sin palabra ancla no se enmascara | Modelo / Privacidad | Aceptar el límite documentado o ampliar reglas con medición |
| D | Los criterios semánticos (tono, estructuras, citas, tasas) no se han medido con un modelo real | Modelo | T092–T097 |
| E | Accesibilidad (foco visible, contraste, lector de pantalla) y recorridos en navegador real sin verificar; el panel se probó solo con jsdom | Interfaz | T096 |
