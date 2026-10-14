# Entorno de validación local (2026-10-13)

- PostgreSQL 16 local (`initdb` en `/private/tmp/gbpgdata`, puerto 55432, usuario `geobot_admin`, base `geobot_test`).
- Qdrant 1.19.2 en Docker (`gbqdrant`, puerto 127.0.0.1:56333).
- Tesseract, `pdftoppm` y `pdfinfo` (Homebrew) disponibles; sin Chromium instalado de forma global (la prueba del scraper usa un servidor local y, si Playwright no tiene navegador, se documenta).
- Sin red externa, sin credenciales AWS ni claves de proveedores; la matriz congelada contra Bedrock real no se ejecuta aquí.
