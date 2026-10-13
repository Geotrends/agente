# Diseño final — Bloque 2: Diseño del modelo IA (H2-C3)

Alcance: lo implementado y decidido en `develop` a 2026-10-08. Estado de aceptación: ver [informe-validacion.md](informe-validacion.md). Arquitectura y operación: `docs/arquitectura-sistema.md` («Bloque 2») y [quickstart.md](quickstart.md).

## Alcance

Orientación documental en español sobre trámites, requisitos, procedimientos y canales de Ecosistemas, Bienestar Animal y Gestión Ambiental de Envigado, con evidencia citada, límites de decisión, consentimiento verificable, privacidad hacia el proveedor, continuidad entre dos modelos, control de consumo y un panel mínimo para contactos, estado y avisos. **Fuera de alcance**: gestión web de cuentas y documentos (bloque 7), edición del prompt en el panel, webhook/correo de avisos, cualquier proveedor distinto de Bedrock.

## Guion del recorrido

1. La persona abre el chat: ve la presentación fija, la política de datos (versión y enlace https), los canales de atención inmediata y las opciones **Autorizo / No autorizo**. Sin decisión no puede consultar.
2. «Autorizo» → el backend emite un UUID de conversación; hasta 10 pares de historial viajan en memoria. «No autorizo» → cada pregunta se atiende sola, sin texto ni identificadores guardados.
3. Cada consulta: perímetro → validación → saneamiento de datos personales → recuperación → modelo → fuentes realmente usadas → citas, leyenda y canales → límite de 2200 tokens → registro confirmado → `responseId`.
4. Si no hay evidencia: «No encontré información validada…» + canal oficial, sin llamar al modelo. Si falla algo: 503 con canales, nunca una falsa ausencia.

## Decisiones de diseño

| Decisión | Motivo |
|---|---|
| Esquemas `chat`/`admin` con propietario sin login y tres roles limitados; migraciones propias en `backend/migrations/chat/` | Las migraciones 002/003 de la KB ya existían y su runner aplica todo `NNN_*.sql` como `kb_writer`; los roles del runtime no tienen DDL ni escritura sobre `kb` |
| Auditoría append-only por privilegios **y** disparador; último técnico protegido por disparador con candado | La invariante vale aunque falle la interfaz y bajo concurrencia |
| Sesión del panel en BD sin caché, CSRF derivado del token, registro en memoria solo para el modo de base caída | Revocación inmediata; el panel sigue mostrando estado volátil 30 min |
| Contactos con revisión (CAS) y auditoría en la misma transacción; snapshot REPEATABLE READ sin caché | La edición se ve en la consulta siguiente |
| El modelo declara `<!--TIPO-->` y `<!--FUENTES-->`; el sistema intersecta con lo recuperado y lo citado | Evita fuentes sobrantes y respuestas factuales sin sustento |
| Análisis y materias ajenas se rechazan en local antes de recuperar | DI-01/DI-20 deterministas y sin gasto de modelo |
| El tope visible (2200) es independiente del `maxTokens` pedido al modelo | Los cortes forzados se prueban sin romper los canales obligatorios |
| Tokenizador `js-tiktoken` fijado + oráculo de `tiktoken` generado fuera de línea | Paridad exacta sin Python en línea ni `CountTokens` |
| Fragmentación continua de ≤1000 caracteres; la tabla es indivisible y >1000 bloquea la publicación | Lo exige el contrato; el hallazgo se resuelve en la fuente |
| Umbral = mayor valor finito con cero falsas abstenciones, guardado junto a la colección y calibrado ANTES de mover el alias | Sin ventana de corpus nuevo con umbral viejo; sin umbral a ojo |

## Límites reconocidos

- La detección de PII es por ancla léxica o de formato; una cédula a secas no se enmascara.
- Los detectores locales (análisis, riesgo, decisión) son reglas deterministas; el resto lo clasifica el modelo.
- Una publicación incremental no recalibra. Las tablas grandes del corpus real pueden bloquear la reconstrucción hasta corregirse.
- El contador de IP del login vive en memoria: vale para un único runtime.
- El código heredado de proveedores múltiples, el CSV y las cuotas por IP no se invocan, pero siguen en el repositorio hasta que se apruebe su retiro.

## Rutas

Chat: `POST /api/session`, `GET /api/chat/config`, `POST /api/conversations`, `POST /api/chat`. Panel: `/api/admin/{session,password,contacts,status,notifications}`. Salud: `/health`, `/ready`. Páginas: `/`, `/admin/{login,password,contacts,status,notifications}`.

## Gate de la constitución I–X (revisión final, 2026-10-08)

| Principio | Estado | Cómo / qué falta |
|---|---|---|
| I · Orientación preliminar, nunca decisión | Cumple en el contrato | Leyenda exacta garantizada por el compositor ante una petición de decisión; la atribución a la dirección la exige el prompt (**la juzga el revisor**) |
| II · Anclaje documental verificable | Cumple en el contrato | Solo fragmentos recuperados; fuentes = declaradas ∩ recuperadas ∩ citadas; fecha real o error de datos |
| III · Base de conocimiento cerrada | Cumple | Sin tabla documental paralela: el payload sale de la KB; publicación inválida conserva el alias |
| IV · Privacidad por diseño | Cumple | Consentimiento verificable, anónimas autónomas, PII saneada antes de salir, 6 campos sin identificadores, retención 12 m + 24 h. Límite: PII por ancla |
| V · Proveedor único y controlado | Cumple (con deuda inerte) | Solo Bedrock; sin selector ni `/providers`; configuración que habilite otro se rechaza. Los módulos heredados siguen en el repositorio **sin invocarse** |
| VI · Falla segura y transparente | Cumple | Búsqueda o modelo fallidos → 503 con canales, nunca «sin información»; sin SQL/proveedor/trazas |
| VII · Seguridad del perímetro y control de acceso | Cumple | Origen, 60/min/IP, 128 KiB, roles mínimos, argon2id, sesión, CSRF, bloqueos, auditoría append-only |
| VIII · Experiencia accesible e institucional | **Sin verificar** | Construida con etiquetas, foco y regiones vivas; sin revisión en navegador (T096) |
| IX · Trazabilidad cerrada y validación guiada por el fallo | **Parcial** | Hallazgos registrados y corregidos; falta repetir la matriz completa con modelos reales (T098) |
| X · Pruebas automatizadas obligatorias | Cumple | 330 + 64 + 57 + 6 pruebas, CI ampliada (6 trabajos, ejecución de CI no verificada aquí) |

**Deuda de migración**: (1) proveedores activos y selector → retirados del camino público y de la configuración; falta borrar el código. (2) CSV → reemplazado por PostgreSQL; `chatLog.ts` sin uso. (4) panel mínimo construido. No se amplió la deuda.
