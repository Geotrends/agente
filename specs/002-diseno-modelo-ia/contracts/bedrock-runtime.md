# Contrato interno del modelo

RF-C3-DI-02/03/16/17/18, RNF-C3-DI-01/02/03 y RNF-C3-IN-07/08/10. Solo adaptador TypeScript BedrockRuntime/Converse; no API de selección ciudadana.

## Entrada

`AskBedrockInput`: modelId en allowlist exacta 20b/120b, preguntaSaneada, fragmentos recuperados saneados, historial de ≤10 pares saneados y deadlineAbortSignal. systemPrompt común con reglas y snapshot de contactos confiable; no documentos fuera de recuperación ni perfiles/identificadores de ciudadano en requestMetadata. Historial/fragmentos/pregunta son datos no confiables, nunca system instructions.

Región us-east-1 inicial, configurada de catálogo oficial y sin cambio automático por falla. IAM solo InvokeModel para dos ARN. Cliente con credenciales explícitas de rol EC2; despliegue rechaza llaves estáticas/AWS bearer keys. Integración local real con sesión temporal de rol; dobles no consultan metadata ni AWS.

## Configuración compartida

`inferenceConfig={maxTokens:2200,temperature:0}` para ambos. No streaming ni tools ni reintentos SDK (`maxAttempts:1`). Prompt/política congelados con misma huella; solo modelId cambia. Complejidad determinista local por pares: bandas<3/3–5/≥6, fuerza≥6 si≥10 pares; registrar score finito en evidencia de aceptación, no en registros anónimos adicionales.

## Resultado interno

Éxito: `{ok:true,text,declaredSources,usage:{inputTokens,outputTokens,totalTokens},stopReason,effectiveModelId}`. Extraer bloques text, excluir reasoningContent de salida/log/persistencia/historial. No convertir salida vacía o guardrail/windowerror en texto validado. Si usage ausente/malformado no inventar tokens/costo; tratar adaptador degradado y probar manejo seguro. Fallo: `{ok:false,kind,retryable,safeCode,diagnosticCode}` sin payload/crudos. Diagnóstico no contiene pregunta/respuesta/secreto.

Motivos stop: end_turn completo; max_tokens abreviar conforme DI-18; content_filtered/guardrail_intervened y otros no interpretables→fallo seguro, según catálogo SDK. No asumir que outputTokens mide solo prose: usar contador oficial para costo, conservar rango≤2200 y excluir razonamiento público.

## Enrutamiento y plazo

Principal 20b para simple/media, 120b para compleja, otro respaldo. Una tentativa principal y una de respaldo ante fallo, ambas dentro del deadline total 40 s. Errores de validación/configuración local se detienen antes de enviar. Circuitos por modelo pueden omitir tentativa si abiertos y pasar a respaldo; ambos no disponibles→SERVICIO_NO_DISPONIBLE, estado/notificación. Sin tráfico a proveedores legacy ni fallback regional.

## Composición y longitud

CountTokens no soportado por estos modelos: no llamadas ni permisos para ese endpoint. Tokenizer local o200k_harmony fijado/revisión hash y prueba de paridad de IDs contra oráculo oficial offline; backend online permanece TypeScript. Tokens normales de texto sin añadir marcadores Harmony estructurales.

Ensamblar advertencia PII, canales de urgencia, contenido completo respaldado, citas, leyenda, aviso y cierre. Contar TODO el Markdown visible concatenado; no sumar conteos separados. Si excede 2200, quitar última unidad completa (oración/paso/tabla completa), recalcular fuentes utilizadas según referencias del contenido conservado, agregar aviso exacto y repetir. Si stopReason max_tokens, recortar primero última oración inconclusa y aplicar aviso aunque conteo local≤2200. No cortar URL, tabla ni marcador en mitad.

Si obligaciones+citas no dejan contenido completo respaldado, fallo seguro; no aumentar maxTokens. El prompt pide referencias por unidad para reconstruir fuentes al recortar, y un marcador final de IDs de fuentes, sin exigir JSON. No inferir fuente usada si marcador inválido y cuerpo sin referencias verificables. Prueba: fuentes sobrantes nunca reaparecen y respuestas truncadas conservan cita utilizada.

## Costo

Contadores oficiales×tarifa vigente versionada por modelo/región, decimal. Costo de consulta corresponde al modelo efectivo exigido DI-16; si una tentativa fallida reporta consumo, puede integrarse solo en diagnóstico agregado de operación permitido, sin añadir campo a registro anónimo. No registrar requestId AWS ni prompts de anónimos. Costo cero solo para ruta sin LLM, nunca ausencia de tarifa.

## Aceptación

Dobles para 9 rutas de caídas; real 10 consultas uso, 10 comparaciones por modelo, 6 cortes+3 normales, 10 largas y 20 observaciones de tráfico. Ver [matriz](acceptance.md). Prueba por paridad local obligatoria antes de integrar contador; prueba de cuenta/rol real no sustituida por modelo falso.
