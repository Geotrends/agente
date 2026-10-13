# Fundamento local SPEC006

Fecha de registro: 2026-10-11, America/Bogota. Implementación offline, sin AWS, sin corpus ciudadano ni aprobación humana.

T005–T010: JSON recursivo con rechazo de claves duplicadas/escapadas/unsafe, versiones/campos/fechas/IDs/SHA estrictos; hash canónico por puntos de código, arrays/textos exactos; refs por bytes, symlinks/traversal/secretos rechazados; escritura temporal sincronizada y publicación atómica no destructiva; ledger por eventos inmutables e índice regenerable; manifiesto de árbol con fuentes untracked permitidas y exclusión de outputs; esquema completo de release/ajustes y dispatcher offline.

Verificación efectiva: `npm --prefix backend run test:validation` → 7 pruebas, 7 pass, 0 fail, 0 skip. `npm --prefix backend run typecheck` → exit0. Negativos antes del código produjeron ERR_MODULE_NOT_FOUND, como esperado en fase roja. No hay nueva dependencia ni cambio de lockfiles. Node local v26.11.0 (el objetivo Docker/CI sigue Node22); la verificación local no acredita Node22 ni imágenes.

Comandos disponibles desde backend: `node --import tsx scripts/validation.ts identity-tree --source-root=<repo> --root=<evidencia-existente> --output=<nuevo-path-relativo.json>` y `adjustment --root=<evidencia> --event=<archivo>`. Rechazan argumentos/subcomandos desconocidos, no invocan comandos de JSON.

El manifiesto valida integridad estructural/referencias. Digests, contactos/política y configuración deben cotejarse con el entorno real antes de aceptación; no se emitió una release oficial. Conservados baseline y pendientes de specs previos.
