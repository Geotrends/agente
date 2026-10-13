# Contrato: CLI del operador `kb` y servicio interno

En el bloque 1 no hay panel (decisión del usuario). El administrador técnico opera con una CLI
dentro del contenedor `kb-worker`:

```bash
docker compose exec kb-worker node dist/kb/cli.js <comando> [opciones]
# atajo: make kb CMD="<comando> [opciones]"
```

Cada comando llama a una función del módulo `kb/service`. Las pantallas autenticadas del
bloque 7 (RF-C3-AD-*) reutilizarán **las mismas funciones**: la CLI no contiene lógica
propia.

**Códigos de salida**: `0` éxito, `1` error de validación, `2` error de infraestructura
(PostgreSQL o Qdrant no disponibles).

Toda acción que modifica datos escribe en `kb_auditoria`.

| Comando | Función de servicio | Efecto | Requisitos |
|---|---|---|---|
| `migrar` | `aplicarMigraciones()` | Aplica las migraciones pendientes en una transacción. Idempotente. | — |
| `sincronizar [--informe <archivo>]` | `procesarInforme(ruta)` | Procesa los informes pendientes de `/data/runs` o uno concreto: verificaciones, alcance, versiones pendientes, derogados, notificaciones. | IV-01..IV-04, IV-07, IV-08, IV-10 |
| `sincronizar --completa [--medir]` | `reconstruirColeccion()` | Construye una colección nueva desde las versiones publicadas y cambia el alias. Con `--medir` reprocesa además la conversión y el OCR desde los archivos y registra la duración de cada etapa. | RNF-IV-01, RNF-IV-02 |
| `pendientes [--json]` | `listarPendientes()` | Lista los elementos con versión pendiente (clave, tipo, origen, días). | — |
| `publicar <clave>… \| --todos-pendientes` | `publicar(claves)` | Indexa la versión pendiente, la marca publicada y borra la anterior. | FR-017 |
| `notificaciones [--todas] [--json]` | `listarNotificaciones()` | Lista las notificaciones; por defecto, las no revisadas. | FR-018 |
| `revisar <id>` | `marcarRevisada(id, actor)` | Marca una notificación como revisada. | FR-018 |
| `recalcular-direcciones` | `recalcularDirecciones(actor)` | Vuelve a aplicar el mapa de `backend/config/base-conocimiento.json` a todos los elementos, actualiza el payload `direccion` en Qdrant (`set_payload` por `elemento_id`) y audita. | IV-11 |
| `exportar-matriz [--salida <ruta>]` | `exportarMatriz()` | Genera el .xlsx del [contrato](./matriz-xlsx.md). | IV-12 |
| `exportar-fichas [--salida <dir>]` | `exportarFichas()` | Escribe un .md por ficha y por página publicada. | IV-05, IV-06 |
| `auditar-alcance [--json]` | `auditarAlcance()` | Compara la matriz con la colección del alias y con las reglas de alcance. Termina con código `1` si hay puntos sin fila, filas publicadas sin puntos o elementos fuera de las reglas. | IV-01, IV-11 |
| `purgar-retencion` | `purgarRetencion()` | Ejecuta la retención a mano (también corre a diario). | RNF-IV-03 |
| `estado` | `estadoBase()` | Alias, colección, conteos por estado, última corrida, última indexación. | — |

## Proceso de larga duración

`node dist/kb/worker.js` es el comando por defecto del servicio `kb-worker`:

- al arrancar, aplica las migraciones pendientes;
- cada 5 minutos, procesa los informes pendientes;
- una vez al día, ejecuta la purga de retención;
- en cada ciclo, corre el vigilante de la corrida semanal (R5).
