# Quickstart de validación SPEC005

Guía para implementar y validar [plan](plan.md). **No se ha ejecutado por `speckit-plan`.** Comandos existentes no acreditan por sí mismos los requisitos corregidos: primero implementar F1–F4 y sus regresiones. Los scripts nuevos se identifican como futuros; no copiar un comando inexistente para declarar aceptación.

## 1. Prerrequisitos

Desde raíz del repo: Node 22/dependencias lockfile, Docker, PostgreSQL16/Qdrant de arneses aislados, imágenes actuales y modelos locales. No usar volúmenes del usuario para tests. Consultar [SPEC002 quickstart](../002-diseno-modelo-ia/quickstart.md) y [SPEC004 quickstart](../004-interfaz-plataforma/quickstart.md) para preparación de DB, corpus y navegador controlados.

Aceptar realmente requiere: versión/base/calibración congeladas, política/contactos/tarifas oficiales configurados, dos modelos en AWS con rol exclusivo, proxy con topología validada, portal autorizado y consulta de referencia Geoportal, dispositivos Chrome Android/Safari iOS y lectores reales. Registrar configuración pública y hashes, nunca copiar `.env` ni tokens. Falta de acceso mantiene caso pendiente.

## 2. Regresión controlada existente

```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run test:di-integration
npm --prefix backend run test:ui-integration
npm --prefix backend run test:kb-integracion
npm --prefix backend run test:in-integration   # suite IN de SPEC005 (PostgreSQL real aislado, proveedor doble)
npm --prefix backend run eval:tokenizer
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run test:ui
npm --prefix frontend run build:widget
npm --prefix frontend run build:e2e
npm --prefix frontend run test:ui:e2e
```

Esperado: tipos/build sin errores y suites ejecutadas sin casos requeridos omitidos. El script frontend `test:ui` actualmente permite ausencia de tests; el cierre exige reporte con cantidad efectiva, no solo exit 0. DI/UI usan proveedor doble y base real; Playwright emula móvil y host Node. No demuestran AWS, nginx, portal o dispositivo real. Incorporar suite IN en scripts/CI al implementar y verificar su existencia antes de ejecutarla.

Pruebas dirigidas obligatorias: ausencia Origin/preflight 403; 128 KiB+1; sesión inválida; consulta con pool/body/contactos lentos≤40 s; purga conserva fuentes; avisos fecha/modo/recuperación sin duplicación; runner prueba 5 conversaciones/10 anónimas e historial efectivo. Contratos y cantidades en [acceptance](contracts/acceptance.md).

## 3. Servicio integrado con nginx

En entorno de validación autorizado con configuración oficial ya preparada:

```bash
make build
make migrate-chat
make up
```

Son targets existentes, no comandos ejecutados aquí. Migraciones idempotentes, roles mínimos y purga programada; comprobar `/ready` sin mostrar secretos. Preparar base/publicación con comandos de SPEC001, no asumir ready por health 200. Bootstrap admin solo si hace falta y con flujo seguro existente.

Inspeccionar entrada pública con cuatro clases N312 y ampliar 401/403/413/429/proxy 502/503/504: todas no-store y catálogo genérico. Generar respuestas reales desde navegador; no guardar headers de autorización en HAR. Verificar 3 lecturas contactos≤2 s/edit→siguiente lectura/0 LLM, seis anónimas con inspección completa de BD y ocho registros autorizados. Recorrer los seis casos de identidad y doce turnos de historial, valoración y reinicio con los contratos españoles existentes.

## 4. IAM y navegador reales

Revisar proveedor explícito de instancia, políticas efectivas y dos ARN del [contrato de seguridad](contracts/runtime-security.md). Invocar ambos modelos desde servicio; probar cuatro denegaciones. Retiro temporal de rol solo en entorno donde exista autorización operativa; restaurar y dejar evidencia segura de aviso/recuperación. Escaneo reporta conteos/rutas sin imprimir secretos.

En portal de aceptación revisar 6 pruebas CSP y bloqueos también en iOS/Android reales. Tres recorridos Chrome y Firefox: storage/cookies/URL sin texto, 5 ocultaciones conservan, recarga pierde. Recorridos lector/teclado/error/contactos y nueva conversación cubren dependencias 003/004. Fixtures y capturas antiguas no sustituyen estas revisiones.

## 5. Rendimiento en dos días distintos (comandos efectivos, verificados con el servicio controlado)

Definir `IN_BASE_URL` (HTTPS del chat terminado en `/api`), `IN_ORIGIN` (origen exacto del ChatBot), `IN_POLICY_VERSION` y `IN_EVIDENCE_DAY` (directorio del día). Son parámetros públicos, no credenciales. El runner respeta la cuota real de 60 consultas/min y prepara sesiones y conversaciones **fuera** del cronómetro.

```bash
# N302: 100 secuenciales 40/30/30 (10 autorizadas con 10 pares, 10 largas ≥700 tokens), manifiesto congelado
npm --prefix backend run eval:di-load -- \
  --base-url="$IN_BASE_URL" --origin="$IN_ORIGIN" --policy-version="$IN_POLICY_VERSION" \
  --mode=sequential --count=100 --manifest=backend/test/fixtures/in/load-manifest.json --output="$IN_EVIDENCE_DAY"

# N303: 3 oleadas de 25 (15 autorizadas de 5 conversaciones + 10 anónimas), pausa de 2 min
npm --prefix backend run eval:di-load -- \
  --base-url="$IN_BASE_URL" --origin="$IN_ORIGIN" --policy-version="$IN_POLICY_VERSION" \
  --mode=waves --waves=3 --size=25 --gap-ms=120000 --output="$IN_EVIDENCE_DAY"
```

Cada corrida guarda un JSON con `fechaLocalBogota` (distingue los dos días), auditoría de la muestra y metadatos por caso (sin textos). Sale con código 1 si falla cualquier criterio: 100 casos 40/30/30, 10 historiales efectivos, 10 largas validadas, p95 ≤ 20 s, ninguna > 40 s, oleadas con 0 errores y composición 15/5/10. Repetir **otro día** America/Bogota con la misma versión/configuración; 150 registros totales (90 + 60). La conciliación con la base (`scripts/lib/loadReconciliation.ts`, acceso restringido) deja el criterio **pendiente** si hay tráfico ajeno no separable en la ventana.

## 6. No degradación e informe

```bash
# N313: 180 muestras = 30 × 2 destinos × 3 condiciones (sin carga, reindexación completa, oleada de 25)
npm --prefix backend run eval:di-host -- \
  --observatorio-url="$IN_OBSERVATORIO_URL" --geoportal-url="$IN_GEOPORTAL_URL" [--geoportal-method=POST --geoportal-body='{…}'] \
  --base-url="$IN_BASE_URL" --origin="$IN_ORIGIN" --policy-version="$IN_POLICY_VERSION" \
  --reindex-cmd='make kb CMD="sincronizar --completa"' --output="$IN_EVIDENCE_DAY"
```

Cada destino se compara con **su propia** línea base (p95 de carga / p95 base ≤ 1,2, 0 errores, timeout de 120 s contado como error, solapamiento de cada muestra con la ventana de carga). Las ventanas adicionales se identifican como `extra` y no sustituyen las oleadas de N303.

Otros comandos de SPEC005 (existentes):

```bash
npm --prefix backend run test:in-integration                         # suite IN completa (PostgreSQL real aislado, proveedor doble, nginx en Docker)
npm --prefix backend run check:iam -- <politica.json> [...]          # contrato IAM: 1 acción, 2 ARN, 2 éxitos y 5 denegaciones
npm --prefix backend run scan:secrets                                # conteos y rutas de patrones de credenciales (sin valores)
npm --prefix backend run eval:injection -- --models=both [--adapter=aws --output=<json>]   # matriz N311 (9 casos × 2 modelos)
node --import tsx backend/scripts/build-load-manifest.ts --check    # el manifiesto de carga sigue vigente
```

Consolidar 31 casos: 30 activos íntegros + N309 descartado (`npm --prefix backend run report:in`, ver T071). Evidencia con resultados efectivos, hashes incluidos los archivos sin seguimiento, entornos por componente y revisión manual. Avisos/purga muestran 2 ejecuciones automáticas y no pérdida de campos permitidos. Hallazgos REAL se corrigen y vuelven a probarse; cambios de prompt/base/recuperación repiten la matriz 002 completa en ambos modelos. El cierre informa pendientes y no marca tareas previas ni firma el acta del Bloque 6.
