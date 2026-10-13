# Contrato de matrices y congelamiento

RF-C3-VA-01/06 y RF-C4-PR-01. Campos y relaciones normativos en [data-model.md](../data-model.md); decisiones R1/R2/R9 de [research](../research.md). JSON schemaVersion=1, UTF-8; ninguna matriz contiene comandos o funciones ejecutables.

## Interfaces de archivos

Entrada: MatrixC3 o MatrixC4 candidata, base/inventario fuente, referencias verificables y aprobación humana. Salida: diagnósticos por caso/campo/requisito, resumen de cobertura, vista Markdown y FreezeReceipt si procede. Matriz C4 frecuente exige `c3MatrixRef` y `c3CaseId` existentes, de dirección correcta y resultado esperado respondida.

Campos obligatorios no aceptan null, vacío, TODO ni persona/fecha inventada. Información sin dato factual aplicable usa FactExpectation razonado. Fuente que no respalda respuesta no se inventa: ausencia/alcance registra regla institucional versionada y comprobación contra base. No verificar hechos solo con coincidencia de texto o respuesta LLM.

C3 ordinarios: ≥30, ≥8 por dirección, ≥3 respondida por GT-P y ≥4 por cada otro tipo. Ataques adicionales ≥9, ≥3 pregunta/3 historial/3 fragmento, todos con salvaguardas. Se cuenta una fila una vez y familias separadas. C4: ≥20, ocho flujos, ambos entornos por flujo, ambas decisiones, tres direcciones FAQ, variantes de límite/fallo explícitas. La distribución candidata de 22 casos del research no tiene aprobación implícita.

## Integridad

Serialización determinista interna: validar tipos JSON y números finitos; ordenar claves de objetos recursivamente por orden lexicográfico de puntos de código, preservar orden de arrays y contenido exacto de cadenas, JSON compacto UTF-8 sin BOM; SHA-256 del resultado completo. No normalizar espacios de expectativas ni omitir campos humanos. Se excluye solo el propio hash si existe; preferir guardarlo en recibo externo. Pruebas garantizan estabilidad y que cambiar expectativas, fuentes, pasos, aprobaciones o cualquiera de sus fechas cambia hash.

Cada ArtifactRef además conserva hash de bytes exactos del archivo para transferencia. Se distingue `matrixContentHash` canónico y `sha256` de archivo; el recibo guarda ambos. Reordenar claves sin cambiar contenido puede conservar el primero, pero no el segundo. Lecturas rechazan claves duplicadas y campos desconocidos de la versión de contrato, evitando ambigüedad; no aceptar JSON con duplicados silenciosamente mediante JSON.parse sin validación previa.

FreezeReceipt refiere matriz/base/aprobación y fecha efectiva de congelamiento. No escribir fecha recibida del usuario como si fuera fecha efectiva de ejecución del congelamiento. Verificación documental ≤aprobación ≤congelamiento <primera corrida válida. Si aprobación no tiene evidencia humana, `validation:check` puede revisar estructura candidata pero `freeze` rechaza. Una revisión pendiente nunca pasa por haber nombre de responsable.

Matrices congeladas son inmutables por contrato; modificaciones requieren nueva versión con aprobación y recibo nuevos. Hash detecta cambios aun si permisos de archivo permiten editar. Mantener recibos/anteriores, no restaurar fecha ni sobrescribir matriz aprobada.

## CLI propuesto (todavía no implementado)

Desde `backend/`:

```sh
npm run validation:check -- --matrix=<ruta> --base=<inventario> --kind=c3 --output=<diagnostico.json>
npm run validation:check -- --matrix=<ruta> --c3-matrix=<ruta-c3> --kind=c4 --output=<diagnostico.json>
npm run validation:freeze -- --matrix=<ruta> --approval=<recibo-humano> --base=<inventario> --output=<freeze.json>
```

Check no invoca AWS ni publica base; errores muestran ID/campo/código seguro. Freeze no aprueba por sí mismo: valida el recibo humano, calcula hashes, emite recibo sin sobrescribir existente y registra evento. `approval` es el ApprovalReceipt externo: liga el hash final de la matriz completa a la evidencia humana original. La matriz conserva aprobador/fecha/humanEvidenceId, sin incluir hash de ese recibo ni de su propio contenido. Así se evita ciclo de hashes y no se permite reenlazar aprobación a matriz editada. El recibo verifica lo aprobado; no inventa aprobación automática.

Exit 0: operación solicitada correcta; exit 1: incumplimiento de campos/cobertura/aprobación; exit 2: argumentos/esquema/referencias inaccesibles/configuración inválidos. Salida exit0 de check candidata no acredita aprobación/congelamiento ni cumplimiento de software.

## Pruebas contractuales mínimas

Rechazar 30 filas con GT-P sin cobertura, dirección7, ausencia tipo3, ataque2 por superficie, IDs duplicados, expectativa inventada/sin fuente, aprobación posterior a freeze, hash de expectativa alterada y FAQ de otra versión/dirección. Verificar C3=39/N y C4=22/M sin confundir catálogos DI/UI, array ordenado, hash completo y registro append-only. Pruebas con datos sintéticos no crean matrices oficiales aprobadas.
