# Guía de revisión manual SPEC005 (T070)

Para quien revisa en el entorno autorizado. Ningún paso de esta guía se ejecutó en la sesión de implementación. **Una fixture, un doble, una emulación o un archivo de prueba existente no se declara conforme**: el caso se queda `pendiente` hasta tener la evidencia real del componente exigido. Registre cada resultado como un archivo en `evidencias/aceptacion/resultados/` (formato de `scripts/lib/inReport.ts`: `runId`, `caseId`, `componente`, `real: true`, `cantidades`, artefacto con SHA-256) y genere la matriz con `npm --prefix backend run report:in`.

Cantidades exactas: usar las del [manifiesto de 31 casos](../../../../backend/test/fixtures/in/acceptance-manifest.json) y de [acceptance.md](../../contracts/acceptance.md).

## 1. Identidad, rol, política, proxies, contactos, costos y fuentes (N304–N308, N310, C310, C305, C303)

| # | Qué revisar | Criterio | Evidencia a archivar | Casos |
| --- | --- | --- | --- | --- |
| 1.1 | Rol de la instancia: políticas adjuntas e inline y límites de permisos | exportarlas todas y pasarlas a `npm run check:iam -- <archivos>`; solo `bedrock:InvokeModel` y los 2 ARN `foundation-model` | salida del verificador + listado de políticas (sin ARN de otras cuentas) | N307, N308 |
| 1.2 | IMDSv2 y hop limit desde el contenedor | `HttpTokens=required`; el contenedor alcanza IMDS; sin `~/.aws` ni variables de llaves | descripción de `MetadataOptions`; `/ready` 200 | N307 |
| 1.3 | Dos invocaciones y cuatro denegaciones reales | 20b y 120b responden con el rol; tercer modelo, listado de modelos, bucket y gestión de llaves → `AccessDenied` | registros de CloudTrail/errores del SDK sin credenciales | N308 |
| 1.4 | Retiro y restitución del rol (solo con autorización operativa) | consulta → 503 con aviso seguro; al restituir, recupera | cronología con hora; aviso del panel | N307 |
| 1.5 | Topología de proxies | `TRUST_PROXY` coincide con la cadena real; una IP real distinta tiene cupo propio; la cabecera falsificada no evita el límite | tres consultas desde IP distintas y una con cabecera falsa | N305 |
| 1.6 | Contactos del registro | 3 lecturas ≤ 2 s con los valores del panel; una edición se ve en la lectura siguiente sin redespliegue; 0 llamadas al modelo | tiempos y valores (sin datos personales) | C310 |
| 1.7 | Costos y fuentes | el costo registrado = tokens × tarifa vigente; cada documento citado existe en la base publicada con nombre, enlace HTTPS y fecha | 8 registros contra tarifas y catálogo | C305, C303 |
| 1.8 | Escaneo de credenciales (código, imagen, configuración, paquete frontend) | 0 hallazgos; solo conteos y rutas | salida de `npm run scan:secrets` + escaneo de la imagen construida | N307, N310 |

## 2. Navegadores, móviles, lectores, almacenamiento y CSP (N401, N402, C401–C406)

Repetir en **Chrome y Firefox de escritorio**, **Chrome Android** y **Safari iOS** reales, con el portal de aceptación identificado:

| # | Qué revisar | Criterio | Casos |
| --- | --- | --- | --- |
| 2.1 | Tres recorridos completos (autorizado, anónimo, con fallo) | en `localStorage`, `sessionStorage`, IndexedDB, cookies y URL del iframe y del host: **0** textos, tokens o IDs | N401 |
| 2.2 | Cinco ciclos ocultar/mostrar | la conversación se conserva; recargar y cerrar la pierden | N401 |
| 2.3 | Incrustación | solo `https://observatorioenvigado.geotrends.co` incrusta; un origen ajeno, un subdominio y una página sin origen quedan bloqueados en **ambos** móviles | N402 |
| 2.4 | Cabeceras efectivas de `/chat` | una sola CSP con `frame-ancestors` exacto y sin `X-Frame-Options` | N402 |
| 2.5 | Teclado y lector de pantalla | foco inicial, orden, diálogo de «Nueva conversación», estados de espera/fallo y valoración anunciados; sin controles ocultos enfocables | C401–C406 |
| 2.6 | Plazos visibles | 40 s se muestra; a 50 s el fallo aparece entre 45 y 46 s y la respuesta tardía no entra; reintento y reinicio aislados | C403 |

## 3. Registro, purga y valoración sobre el servicio desplegado (N301, C305–C309)

| # | Qué revisar | Criterio | Casos |
| --- | --- | --- | --- |
| 3.1 | Inspección de **toda** la base tras 6 anónimas y 14 consultas con/sin datos | 0 coincidencias de los textos; las anónimas dejan exactamente 6 campos; etiquetas `[CÉDULA]`, `[TELÉFONO]`, `[CORREO]` | C306, C307 |
| 3.2 | Episodio de fallo del registro | 1 aviso con fecha, hora y modo; 2 conversaciones sin `responseId`; vuelve a normal al primer éxito | C308 |
| 3.3 | Purga programada | 2 ejecuciones horarias automáticas del servicio `chat-purge`; textos e IDs fuera, demás campos y valoraciones intactos | N301 |
| 3.4 | Valoración | 12 envíos: 7 guardados, 5 rechazados con mensaje uniforme; sin segunda valoración ni texto libre | C309 |

## 4. Condiciones para NO declarar conforme

- Evidencia solo de doble de Bedrock, nginx de laboratorio, emulación de navegador o archivo de prueba.
- Cantidades incompletas o versiones distintas del árbol (el informe lo señala).
- Tráfico ajeno no separable en la ventana de conciliación anónima (queda `pendiente`).
- Cambió el prompt, la base o la recuperación sin repetir la matriz congelada completa de SPEC002 en ambos modelos.
