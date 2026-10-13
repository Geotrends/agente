# Matriz de aceptación SPEC005

Un caso por ID fuente:31 enumerados, 30 activos y N309 descartado. Todos están pendientes de ejecución de SPEC005. Cantidades obligatorias del [spec](../spec.md) y [extracto](../evidencias/requisitos-pdf.txt); protocolo de informe en [performance-evidence](performance-evidence.md). La columna de evidencia define qué debe obtenerse, no afirma que ya existe.

**Entornos**: C=controlado con dobles explícitos; DB=PostgreSQL real aislado; A=AWS/rol/dos modelos reales; P=entrada nginx y servicio desplegado; H=Observatorio/Geoportal reales; B=navegadores/lectores/dispositivos reales. Donde la fuente exige simulación, C forma parte de aceptación; nunca reemplaza A/P/H/B donde se requieren.

| Caso | Requisito | Cantidades/criterio completo | Entorno/evidencia requerida |
| --- | --- | --- | --- |
| C301 | RF-C3-IN-01 | 3 conversaciones×3 turnos, 5 anónimas, 3 IDs no emitidos; modos 100%, IDs propios, sin filas/IDs anónimos | C+DB regresión; A/P tráfico y filas sintéticas |
| C302 | RF-C3-IN-02 | 12 peticiones, 8 válidas/4 inválidas; 15→10 pares; campo/0 LLM/0 registro en inválidas | C+DB exactos; A/P historial efectivo sin PII |
| C303 | RF-C3-IN-03 | 10 consultas:6 autorizadas/4 anónimas; tipos, citas/fuentes, IDs únicos ligados | C+DB; A/P verificación de documentos citados |
| C304 | RF-C3-IN-04 | 9 casos:3 validación/3 indisponibilidad/2 tiempo/1 interno; ≤40 s sin fugas, evento+aviso | C+DB fallos inducidos; P cronología con proxy y body/pool/error lentos |
| C305 | RF-C3-IN-05 | 8 éxitos/8 registros con 9 campos+DI16; IDs/fuentes coinciden, fecha/duración integral | DB+C; A/P costo/modelo/registro real |
| C306 | RF-C3-IN-06 | 14 textos:9 PII/5 sin; etiquetas, códigos/fechas preservados, entrega intacta por saneado de registro | C+DB; A/P datos exclusivamente sintéticos |
| C307 | RF-C3-IN-07 | 6 anónimas, solo 6 campos, 0 texto en toda BD/filas de conversación/IDs | DB+C; A/P inspección de todos destinos |
| C308 | RF-C3-IN-08 | 6 fallos/2 recuperadas; orientación completa, 2 autorizadas sin ID, 1 aviso fecha/modo, retoma éxito | C+DB fallos/carreras/recuperación; P panel seguro |
| C309 | RF-C3-IN-09 | 12 envíos:7 guardados/5 rechazados; sin texto libre, sin segunda valoración | DB+C; P registro real y propiedad, concurrencia/purga |
| C310 | RF-C3-IN-10 | 3 lecturas≤2 s, valores del registro, edición sin redespliegue, 0 LLM | DB+C; P edición en panel y lectura del servicio |
| C401 | RF-C4-IN-01 | 6 recorridos:autorización 1 ID, anónimo 0, nueva/recarga distintos, storage 0 | C+DB; B/P tráfico y memoria |
| C402 | RF-C4-IN-02 | 3 recorridos:12 autorizadas con 10 pares en 12ª, anónimo/fallo sin historial indebido | C+DB; B/A/P historial real |
| C403 | RF-C4-IN-03 | 4 pruebas:40 s visible, 50 s fallo 45–46 s, tardío descartado, reintento/reinicio aislados | C navegador con reloj; B/P cronología/cancelación |
| C404 | RF-C4-IN-04 | 6 pruebas:2 validación/2 internos/502HTML/estructura inválida; sin texto técnico/pares fallidos | C navegador; P error de intermediario y B lectura |
| C405 | RF-C4-IN-05 | 6 respuestas:2 con ID/2 autorizadas sin ID/2 anónimas; solo 2 con controles | C+DB; B/P teclado/valoración real |
| C406 | RF-C4-IN-06 | 4 fallos/recuperaciones contactos; inicial≤5 s, repetición emergencia/fallo, enlace+texto fijo | C navegador; P contactos/edición y B flujo |
| N301 | RNF-C3-IN-01 | 11 m 29 d conservado/12 m 1 d depurado; 2 ejecuciones automáticas, texto/ID0, otros campos iguales | DB fechas simuladas; P programador horario y registros, fuentes/valoración conservadas |
| N302 | RNF-C3-IN-02 | 100 secuenciales/día 40/30/30, 10 hist 10 largas, p95 ≤20 s, ningún silencio>40 s, 2 días | A/P producción; manifiesto/cuerpo completo y medidas válidas |
| N303 | RNF-C3-IN-03 | 3×25/día, pausas 2 min, 15 de 5 conv+10 anon, p95 ≤20 s/0 errores, 75 registros/día, 2 días | A/P; conciliación por modo sin IDs anónimos nuevos |
| N304 | RNF-C3-IN-04 | 8 orígenes:2 válidos/6 rechazos 403, incluye ausencia y preflight, 0 LLM/registro | C regresión; P entrada pública/CORS |
| N305 | RNF-C3-IN-05 | 62 en 30 s=60+2 rechazos, Retry After, otra IP, falsificación, 60/min 5 min sin 429 | C reloj; P topología/IP/ventana real |
| N306 | RNF-C3-IN-06 | 6 cuerpos:100 KB, 20000 caracteres, 131072, 131073, 5 MB±longitud; sin acumular rechazo | C streaming; P nginx/backend/memoria segura |
| N307 | RNF-C3-IN-07 | 0 llaves en repo/imagen/env/config; 2 modelos con rol, retiro→503/aviso | Escaneo sin imprimir secretos; A/P IMDSv2/rol servidor |
| N308 | RNF-C3-IN-08 | 1 acción/2 ARN sin comodines; 2 éxitos, tercer modelo/listado/bucket/claves denegadas | A revisión políticas efectivas y denegaciones reales |
| N309 | RNF-C3-IN-09 | Descartado por fuente; no rotación de llaves | Constancia documental, excluido de los 30 activos |
| N310 | RNF-C3-IN-10 | 8 escenarios:4 fallos/2 éxitos/1 reinicio/1 revisión código + paquete; 0 fugas | C SDK señuelos+logs/avisos/BD/HTTP/frontend/imagen |
| N311 | RNF-C3-IN-11 | 9 inyecciones:3 pregunta/3 historial/3 fragmentos; prompt 0, respaldo/alcance/leyenda | C defensas; A ambos modelos y matriz congelada |
| N312 | RNF-C3-IN-12 | 4 clases(éxito, 503, valoración, validación)no-store; repetición generada 2 invocaciones; extender errores tempranos/proxy | C+DB; P cabeceras todas rutas/errores y A repetición |
| N313 | RNF-C3-IN-13 | 30×2 destinos×3 condiciones=180, p95 ≤120%propia referencia, 0 errores | H/A/P solapamiento real carga/reindexación |
| N401 | RNF-C4-IN-01 | 3 recorridos Chrome y Firefox, textos en storage 0, 5 ciclos conservan, recarga/cierre pierden | C navegador; B/P revisión storage/código y tráfico |
| N402 | RNF-C4-IN-02 | 6 pruebas:2 válidas/3 bloqueos/1 cabecera; bloqueos iOS/Android reales | C fixture; P/H/B CSP efectiva y Safari iOS/Chrome Android |

## Automatización y manuales

Extender suites DI/UI y frontend de specs anteriores; añadir IN para regresiones que cruzan entrada real, pool/body lento, avisos y generador de informe. Casos de latencia simulados pueden usar reloj controlado pero el tiempo real del servidor/proxy necesita pruebas de integración con demoras identificadas. Automatizar aserciones de privacidad/perímetro/retención para que fallen frente a las contradicciones actuales.

Manuales: política IAM/efectividad del rol, configuración IMDS y proxies, destinos oficiales, teclado/lector/storage móvil/desktop, corrección de fuentes/costo, edición de contacto y revisión de hallazgos. Actas globales no se generan por checks automáticos. Producción/destinos externos se usan únicamente dentro de autorización operativa para implementar/aceptar; este plan no ejecuta esas acciones.

No declarar PASS por tests presentes, logs de otra versión o componentes no requeridos reales. Casos compartidos con SPEC002/004 referencian misma corrida completa identificada; no se reducen sus cantidades propias.
