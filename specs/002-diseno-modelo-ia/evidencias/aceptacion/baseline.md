# Línea base de aceptación — Bloque 2 (T001)

**Fecha**: 2026-10-08. **Rama**: `develop`. **Revisión Git (HEAD)**: `3f56d8e91a78e8cf9f39c86472940f58eb5f09e8`.
**Cambios locales al iniciar la implementación**: 121 entradas en `git status` (modificadas, eliminadas con staging y sin seguimiento). Se preservan; ninguna tarea las revierte ni las sobrescribe sin leerlas antes. Detalle reproducible con `git status --short`.

## Resultados previos (evidencia parcial)

- `evidencias/pruebas-existentes.txt` conserva los **70 resultados** que se tomaron para el diagnóstico. Son evidencia parcial de piezas reutilizables, **no** cobertura nueva ni aceptación de ningún RF/RNF.
- Estado medido al arrancar la implementación (`npm test` en `backend/`): 281 pruebas, 281 correctas, 0 fallos. El aumento frente a las 70 anteriores refleja trabajo local posterior al diagnóstico; no cambia la clasificación de abajo.
- Clasificación de `diagnostico.md`: **0 completos, 21 parciales, 7 no implementados**.

## Brechas y tareas que las cierran

| Requisito | Estado inicial | Tipo de fallo REAL |
|---|---|---|
| RF-C3-DI-01 | Parcial | Modelo |
| RF-C3-DI-02 | Parcial | Modelo |
| RF-C3-DI-03 | Parcial | Modelo |
| RF-C3-DI-04 | Parcial | Modelo |
| RF-C3-DI-05 | Parcial | Recuperación |
| RF-C3-DI-06 | Parcial | Recuperación |
| RF-C3-DI-07 | Parcial | Modelo |
| RF-C3-DI-08 | Parcial | Modelo |
| RF-C3-DI-09 | Parcial | Modelo |
| RF-C3-DI-10 | Parcial | Modelo |
| RF-C3-DI-11 | No implementado | Datos |
| RF-C3-DI-12 | Parcial | Recuperación |
| RF-C3-DI-13 | Parcial | Recuperación |
| RF-C3-DI-14 | Parcial | Recuperación |
| RF-C3-DI-15 | Parcial | Recuperación |
| RF-C3-DI-16 | Parcial | Modelo |
| RF-C3-DI-17 | Parcial | Modelo |
| RF-C3-DI-18 | No implementado | Modelo |
| RF-C3-DI-19 | No implementado | Modelo |
| RF-C3-DI-20 | Parcial | Modelo |
| RF-C3-DI-21 | No implementado | Recuperación |
| RF-C3-DI-22 | Parcial | Modelo |
| RF-C3-DI-23 | No implementado | Modelo |
| RF-C3-DI-24 | No implementado | Modelo |
| RF-C3-DI-25 | Parcial | Modelo |
| RNF-C3-DI-01 | Parcial | Modelo |
| RNF-C3-DI-02 | No implementado | Modelo |
| RNF-C3-DI-03 | Parcial | Modelo |

Las tareas T006–T100 de `tasks.md` cubren cada brecha; el mapeo requisito→tarea está en la columna `Reqs:` de cada tarea. Estados se actualizan solo con evidencia (T099).
