# Quickstart de validación — SPEC007

Guía de validación; los comandos de §2 ya existen (implementados). No es evidencia de ejecución: la evidencia vive en `evidencias/`. [Plan](plan.md), [modelo](data-model.md), [contratos](contracts/admin-api.md) y [matriz de aceptación](contracts/acceptance.md) definen criterios y cantidades de los62 requisitos. Los comandos nuevos siguientes son propuestas que deben implementarse antes de usarse.

## 1. Confirmar baseline y entorno

Desde raíz, conservar cambios locales y pendientes001–006; registrar versión/configuración y evidencia disponible. Pruebas usan PostgreSQL16/Qdrant aislados, archivos y cuentas sintéticos; producción requiere acceso autorizado y servicios/revisores reales. No llavesAWS estáticas ni contraseñas en comandos/evidencia.

```sh
git branch --show-current
git status --short
cat .specify/feature.json
npm --prefix backend run
npm --prefix frontend run
```

Esperado: rama real develop, feature007 activa y scripts reales inventariados. Base/calibración/contactos/política/registro/casos de validación disponibles según dueños anteriores. Falta de entorno no se convierte en aceptación con fixtures.

## 2. Migrar y comprobar herramientas

Después de implementar y fijar dependencias/lockfiles, instalar por paquete con `npm ci`. Ejecutar migraciones en entorno aislado mediante operador, jamás rol del runtime: preservar ledgers, grants mínimos y bootstrap de generación vigente cotejado con matriz/Qdrant. Segunda corrida no reaplica ni duplica. Ninguna migración ya aplicada se edita.

Comandos disponibles (implementados en SPEC007):

```sh
npm --prefix backend run admin:migrate
npm --prefix backend run test:admin
npm --prefix backend run test:admin-integration
npm --prefix frontend run test:admin
npm --prefix frontend run build:admin   # export estático a out-admin/
npm --prefix frontend run test:admin:e2e
npm --prefix frontend run test:admin:a11y
npm --prefix backend run eval:admin-performance -- --manifest <ruta-autorizada>
```

Entorno local de prueba: PostgreSQL 16 y Qdrant aislados (`KB_TEST_ADMIN_URL`, `QDRANT_URL`); Chromium local con
`E2E_CHROMIUM_PATH`. Cada suite crea y destruye su propia base; ninguna toca producción ni AWS.

Registrar scripts concretos: migrate-admin.ts; node:test/tsx admin-*.test.ts; integración admin-integracion; Vitestadmin sin suite vacía; Playwrightadminconfig. Runners usan createApp real, DB/Qdrant aislados y proveedor doble; no AWS productivo ni semillas C6. Roles públicos/runtime no ejecutan recovery/DDL ni editan/borran auditoría. Testear contratos antes de afirmar que los comandos están disponibles.

## 3. US1 — acceso, cuentas y recuperación

Ejecutar todos los recorridos AD05..13/RNF01..06 de acceptance.md con ambos perfiles y reloj: campos/correo único, desactivación/revocación/reactivación, último administrador concurrente, cambio propio/temporal y rutas directas bloqueadas. Contraseña11 se rechaza y12 minúsculas se acepta; tres iguales producen valores protegidos distintos, ocho operaciones no exponen secretos. Bloqueos5 por cuenta/20 por IP, límites14/16min y reinicios tras éxito; falsificación de encabezado no evade IP confiable. Sesión29min admite/31min rechaza sin polling; solicitudes cada20min durante90 mantienen sesión.

UI cesa autoactualización al abandonar y cierra al límite humano; el servidor sigue renovando solo por solicitudes válidas. DB caída no usa permisos en overlay. Bootstrap no cambia cuenta existente.

Recepción real Geotrends/Municipio y recuperación son pasos autorizados posteriores. Comando privado **propuesto** `npm --prefix backend run admin:recover`: solicitar correo/contraseña por entrada segura bajo rol reservado; sin PHC/password en argv/env/logs. Tres cuentas prueban exactamente dos parámetrosDB, cambio solo en solicitada, inexistente con error, runtime denegado, revocación/cambio obligatorio y auditoría incluso del error tras rollback. No ejecutarlo en producción durante planificación.

## 4. US2 — carga y ciclo documental

Aplicar todas las muestras de AD01..04/20..27/32/38/39/47: tres formatos válidos/tres cargas inválidas por ambos perfiles, matriz/origen/autor/N/A, pendiente con dato único, publicaciones con tablas y retiro de prueba documentado. Cinco consultas antes/después prueban recuperación y citas; consultas cada30s durante indexación siguen usando anterior completo sin errores.

Forzar primer fallo y segundo exitoso, luego dos fallos; comprobar exactamente dos intentos, limpieza parcial, notificación y anterior preservado. Tres reemplazos exitosos/fallidos y reinicios alrededor de preparación/commit/alias/limpieza prueban ausencia de contenido viejo tras éxito y ninguna eliminación de activa por excepción posterior.202 no equivale a operación Terminada.

Rechazo/retirada exigen motivo y confirmación, cancelación no cambia nada, registro con siete datos y cero contenido/vectores/copies administradas. Dos corridas con rechazados/retirados no los hacen reaparecer; hash nuevo sí. Metadata válida cambia citas siguiente consulta sin cambiar hash; candidata no mezcla vigente. Vencimiento Bogotá ayer/hoy/mañana/nulo y fecha futura de vencido cumplen fuente. Reindex en curso rechaza segundo inicio y falla conserva anterior; CLI usa mismo protocolo.

## 5. US3 — fuentes/propuestas y US4 — contactos

Dos Gestores ven/retiran solo propuestas propias pendientes; ocho propuestas, seis decisiones, ocho cambios directos y catorce hosts preservan cantidades/validaciones de fuente. Pendiente no cambia lista, decisión aprobada aplica siguiente corrida; host permitido no amplía corpus ni panel edita hosts.

Quitar enlace mantiene documentos publicados, cesa verificación siguiente corrida, marca y notificación con cinco datos; sin documentos no aviso. Reagregar/retirar/reemplazar quita marca, manual nunca marcado. Snapshot/version/hash y omisiones por rechazo/retiro se verifican.

Contactos: ocho/siete/diez acciones originales por grupo, nuevos valores/orden en respuesta/lectura/emergencia sin redespliegue; Gestor denegado. Descripción120 admitida,121/vacía rechazada; recepción completa e inmediato≥1. No inferencia para obtenerlos.

## 6. US5 — operación y US6 — interacciones/mejoras

Ocho avisos, agrupación y revisión, contadores en tres pantallas y dos Gestores prueban visibilidad/propiedad; cinco pendientes ordenados por antigüedad; doce acciones+una recuperación generan trece auditorías con cinco datos, filtros y ausencia de edición/borrado/secretos. Cinco degradaciones visibles<60s, normal explícito y estado persistido tras reinicio.

Treinta interacciones20 autorizadas/10 anónimas: lista solo20 con nueve campos/filtros/enmascaramiento; exportación de12 con mismo filtro sin IDs legible en Excel/LibreOffice, XML sin fórmulas/hyperlinks externos y cleanup temporal en éxito/error/cancel/reinicio. Purga concurrente o edad de retención no expone texto vencido ni lo recupera desde caso/export.

Ocho interacciones generan cinco casos, doble origen crea uno, anónima cero. Tres casos recorren seis estados; seis intentos inválidos se rechazan, REAL antes de ajuste/nota de cierre y evidencia posterior aplicable. Seis casos/dos cerrados y uno de45días prueban filtros/contador4→3. Estado de mejora no cierra/reabre hallazgos ni actas006.

## 7. US7 — tableros y tarifas

Muestras40 consultas/20 respuestas/10 valoraciones/20 consumos del documento: totales y categorías/tipos autorizados, anónimas aparte, ranking y empate, cinco motivos, consumos de ambos modelos/costo manual. Sentinelas de texto/IDs ausentes en los cuatro DTOs. NULLcosto señala incompletitud y none se separa.

Cuatro precios válidos y tres inválidos originales, más caso de cinco decimales; soloUSD positivo hasta cuatro. Historia sin recálculo y consulta recibida antes del guardado usa precio anterior aunque termine después. Rango de treinta días civiles Bogotá correcto.

## 8. Rendimiento, accesibilidad y cierre

Runner **propuesto** `npm --prefix backend run eval:admin-performance -- --manifest <ruta-autorizada>` mide solo manifest válido/entorno autorizado; no siembra automáticamente producción. ContratoUI fija release/rango/dataset/medición. C6 requiere1.000 documentos/100.000 interacciones/10.000 auditorías sintéticos,20 cargas por ocho pantallas en dos fechas Bogotá=320 muestras mínimas. p95 por pantalla/día≤3s y cero errores, no promedio global. Preservar muestras y método; nuevas pantallas tienen evidencia adicional.

Axe por cada pantalla/estado, cero A/AA, lista manual100%, teclado/lector identificado, zoom200% y contrastes; revisión de widget004 no acredita nuevas pantallas. Los accesos/revisores reales faltantes quedan pendientes.

Gates existentes después de implementar, con entorno de integración disponible:

```sh
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run test:all
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run test:ui
npm --prefix frontend run test:ui:e2e
npm --prefix backend audit --omit=dev --audit-level=high
npm --prefix frontend audit --omit=dev --audit-level=high
docker build -t geobot-backend:admin-validation backend
docker build -t geobot-frontend:admin-validation frontend
```

Añadir suitesadmin y006 cuando estén implementadas. No permitir suite vacía ni desactivar pruebas para integrar. Corregir hallazgos con REAL/requisito/versión y repetir gates pertinentes. Base/prompt/recuperación repiten006 integrada/ambos modelos; C3/C4 repiteC4 completa y evidencias invalidadas. EntregaH6-C3/H5-C4 necesita62 criterios íntegros; no actas nuevas inventadas ni marks previas modificadas desde esta guía.
