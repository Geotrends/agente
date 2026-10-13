# Contrato: colección de Qdrant (kb-worker → backend del chat)

**Escritor único**: `kb-worker`. **Lector**: `backend/src/services/search.ts`, a través del
alias. **Requisitos**: RNF-C3-IV-01, RNF-C3-IV-02, RF-C3-IV-03; constitución, principio III.

## Nombres

- **Alias servido**: `kb_chunks`. El backend **solo** consulta el alias.
- **Colecciones físicas**: `kb_chunks_<yyyymmddHHMMss>`. Solo una está apuntada por el alias.

## Vectores

| Nombre | Tipo | Configuración |
|---|---|---|
| `dense` | denso | `size: 384`, `distance: Cosine` (multilingual-e5-small, prefijo `passage:` al indexar y `query:` al consultar) |
| `bm25` | disperso | `modifier: idf`. Índices = hash estable de 32 bits de cada término de `terms()`. Valores = tf saturado BM25 (k1 = 1,2; b = 0,75) con el `avgdl` de la construcción |

## Payload por punto (un fragmento)

```jsonc
{
  "elemento_id": "uuid",
  "version_id": "uuid",
  "estado": "publicado",
  "tipo": "procedimiento",
  "codigo": "GT-P-004",            // null en páginas y documentos del Observatorio
  "titulo": "GT-P-004 - Procedimiento permisos y autorizaciones ambientales",
  "url": "https://…",
  "url_padre": "https://… | null",   // página que enlaza un PDF o descarga; null en el resto
  "direccion": "gestion_ambiental",
  "fecha_actualizacion": "2022-09-12",   // null si no aplica
  "fecha_acceso": "2026-10-11T02:03:12-05:00",
  "fragmento": 3,
  "pagina": 12,                    // ausente si el formato no tiene páginas
  "texto": "…fragmento…"
}
```

Índices de payload: `elemento_id` (keyword), `estado` (keyword), `direccion` (keyword).
`direccion` anticipa la priorización por categoría de RF-C4-DC-03.

## Consultas del backend

1. **Densa**: `query` con `using: "dense"`, `limit: 40` y el filtro `estado = publicado`.
2. **Dispersa**: `query` con `using: "bm25"`, `limit: 40` y el mismo filtro. Si hay pregunta
   previa, los pesos de sus términos se multiplican por `retrievalContextWeight`, igual que
   el BM25 actual.
3. **Fusión**: RRF del lado del cliente (k = 60) con `reciprocalRankFusion`. Después vienen
   el reranker y la diversificación, sin cambios (bloque 2).

El resultado de `hybridSearch` conserva su forma actual. Lo consumen `answerQuestion.ts` y
`chatLog.ts`.

### Mapeo a los hits de `hybridSearch`

| Campo del hit | Origen en el payload |
|---|---|
| `path` | `url` |
| `sourceUrl` | `url` |
| `sourcePageUrl` | `url_padre` (se omite si es `null`) |
| `title` | `titulo` |
| `category` | `direccion` |
| `page` | `pagina` (se omite si no existe) |
| `chunk` | `fragmento` |
| `snippet` | `texto` |

## Invariantes

- La colección del alias nunca tiene puntos de elementos `pendiente_aprobacion` ni
  `derogado`.
- El cambio de alias es la **única** forma de reemplazar la colección completa (R4).
- Si el alias no existe o Qdrant no responde, `/ready` informa que el chat no está
  disponible. El chat responde `SERVICIO_NO_DISPONIBLE` (RF-C3-IN-04): nunca "sin
  información" (principio VI).
