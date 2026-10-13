# Guía de validación — Bloque 2

Guía de operación y validación del bloque 2. **Estado (2026-10-08)**: implementado y verificado con dobles de Bedrock (330 unitarias, 64 de integración DI y 57 de la KB en verde; ver `evidencias/aceptacion/integracion-final.md`). **Falta**: la aceptación real con AWS, navegador y revisión funcional (T092–T098); no habilitar producción por leer esta guía. [Contratos](contracts/chat-api.md), [panel](contracts/admin-api.md), [modelo](contracts/bedrock-runtime.md), [recuperación](contracts/retrieval.md), [matriz](contracts/acceptance.md).

## Preparación

- Trabajar en repo `agente` con Node22/npm/Docker, PostgreSQL16/Qdrant y corpus publicado de bloque 1. Conservar cambios locales y volúmenes; jamás `down -v` para instalar esquemas nuevos.
- Aplicar nuevas migraciones por migrador privilegiado idempotente en volumen existente y limpio; verificar runtime sin DDL ni escrituras KB. Comando de bootstrap/migración se añadirá al Makefile siguiendo runner KB; no usar credencial de propietario en backend.
- Cargar contactos aprobados (recepción/general/inmediatos), URL y versión real de política, tarifas oficiales por modelo/región y cuenta inicial con password temporal por CLI protegida. No inventar valores/defaults ni importar CSV como consentimiento.
- Para pruebas locales contratos: adaptador Bedrock doble explícito solo test, sin AWS. Para aceptación real: instancia EC2 con rol IAM o sesión temporal de rol para runner, acceso a ambos IDs y cuota; sin llaves estáticas, sin proxys a terceros.
- Tener tokenizer/modelos locales fijados y cache offline precargada; prueba de paridad previa. Manifest de matriz congelada, fixtures de clasificación determinista y versiones corpus/recuperación/calibración compatibles.

## Comprobaciones locales

```sh
cd backend
npm run typecheck && npm test
npm run test:di-integration     # PostgreSQL 16 + Qdrant de prueba (KB_TEST_ADMIN_URL, QDRANT_URL); modelos locales reales; Bedrock doble
npm run test:kb-integracion
npm run eval:tokenizer          # paridad exacta con el oráculo de tiktoken (fixture versionado)
cd ../frontend && npm test && npm run build
```

[Resultados iniciales previos a la implementación](evidencias/pruebas-existentes.txt) · [integración final](evidencias/aceptacion/integracion-final.md).

## Levantar la versión implementada

```sh
docker compose build backend frontend
docker compose up -d postgres qdrant backend frontend kb-worker
```

Antes de servir, ejecutar migrador y configuraciones según Makefile que implementación debe exponer. Conservar alias anterior durante reindexación. Verificar `/health`200 como liveness y `/ready` disponible solo con base/calibración/configuración válidas; no confundir salud con aceptación.

## Operación y aceptación (comandos reales)

```sh
make migrate-chat                                   # roles + migraciones chat/admin (idempotente, también en volumen existente)
printf '%s' "$CLAVE" | make bootstrap-admin EMAIL=… NOMBRE="…"   # primer administrador; la contraseña llega por stdin
# Panel /admin: cambiar la contraseña temporal y cargar contactos; registrar tarifas por modelo (INSERT en chat.tariff con admin_app)
npm --prefix backend run eval:retrieval -- --calibrar --informe=../specs/002-diseno-modelo-ia/evidencias/calibracion --guardar
make kb CMD="sincronizar --completa --oro=<oro.json>"        # reconstruye y calibra la candidata ANTES de mover el alias
curl -s localhost:8190/ready                         # debe dar 200; si no, dice qué falta

npm --prefix backend run eval:tokenizer
npm --prefix backend run eval:di -- --manifest=test/fixtures/di/manifest.json --models=both --output=../specs/002-diseno-modelo-ia/evidencias/aceptacion/aws-<run> --adapter=aws [--run-delegated]
npm --prefix backend run eval:di-traffic -- --output=…/trafico --adapter=aws
npm --prefix backend run eval:di-load -- --base-url=https://HOST/api --mode=sequential --output=…/rendimiento --policy-version=…
npm --prefix backend run eval:di-load -- --base-url=https://HOST/api --mode=waves --output=…/rendimiento --policy-version=…   # otro día
```

El barrido de calibración recorre **todos** los valores finitos observados; no hay umbral "de muestra". `--models=both` fuerza cada modelo solo en el runner privado. `--adapter=double` valida la mecánica y su informe dice que **no** es aceptación. `eval:di` marca como pendientes (`pass: null`) todo lo que exige revisión funcional.

## Recorridos end-to-end

1. **Consentimiento**: abrir frontend, verificar apertura/política y pregunta deshabilitada hasta decisión. No autorizo→consultas sin historial ni IDs; revisar BD/logs sin contenido/token/hash/identificadores. Autorizo→UUID backend, pares válidos, responseId solo tras commit. Enviar UUID no emitido e historial sin ID→VALIDACION, 0 LLM/registro.
2. **Evidencia**: consultar cinco presentes y cinco ausentes; verificar texto fijo literal+canal, citas enlazadas y fechadas, fuentes utilizadas únicamente y listas vacías para tipos no respondida. Alterar declaración de fuentesen doble para 3 casos: no aparecen sobrantes. Cinco conflictos GT-P/GT-N→procedimiento prevalente.
3. **Recuperación**: recoger trazas de 5 consultas de ambos motores,≤16/≤8 y orden; revisar 5 documentos/2 tablas, fragmentos≤1000 y tablas enteras. Publicar tabla mayor de 1000 en fixture controlada→rechazo versión, aviso y alias anterior íntegro. Duplicados no vuelven al relleno.
4. **Modelo y respaldo**:12 casos de complejidad, reproducibilidad local; 9 situaciones de principal/respaldo/doble caída, errores≤40 s. Reranker apagado→3 consultas con RRF directo, estado sin umbral; restaurar→normal. Cuotas o credenciales inválidas no activan llamadas legacy.
5. **Privacidad**:15 payloads con datos sintéticos, verificar preguntas/fragmentos/historial enmascarados antes de Bedrock. Ocho equivalentes con PII y 3 turnos verifican avisos; códigos normativos intactos. No cadenas de razonamiento en respuesta/logs/historial.
6. **Contactos/panel**: administrador autentica, cambia temporal, modifica un canal y siguiente consulta usa nuevo sin redespliegue; cierres de trámites con 3 canales. Riesgo en texto libre ante canales vigentes; Gestor denegado en API/UI. Pruebas inválidas no fijan valores. Verificar avisos y contador en 3 pantallas y revisión/auditoría.
7. **Consumo/corte**:10 registros cinco por modelo y ≥1 de respaldo, costo recalculado con tarifa; 6 cortes forzados+3 normales, oración completa/cita/aviso y salida oficial/visible≤2200. Diez preguntas por ambos modelos con datos clave equivalentes; review 6 puntos y estructuras tasas 9/10 y 8/9.
8. **Degradación**:fallar escritura con 6 consultas, entrega igual sin responseId, 1 aviso; 2 recuperadas restablecen registro. Cinco estados forzados visibles<60 s incluyendo scraper y registro. Sin webhook. Reloj de purga 11 meses 29 d y 12 meses 1 d; dos ejecuciones automáticas registradas.

## Rendimiento e informe

Ejecutar runner de carga implementado secuencial 100 y 3 oleadas 25 por contrato IN-02/03, en dos días con pausas 2 min de oleadas; exportar p95/duración desde recepción completa y errores≤40 s. Las pruebas reales pueden consumir presupuesto autorizado de staging; no precios inventados, tarifas/versiones conservadas.

Cerrar [matriz](contracts/acceptance.md) con evidencia por cada ID, tráfico 20 consultas solo AWS, versión de build/corpus/prompt/modelos/contactos/tarifas y revisor manual. Hallazgos REAL corregidos → repetir matriz completa en ambos modelos. Documento de diseño/informe antes de declaración H2-C3 completo. Esta guía de plan no realiza despliegue ni prueba real pagada.

## Traspaso (handoff)

| Pendiente | Quién | Dónde |
|---|---|---|
| Rol IAM / sesión temporal con `bedrock:InvokeModel` sobre los dos ARN y cuota | Infraestructura | T092–T095 |
| Contactos, URL y versión de política, tarifas oficiales | Operación / Jurídica | panel y `chat.tariff` |
| Oro y corpus vigentes; medir cuántas tablas > 1000 caracteres bloquean la publicación | Datos / KB | `kb sincronizar --completa --oro=` |
| Revisión funcional (tono, estructuras, citas, 5 conflictos GT-P/GT-N, tasas de riesgo/PII) y firma | Equipo funcional | T097, insumos en `backend/test/fixtures/di/us1.json` |
| Navegador y accesibilidad WCAG 2.1 A/AA del chat y del panel | QA | T096, `evidencias/aceptacion/interfaz.md` |
| Retiro del código heredado de proveedores, CSV y cuotas por IP | Desarrollo (con aprobación) | ver README |
