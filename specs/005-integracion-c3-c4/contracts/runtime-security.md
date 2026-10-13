# Contrato de perímetro, identidad y finalización

RNF-C3-IN-04/05/06/07/08/09/10/11/12 y RNF-C4-IN-02; RF-C3-IN-04. Diseño objetivo sobre módulos existentes.

## Orden y decisiones HTTP

1. En entrada ciudadana instalar contexto temporal y `Cache-Control: no-store` antes de efectos.
2. Verificar Origin explícito en POST `/api/chat`, `/api/conversations`, `/api/ratings` y sus OPTIONS, antes de CORS general. Lista productiva solo origen HTTPS exacto del ChatBot; `null`, ausencia, dominio ajeno, subdominio no listado, http, ruta, consulta, fragmento y puerto añadido se rechazan 403. Ningún token elude guard.
3. OPTIONS permitido devuelve 204 con métodos/headers estrictos (`POST`, `Content-Type`, `Authorization`); no cuenta como consulta. Origen ajeno no obtiene CORS permisivo. Si hay consumo cruzado exponer Retry-After; no permitir headers arbitrarios. Validar Access-Control-Request-Method y Access-Control-Request-Headers; un método o encabezado ajeno no recibe 204 favorable.
4. Resolver IP únicamente desde cadena de proxies validada. Rechazo 429 con Retry-After entero positivo si ventana deslizante de 60 s ya tiene 60 consultas admitidas de esa IP. Otra IP tiene ventana independiente. Preparación/valoración/configuración usan controles propios, no la cuota de consultas.
5. JSON lectura acotada a 131072 bytes por longitud o stream, sin límite independiente de caracteres.131072 válido; 131073/5 MB rechaza 413 sin LLM/interacción y sin acumulación completa. Abort/deadline libera listeners/buffers/conexiones.
6. Sesión técnica y validación; después admisión y caso de uso. No crear registro exitoso por un rechazo; eventos técnicos de disponibilidad no contienen texto ni identidad ciudadana.

GET `/api/chat/config` del mismo origen puede carecer de Origin; es lectura sin modelo. No convertir esta excepción de transporte a excepción del POST de consulta. Entornos localhost aislados no amplían lista productiva. Proxies públicos deben borrar/sobrescribir encabezados de IP del cliente y backend no publica puerto directo; tests cubren rutas alternativas de llegada.

## Identidad Bedrock

Runtime EC2 obtiene credenciales del proveedor de instancia explícito, no cadena automática. IMDSv2 obligatorio y acceso de contenedor/hop limit verificados. No llaves, perfiles, SSO, procesos externos, bearer API keys ni endpoints de metadatos arbitrarios. Revisión de imagen/mounts/variables/repositorio informa rutas y conteos sin imprimir secretos.

Con Converse no streaming, política de identidad exclusiva permite **una acción** `bedrock:InvokeModel` sobre solo:

- `arn:aws:bedrock:us-east-1::foundation-model/openai.gpt-oss-20b-1:0`
- `arn:aws:bedrock:us-east-1::foundation-model/openai.gpt-oss-120b-1:0`

Región actual configurada en SPEC002; sin wildcard ni acción streaming. Revisar todas las políticas efectivas y no introducir Allow amplio. No se necesita Deny con Resource* para negar acciones no permitidas: identidad sin otras concesiones usa denegación implícita. Validar terceros/listado/bucket/claves ajenas, además de los dos éxitos. Retirar rol produce 503/aviso sin fallback; no modificar rol productivo durante planificación.

RNF-C3-IN-09 se registra descartado por fuente: cero tareas de rotación de llaves.

## Plazos y escritura

Reloj monotónico desde headers recibidos en backend antes de body/auth; fecha UTC asociada. Nginx debe transmitir cuerpo sin buffering previo (`proxy_request_buffering off`, HTTP1.1), respetando 128 KiB, para que una transmisión lenta llegue al guard temporal. Probar inicio de reloj con tráfico lento a través de entrada pública. Proxy read timeout conserva margen del servidor; no usarlo como prueba del plazo integral.

Objetivo operativo 39000 ms, terminal≤40000 ms: cola, búsqueda, modelos, adquisición/lectura/escritura de BD y contactos de error con presupuesto restante. Asegurar cleanup y cancelación real, no solo carrera de promesas. Reserve finalización antes de invocar siguiente etapa. Un único terminal; ninguna respuesta tardía modifica el panel ni se emite UUID sin commit confirmado. Cancelar/observar trabajo servidor y rollback cuando proceda; un commit ya enviado puede confirmarse aunque el cliente cancele, y un estado indeterminado no demuestra ausencia de fila. Si orientación ya existe y la escritura falla a tiempo, se entrega sin responseId. Medir body completo desde cliente para aceptación de latencia.

## Caché, logs y ataques

No-store en éxitos, validación, 401/403/413/429/500/503, valoraciones y errores propios nginx 502/503/504/413. Repetir `add_header ... always` en ubicaciones efectivas que tengan headers propios; comprobar configuración renderizada y respuesta externa. No interceptar JSON del backend innecesariamente.

Logging por allowlist de códigos/estado/fecha/modo seguro; no objetos SDK, tokens, encabezados, configuración completa, texto ni mensajes de excepción arbitrarios. Ocho escenarios de confidencialidad incluyen reinicio y paquete frontend. Nueve inyecciones conservan reglas de orientación y leyenda con ambos modelos reales en evidencia requerida; pruebas controladas verifican defensas, no sustituyen generación real.

CSP frame-ancestors permite solo `https://observatorioenvigado.geotrends.co`, diferente del Origin del iframe que invoca API. Conservar protocolo host sin texto ciudadano. Dos incrustaciones válidas, tres bloqueos y cabecera; repetir bloqueos Safari iOS/Chrome Android reales. Ninguna fixture se habilita en producción para pasar pruebas.
