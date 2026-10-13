# Recepción de administración C3–C4 (SPEC007) — cotejo

Fecha: 2026-10-11. **No es acta ni aceptación.** Todo resultado es *controlado* (PostgreSQL/Qdrant aislados,
datos sintéticos, proveedor doble). Se registran aquí los 62 requisitos y lo que falta con acceso real.

## Pasos reales pendientes (no marcados)
- T091: repetir matrices congeladas de SPEC006 (C3 con ambos modelos y C4) y registrar AdjustmentEvent — requiere AWS y la herramienta de SPEC006 completa.
- T092: cuentas Geotrends/Municipio y recuperación sobre tres cuentas en producción.
- T093: RNF-C3-AD-08 en C6, 20 cargas × 8 pantallas × 2 fechas de Bogotá (la medición local de `evidencias/performance/` NO la acredita).
- T094: revisión manual 100 % con teclado y lector de pantalla, zoom 200 % y contraste.
- T095: entrega H6-C3/H5-C4 solo con lo anterior resuelto y sin actas inventadas.
- SPEC006 aún no publica `VALIDATION_EVIDENCE_INDEX`: «Validada/Cerrada» de casos de mejora se rechaza sin índice (comportamiento seguro).

## Cotejo
| Requisito | Pruebas | Evidencia | Estado |
| --- | --- | --- | --- |
| RF-C3-AD-01 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-02 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-03 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-04 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-05 | accounts*.test.ts / recovery.test.ts | evidencias/accounts/ | Verificado en entorno controlado |
| RF-C3-AD-06 | accounts*.test.ts / recovery.test.ts | evidencias/accounts/ | Verificado en entorno controlado |
| RF-C3-AD-07 | accounts*.test.ts / recovery.test.ts | evidencias/accounts/ | Verificado en entorno controlado |
| RF-C3-AD-08 | accounts*.test.ts / recovery.test.ts | evidencias/accounts/ | Verificado en entorno controlado |
| RF-C3-AD-09 | accounts*.test.ts / recovery.test.ts | evidencias/accounts/ | Verificado en entorno controlado |
| RF-C3-AD-10 | accounts*.test.ts / recovery.test.ts | evidencias/accounts/ | Verificado en entorno controlado |
| RF-C3-AD-11 | accounts*.test.ts / recovery.test.ts | evidencias/accounts/ | Verificado en entorno controlado |
| RF-C3-AD-12 | accounts*.test.ts / recovery.test.ts | evidencias/accounts/ | Verificado en entorno controlado; PENDIENTE real: T092 (cuenta Geotrends/Municipio reales) |
| RF-C3-AD-13 | accounts*.test.ts / recovery.test.ts | evidencias/accounts/ | Verificado en entorno controlado; PENDIENTE real: T092 (recuperación sobre 3 cuentas reales) |
| RF-C3-AD-14 | links.test.ts | evidencias/links/ | Verificado en entorno controlado |
| RF-C3-AD-15 | links.test.ts | evidencias/links/ | Verificado en entorno controlado |
| RF-C3-AD-16 | links.test.ts | evidencias/links/ | Verificado en entorno controlado |
| RF-C3-AD-17 | links.test.ts | evidencias/links/ | Verificado en entorno controlado |
| RF-C3-AD-18 | links.test.ts | evidencias/links/ | Verificado en entorno controlado |
| RF-C3-AD-19 | links.test.ts | evidencias/links/ | Verificado en entorno controlado |
| RF-C3-AD-20 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-21 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-22 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-23 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-24 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-25 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-26 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-27 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-28 | operations.test.ts | evidencias/operations/ | Verificado en entorno controlado |
| RF-C3-AD-29 | operations.test.ts | evidencias/operations/ | Verificado en entorno controlado |
| RF-C3-AD-30 | operations.test.ts | evidencias/operations/ | Verificado en entorno controlado |
| RF-C3-AD-31 | operations.test.ts | evidencias/operations/ | Verificado en entorno controlado |
| RF-C3-AD-32 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-33 | links.test.ts | evidencias/links/ | Verificado en entorno controlado |
| RF-C3-AD-34 | links.test.ts | evidencias/links/ | Verificado en entorno controlado |
| RF-C3-AD-35 | contacts.test.ts | evidencias/contacts/ | Verificado en entorno controlado |
| RF-C3-AD-36 | contacts.test.ts | evidencias/contacts/ | Verificado en entorno controlado |
| RF-C3-AD-37 | contacts.test.ts | evidencias/contacts/ | Verificado en entorno controlado |
| RF-C3-AD-38 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-39 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-40 | operations.test.ts | evidencias/operations/ | Verificado en entorno controlado |
| RF-C3-AD-41 | operations.test.ts | evidencias/operations/ | Verificado en entorno controlado |
| RF-C3-AD-42 | statistics.test.ts | evidencias/statistics/ | Verificado en entorno controlado |
| RF-C3-AD-43 | statistics.test.ts | evidencias/statistics/ | Verificado en entorno controlado |
| RF-C3-AD-44 | statistics.test.ts | evidencias/statistics/ | Verificado en entorno controlado |
| RF-C3-AD-45 | statistics.test.ts | evidencias/statistics/ | Verificado en entorno controlado |
| RF-C3-AD-46 | statistics.test.ts | evidencias/statistics/ | Verificado en entorno controlado |
| RF-C3-AD-47 | documents.test.ts / publication.test.ts | evidencias/documents/ | Verificado en entorno controlado |
| RF-C3-AD-48 | operations.test.ts | evidencias/operations/ | Verificado en entorno controlado |
| RF-C4-AD-01 | interactions.test.ts / improvements.test.ts | evidencias/interactions/ | Verificado en entorno controlado |
| RF-C4-AD-02 | interactions.test.ts / improvements.test.ts | evidencias/interactions/ | Verificado en entorno controlado |
| RF-C4-AD-03 | interactions.test.ts / improvements.test.ts | evidencias/improvements/ | Verificado en entorno controlado |
| RF-C4-AD-04 | interactions.test.ts / improvements.test.ts | evidencias/improvements/ | Verificado en entorno controlado |
| RF-C4-AD-05 | interactions.test.ts / improvements.test.ts | evidencias/improvements/ | Verificado en entorno controlado |
| RNF-C3-AD-01 | ver tasks.md (cobertura) | evidencias/security/ | Verificado en entorno controlado |
| RNF-C3-AD-02 | ver tasks.md (cobertura) | evidencias/security/ | Verificado en entorno controlado |
| RNF-C3-AD-03 | ver tasks.md (cobertura) | evidencias/security/ | Verificado en entorno controlado |
| RNF-C3-AD-04 | ver tasks.md (cobertura) | evidencias/security/ | Verificado en entorno controlado |
| RNF-C3-AD-05 | ver tasks.md (cobertura) | evidencias/security/ | Verificado en entorno controlado |
| RNF-C3-AD-06 | ver tasks.md (cobertura) | evidencias/security/ | Verificado en entorno controlado |
| RNF-C3-AD-07 | ver tasks.md (cobertura) | evidencias/statistics/ | Verificado en entorno controlado |
| RNF-C3-AD-08 | ver tasks.md (cobertura) | evidencias/performance/ | Verificado en entorno controlado; PENDIENTE real: T093 (C6, 320 muestras en dos fechas) |
| RNF-C3-AD-09 | ver tasks.md (cobertura) | evidencias/accessibility/ | Verificado en entorno controlado; PENDIENTE real: T094 (revisión manual teclado/lector) |
