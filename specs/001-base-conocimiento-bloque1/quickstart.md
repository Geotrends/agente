# Quickstart: validación del Bloque 1

Esta guía demuestra que la feature cumple los criterios de éxito de la [spec](./spec.md).
Los comandos de la CLI están en [contracts/kb-cli.md](./contracts/kb-cli.md).

## Prerrequisitos

- Docker Compose v2 y `make`. `.env` creado desde `.env.example` con las variables nuevas:
  `POSTGRES_*`, `KB_DATABASE_URL`, `APP_DATABASE_URL`, `QDRANT_URL`, `SCRAPER_CRON`,
  `OCR_MIN_CONFIDENCE` y `KB_RETENCION_MESES`.
- `SCRAPER_SOURCES` vacío o con las 4 fuentes autorizadas. Concejo y los ministerios ya no
  existen como fuente.
- Los mapas de R11 confirmados por el Líder de Proyecto en
  `backend/config/base-conocimiento.json`.

## 1. Arranque

```bash
make up                       # postgres, qdrant, backend, frontend, kb-worker y scraper (programado)
make kb CMD="estado"          # migraciones aplicadas; el kb-worker crea la colección vacía al arrancar
```

**Esperado**: `/ready` responde "no disponible" mientras la colección esté vacía (sin base publicada). El
chat responde `SERVICIO_NO_DISPONIBLE` y nunca "sin información".

## 2. Primera carga y publicación inicial

```bash
make scrape                   # corrida manual (programada=false) → /data/runs/<id>.json
make kb CMD="sincronizar"     # matriz con todo en pendiente_aprobacion
                              # si el kb-worker aún procesa la corrida (el OCR tarda), avisa "la está procesando otro proceso";
                              # `kb estado` muestra corridasEnProceso y `publicar` se niega hasta que termine (o --forzar)
make kb CMD="exportar-matriz" # revisión con las Direcciones (hito H3-C3)
make kb CMD="publicar --todos-pendientes"
make kb CMD="auditar-alcance" # código de salida 0
```

| Comprobación | Criterio |
|---|---|
| La matriz tiene los 6 GT-P, todos sus formatos y normas, los MG citados y las fuentes del Observatorio; ninguna fila del Concejo ni de los ministerios. | SC-001, SC-002 |
| Cada MG de la matriz aparece en `formatos_vinculados` o en el cuerpo de algún GT-P. | SC-002 |
| `auditar-alcance` reporta 0 puntos sin fila y 0 filas publicadas sin puntos. | SC-001 |
| El .xlsx abre en Excel y en LibreOffice, con 12 columnas y tantas filas como `kb_elemento`. | SC-011 |

## 3. Fichas, páginas y tablas

```bash
make kb CMD="exportar-fichas --salida /app/var/exports/fichas"
```

| Comprobación | Criterio |
|---|---|
| Cada GT-P y MG-P tiene su ficha con los 10 campos del [contrato](./contracts/encabezados-markdown.md), y sus códigos coinciden con GMAS2. | SC-003 |
| Dos `sincronizar` sin cambios en una página dan la misma huella; al editar una página de prueba, la huella cambia. | SC-013 (IV-06) |
| En GT-P-004 y GT-P-021, las tablas "Flujos de trabajo y actividades", "Políticas de operación" y "Documentos referencia" tienen sus filas y columnas originales, sin "Cargando..." ni separadores dentro de celdas. Si alguna falla, se revisan los 6. | SC-004 |
| Revisión manual del 100 % de los formatos, registrada en `evidencias/formatos-revision.md`: todos los campos de diligenciamiento vacíos. Una copia diligenciada de GT-F-011, introducida como prueba, queda `formato_diligenciado` y con notificación. | SC-005 |

## 4. OCR

Pruebas automatizadas (`npm test`, suite `ocr-*`):

- fixtures de un PDF escaneado legible, un PDF escaneado ilegible, un PDF nativo de
  exactamente 79 y 80 caracteres, un DOCX con una imagen escaneada y un PNG.

Validación sobre el lote real (`make kb CMD="sincronizar --completa --medir"`):

| Comprobación | Criterio |
|---|---|
| `kb_procesamiento`: cargados + descartados = total del lote con OCR; ningún cargado con confianza ≤ 80. | SC-006 |
| Un registro y una notificación `descarte_ocr` por cada descarte. | SC-006 |
| El PDF de 79 caracteres pasa por OCR y el de 80 no; el PNG pasa por OCR. | IV-08 |

## 5. Vigilancia semanal, derogados y fallas

**Programación**:

- `SCRAPER_CRON` semanal; en el entorno de prueba se usa un intervalo corto para acelerar.
- Tras dos ciclos, `select url, count(*), max(fecha_hora)-min(fecha_hora) from
  kb.kb_verificacion group by url` muestra ≥ 2 filas por enlace y ≤ 7 días entre ellas,
  todas con `programada = true`. → **SC-007**

**Derogado**: con el documento de prueba de la fixture de GMAS2 (estado "Derogado"):

- el elemento queda `derogado`;
- `auditar-alcance` confirma 0 puntos;
- 10 consultas sobre su dato único no lo recuperan;
- hay una notificación `documento_derogado` con el documento, la fecha y la hora.
- → **SC-008**

**Falla**: se apunta un enlace de prueba a un host caído y otro a una página con la
estructura alterada:

- notificación `verificacion_fallida` en la misma corrida;
- las consultas siguen devolviendo la versión publicada.
- → **SC-008**

**Vigilante**: se detiene el scraper durante más de 7 días simulados y aparece
`verificacion_atrasada`.

## 6. Reindexación sin interrupción

```bash
# terminal 1: una consulta cada 30 s, se registran el código HTTP y la latencia
backend/scripts/sonda-chat.sh 30
# terminal 2
make kb CMD="sincronizar --completa"
```

| Comprobación | Criterio |
|---|---|
| El 100 % de las consultas responde sin error durante toda la reindexación. | SC-009 |
| Con un fallo forzado (`NODE_ENV=test KB_FALLO_FORZADO_EN=50%`; la variable se ignora sin `NODE_ENV=test`, así que nunca actúa en producción; hay que definir ambas en el entorno del `kb-worker`, p. ej. `docker compose run --rm -e NODE_ENV=test -e KB_FALLO_FORZADO_EN=50% kb-worker node dist/kb/cli.js sincronizar --completa`): indexación `fallida`, alias intacto, el 100 % de las consultas sin error y la notificación `indexacion_fallida`. | SC-009 |
| `kb_indexacion.duracion_etapas_ms` suma menos de 2 h, en 3 de 3 mediciones en el entorno de producción (C6). | SC-010 |

## 7. Retención

```bash
make kb CMD="purgar-retencion"
```

Con filas sembradas de 11 meses de antigüedad en `kb_verificacion`, `kb_procesamiento` y
`kb_notificacion` (revisadas), las filas siguen ahí y son consultables. Las de 14 meses se
purgan. Las no revisadas nunca se purgan. → **SC-012**

## 8. No regresión del chat

**Resultado de T077 (2026-10-08)**: corpus completo publicado (584 elementos, 3117 puntos en
Qdrant, colección `kb_chunks_20261008180226171`). recall@8 = 96,4 % (14 factuales), MRR 0,7202,
nDCG@8 0,7788; frente a la línea base +17,9 puntos de recall@8, sin regresión. Abstención 0/24
(el sistema no se abstiene con el `MIN_RERANK_SCORE` actual: hallazgo para el bloque 2). La
línea base se calculó con el conjunto antes de la revisión humana (T086), que añadió una ruta a
ac01 y ac04; la comparación es indicativa, no idéntica.

**Revisión humana del conjunto acotado (T086)**: Luis Ojeda, 2026-10-08. Se revisaron las 14
preguntas factuales (ac01–ac14): pregunta, URL de origen esperada y vigencia.

- ac01 y ac04: la respuesta está en el formato vinculado (GT-F-011 y GT-F-058); se añadió a
  `relevantPaths` junto al procedimiento.
- ac02, ac03, ac05–ac09, ac11, ac12 y ac14: validadas sin cambios.
- ac10: el documento citado es correcto; existen documentos más recientes aplicables, pero no
  están en GMAS2, por lo que la recuperación es correcta para el alcance del bloque 1.
- ac13: validada; la ruta principal es la de GMAS2 (GT-P-020), la de Ambientómetro es válida
  pero algo desactualizada y se mantiene como segunda ruta.

```bash
# Qdrant no publica puertos: abrirlo solo para esta corrida (ver README) y apuntar QDRANT_URL
cd backend && QDRANT_URL=http://localhost:6333 npm run eval:retrieval -- \
  test/fixtures/golden-set-acotado.json --baseline=test/fixtures/baseline-acotado.json
```

- recall@8 con Qdrant ≥ recall@8 con el índice en memoria − 2 puntos (R17);
- `npm test` y `npm run test:integration` en verde.

## Limpieza opcional del corpus anterior

```bash
make kb CMD="estado"   # confirmar que la colección servida no contiene esas fuentes
# borrar del volumen de datos las carpetas concejo_envigado/, minambiente/ y minagricultura/
```
