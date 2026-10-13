# Integración local SPEC006

Fecha: 2026-10-11. Ejecución autorizada en imagen Docker aislada; aceptación contractual pendiente. Commit base develop 3f56d8e91a78e8cf9f39c86472940f58eb5f09e8, workspace modificado y trabajo concurrente SPEC007. Esta evidencia no identifica una release recibida ni un despliegue.

| Comprobación | Resultado efectivo | Alcance |
|---|---|---|
| Backend typecheck | PASS | Código, scripts y tests |
| Backend test:validation | 34/34 PASS | Contratos/CLI/expedientes sintéticos |
| Backend unitarias en imagen final | 378/378 PASS, 0 skips | env -u AWS_EC2_METADATA_DISABLED npm test |
| Backend test:validation-integration en imagen final | 7/7 PASS, 0 skips, 64 s | PostgreSQL/Qdrant/pipeline reales aislados, AWS doble |
| DI integración en imagen | 75/75 PASS | Dobles y modelos ONNX locales reales |
| UI integración nativa | 21/21 PASS | Host profile aislado |
| IN integración nativa | 75/75 PASS, 0 skips | Incluye nginx Docker; 229,5 s |
| KB integración nativa | 57/57 PASS, 0 skips | OCR/pipeline/índice; 59,3 s |
| Frontend tipos | PASS | tsc --noEmit |
| Frontend Vitest | 116/116 PASS | 11 archivos |
| PR flujos controlados | 22/22 PASS + 1 negativo runner | Fixture C4; Chrome y viewport emulados/stub |
| Regresión E2E widget | 98/100 inicial; 6/6 CSP después de corregir sus dos fallos | No se repitió la suite entera; no se desactivaron tests |
| Auditoría backend omit=dev | exit0: 0 altas; 6 moderadas | Lockfile actual; sin audit fix --force |
| Auditoría frontend omit=dev | exit0: 0 vulnerabilidades | Lockfile actual |
| Build imagen validación | PASS | Node22/OCR/modelos cacheados |
| Build imágenes nativas backend/frontend | PASS | Producto; pruebas frontend excluidas del contexto de producción |

Las primeras unitarias Docker fallaron en dos tests de configuración EC2 por AWS_EC2_METADATA_DISABLED=true del compose. Se repitieron con esa variable retirada solo para esas unitarias; 378/378 pasan. La integración VA conserva el bloqueo de metadata. Las primeras regresiones IN con red internal no admitían acceso desde host; el override temporal habilita puertos solo loopback. No se cambió la red interna del compose por defecto ni se usaron recursos operativos.

CSP: tests del propietario SPEC004 ahora verifican infracción frame-ancestors observada y ausencia del contenido protegido, en lugar de una URL interna específica de Chrome. Las cabeceras de producción no cambiaron. El build frontend inicialmente incluía pruebas que importan backend desde un contexto que solo contiene frontend; .dockerignore excluye test/ del artefacto productivo. Las pruebas permanecen habilitadas en checkout/CI.

CLI ejercitados: check/freeze C3/C4, review derivado/hash, VA integrado y por ambos modelos, finding-register/transition/view/ledger, importación física sintética por lote idempotente, report draft/require-ready, validación positiva/negativa de recibos de acta y rechazo CLI de acta draft. No se ejecutó acta sobre originales auténticos ni PR contra portal real. Pruebas de expedientes AWS/physical son fixtures de contrato en tmp, sin inferencia o dispositivo real.

CI conserva suites propietarias y agrega validacion-aislada; GitHub Actions remoto no fue ejecutado. Hooks before/after_implement comprobados: vacíos. Checklist requirements 16/16 PASS, sin modificar sus marcas. Prerrequisitos dirigidos explícitamente a006 sin alterar selector007.

No hay candidata factual ni matriz aprobada/congelada real, base/calibración/modelos actuales comprobados, rol AWS, portal de aceptación, dispositivos/lectores/revisores físicos ni originales con ambas firmas. formatos-revision.md acredita revisión manual documental de formatos; no acredita calibración del umbral ni aprobación VA/PR. T018–T020/T032–T033/T040/T047/T049–T051/T058–T065/T067 conservan pendientes. Ver cierre.md para los 12 requisitos.

Las bases/servicios temporales se retiran al finalizar; imágenes se conservan localmente. No hubo commit, despliegue, publicación, envío externo o firma. Los logs de sesión viven en tmp y las evidencias durables se resumen aquí sin cuerpos ciudadanos, prompts ni credenciales.

## Identidad de imágenes locales

- agente-spec006-validation:local: sha256:f37c784ad5f6997da44ff9b1afb09846812164dd81e0ded7bbad9f8bd2d57ced.
- agente-spec006-backend:local: sha256:6f512995f0ef9603adc2e70b50d0303c14bae2c046356578cc90092b04337b43.
- agente-spec006-frontend:local: sha256:2e39d29bd5de042d09e74fb509058dd6e3580ad9dc208101de6bfd39052b85b0.

Inspección por Docker image inspect, sin configuración de secretos. El proyecto spec006-validation y su red ya fueron retirados con compose down; no se retiraron servicios ajenos.
