# Validación del plan — SPEC007

Fecha: 2026-10-10. Resultado: **diseño completo para generar tareas**. Esta revisión no acredita implementación, recepción funcional ni rendimiento de producción.

## Alcance y fuentes

- Feature activa: `specs/007-administracion-c3-c4`, confirmada en `.specify/feature.json`.
- Rama Git real: `develop`. El valor `BRANCH` de setup identifica la feature `007-administracion-c3-c4`; no se creó ni cambió rama durante planificación.
- Fuente: Bloque 7 de `DOCUMENACION_C3_C4.pdf`, páginas impresas 62–85; extracción conservada en `requisitos-pdf.txt` y trazabilidad previa en `validacion-spec.md`.
- Contexto: constitución, spec/continuidad007, especificaciones, planes y tareas001–006 y servicios existentes de KB, autenticación, contactos, operación, chat, valoración, retención y frontend.
- Investigación: tres agentes de solo lectura revisaron acceso/operación, documentación/scraper y datos/interacciones/UI; resultados consolidados en `../research.md` con referencias técnicas primarias.

## Comprobaciones del diseño

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Artefactos requeridos | PASS | `plan.md`, `research.md`, `data-model.md`, `quickstart.md` y seis contratos presentes, no vacíos. |
| Cobertura completa | PASS | `../contracts/acceptance.md`: 62 filas únicas, 53 RF y 9 RNF; conjunto exacto RF-C3-AD-01..48, RF-C4-AD-01..05 y RNF-C3-AD-01..09. |
| Responsabilidad y verificación | PASS | Cada fila tiene dueño, prueba/evidencia propuesta y verificación fuente; ninguna celda vacía. Rutas de pruebas futuras están identificadas como diseño. |
| Plantilla de plan | PASS | Summary, Technical Context, Constitution Check, Project Structure y Complexity Tracking completos. |
| Gates de constitución | PASS de diseño | Principios I–X evaluados antes y después del diseño; sin excepciones ni gate injustificado. No significa que el código actual satisfaga esos gates. |
| Aclaraciones técnicas | PASS | Ningún marcador NEEDS CLARIFICATION en los diez artefactos de diseño. Accesos y revisiones de producción son precondiciones de ejecución explícitas. |
| Enlaces locales | PASS | Destinos de los enlaces Markdown locales de los diez artefactos existentes al revisar. |
| Continuidad | PASS de diseño | Servicios dueños y contratos anteriores reutilizados; pendientes001–006 no se dan por aceptados ni se marcan tareas previas. |
| Límite del comando | PASS | No se creó `tasks.md`, no se implementó producto, no se instalaron dependencias ni se desplegó. |

Se corrigió en `../spec.md` la expresión de entidad «nombre/correo únicos» por «nombre y correo único»: RF-C3-AD-05 exige unicidad de correo; no añade unicidad de nombre. No cambia requisitos ni criterios originales.

## Coherencia revisada

El modelo y los contratos fijan la misma autoridad de publicación (manifest SQL), generaciones candidatas no recuperables, conservación de versión anterior durante preparación y reconciliación segura tras commit. La limpieza física confirmada forma parte del éxito; errores posteriores nunca eliminan la colección activa. La metadata vigente se consulta antes de seleccionar/citar documentos, y retiro/vencimiento excluyen contenido aun si el worker se retrasa.

Recuperación mantiene exactamente dos parámetros y permisos exclusivos del rol operativo. El wrapper registra rechazos en transacción separada después del rollback; no promete auditoría persistente dentro de una transacción abortada. Se preservan dos perfiles de aplicación, último administrador, revocación y bloqueo concurrente. Polling del panel se detiene sin actividad humana y no mantiene indefinidamente la sesión.

Casos referencian interacciones autorizadas sin copiar texto y mantienen estados distintos de los hallazgos006. Exportaciones y consultas aplican retención incluso si la purga se retrasa; los tableros contienen solo agregados. Nuevas tarifas conservan costos históricos y valores desconocidos permanecen desconocidos, nunca cero.

## Hooks y límites de evidencia

`.specify/extensions.yml` se pudo parsear como YAML y contiene `hooks: {}`. No hay hooks `before_plan` ni `after_plan` registrados; no hay ejecución adicional obligatoria.

La comprobación automatizada de estructura, filas, IDs, celdas y enlaces terminó correctamente. No se ejecutaron pruebas de producto para certificar un diseño documental. Las dependencias Busboy/ExcelJS propuestas requieren instalación, lockfiles, auditoría y pruebas durante implementación; su seguridad no se acredita mediante lectura de manifests. Producción C6, los 320 muestreos mínimos, recuperación real, accesibilidad manual y revisión institucional permanecen como verificaciones de ejecución previstas en `../quickstart.md` y los contratos.
