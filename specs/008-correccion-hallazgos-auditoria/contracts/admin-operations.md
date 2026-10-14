# Contrato — Operaciones documentales (panel, perfil administrador técnico)

Cubre FR-008, FR-009, FR-004..FR-007, FR-022. Base: `/api/admin`; cookie de sesión, CSRF y Origin como el resto del panel.

## Estado visible de una operación
`GET /api/admin/document-operations/{id}` conserva `estado` (`En curso` | `Terminada` | `Fallida`) y
añade:

| Campo | Valores |
|---|---|
| `proximoIntento` | ISO-8601 o `null` (reintento programado: la operación «En curso» está en espera) |
| `intentosLimpieza` | entero |
| `requiereAtencion` | `true` al agotar los 5 reintentos rápidos (15 s·2ⁿ); sigue reintentando cada hora |

## `POST /api/admin/document-operations/{id}/resume`

Reanuda de inmediato una operación en espera o que requiere atención. Solo administrador técnico,
con CSRF y Origin como el resto del panel.

- **Cuerpo**: `{}`.
- **200**: `{ "id": "...", "estado": "En curso" }`.
- **403**: perfil Gestor. **404**: no existe. **409** `OPERACION_TERMINADA`: ya terminó o falló. **422**: cuerpo con campos desconocidos.
- Auditoría: acción `documento.reanudar_operacion`, sin contenido de documentos.
- Idempotente: reanudar dos veces equivale a una.

## Errores de operación (`error_code`)
`candidata_cambiada`, `limpieza_pendiente`, `indexacion_fallida`, `sin_vigente`, `documento_inexistente`, `ocr_excede_limites`, `expansion_excesiva`. Mensajes genéricos al ciudadano; detalle solo en el panel.
