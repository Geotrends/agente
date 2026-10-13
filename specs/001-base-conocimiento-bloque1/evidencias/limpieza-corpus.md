# Limpieza opcional del corpus anterior (T084; RF-C3-IV-01, FR-002; research R16)

El bloque 1 limita la base a las fuentes del alcance. Las carpetas de las fuentes que
quedaron fuera siguen en el volumen de datos (`geobot-data`, montado en `/data` del
scraper y en `/app/data` del backend y del `kb-worker`), pero **ya no se leen**: el
`kb-worker` solo procesa lo que aparece en un informe de corrida, y las fuentes retiradas
no tienen definición en `scraper/sources.py`. Borrarlas es opcional y solo libera disco.

| Carpeta | Fuente retirada | Notas |
|---|---|---|
| `concejo_envigado/` | Concejo de Envigado | Fuera del alcance (FR-001). |
| `minambiente/` | MinAmbiente | Fuera del alcance. |
| `minagricultura/` | MinAgricultura | Fuera del alcance. |

No tocar: `gmas2_envigado/`, `ambientometro/`, `envigado_com/`, `observatorio_geotrends/`
(fuentes del alcance), `runs/` (informes de corrida) ni `metadata/`.

## Condición previa: confirmar que la colección servida no contiene nada de ellas

```bash
make kb CMD="auditar-alcance"          # debe terminar con código 0 y "ok": true
make kb CMD="estado"                   # alias, colección y conteos
```

`auditar-alcance` compara la matriz, la colección del alias y las reglas de alcance
(puntos sin fila, filas publicadas sin puntos y elementos fuera de las reglas). Si no sale
con código 0, **no borres nada**: investiga primero.

## Procedimiento

1. Hacer una copia si se quiere conservar el material histórico:
   ```bash
   docker compose run --rm --entrypoint sh scraper -c 'ls -d /data/concejo_envigado /data/minambiente /data/minagricultura'
   ```
2. Borrar las tres carpetas (el contenedor del scraper corre con el UID 10001, dueño del volumen):
   ```bash
   docker compose run --rm --entrypoint sh scraper -c 'rm -rf /data/concejo_envigado /data/minambiente /data/minagricultura'
   ```
3. Volver a correr `make kb CMD="auditar-alcance"`: debe seguir en `ok`.

Si la carpeta de datos es un directorio del host (`DATA_DIR=./backend/data`), basta con
`rm -rf` de las tres carpetas sobre esa ruta.

## Registro

| Fecha | Quién | `auditar-alcance` antes | Carpetas borradas | `auditar-alcance` después |
|---|---|---|---|---|
| | | | | |
