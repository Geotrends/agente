# Regresión (T063) — 2026-10-13

`cd backend && npm run test:all` (PostgreSQL 16 y Qdrant 1.19.2 locales, nginx real en Docker):

| Suite | Resultado |
|---|---|
| `npm test` (unitarias) | 328/328 |
| `test:seguridad-008` | 26/26 |
| `test:di-integration` | 75/75 |
| `test:ui-integration` | 21/21 |
| `test:in-integration` | 71/75 → **75/75** tras corregir el arnés (montar `security-headers.conf` en nginx) |
| `test:kb-integracion` | 58/58 |
| `test/admin-integracion` | 145/145 + las nuevas `seguridad-008-*` |

`web_scraper`: `python3 -m unittest discover -s tests` → 94 OK. Frontend y backend: `tsc --noEmit` limpio.
No se ejecutó: matriz congelada contra Bedrock real (T067) ni la re-auditoría (T065).
