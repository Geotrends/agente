# Contrato de valoración — RF-C4-UI-06 / IN-05 y RF-C3-IN-09

Endpoint objetivo nuevo de004: `POST /api/ratings`, JSON UTF-8, Bearer técnico vigente y `Cache-Control: no-store` en éxito/error. No llama al LLM. Mismo perímetro de origen/proxy/límites/cuerpo128 KiB de002; aplicar por ruta exacta antes de parser general, no dejar ratings fuera del perímetro por patrón CHAT_PATH legado.

```json
{"responseId":"UUID auténtico de C3","valoracion":"No útil","motivo":"Información incorrecta"}
```

- responseId UUID backend válido de interacción autorizada vigente perteneciente al portador. No aceptar IDs cliente, anónimos, ajenos o depurados.
- valoracion exactamente «Útil» o «No útil». Útil exige motivo OMITIDO (null también inválido); No útil exige uno de los cinco textos aprobados del spec.
- Rechazar propiedades desconocidas/texto adicional como VALIDACION y cero escrituras; nunca guardarlos. No campos de texto libre.
- UI presenta controles solo si decisión autorizo y responseId existe, respuesta exitosa actual. Sin ID, texto normal y cero controles ocultos enfocables.

## Respuestas

201 exclusivamente tras commit: `{"responseId":"UUID auténtico de C3","registrada":true}`. Esto permite «Gracias por su valoración» y deshabilitar controles. No devolver IDs internos.

400 `{"error":{"codigo":"VALIDACION","mensaje":"No se pudo registrar la valoración."}}`: inexistente/ajena/depurada, segunda valoración, motivo ausente/indebido/fuera de lista o cuerpo no válido; mensaje uniforme. Token ausente/inválido:401 NO_AUTORIZADO. Origen no permitido/429/cuerpo excesivo siguen catálogo002. BD caída→503 SERVICIO_NO_DISPONIBLE, imprevisto→500 ERROR_INTERNO. Sin detalles técnicos; UI comunica fallo de valoración accesiblemente sin reenviar consulta ni mostrar «Gracias».

## Atomicidad y recuperación

Transacción con resolución autenticada y restricción UNIQUE por fila interna de interacción. Concurrencia de dos envíos produce exactamente una escritura/201; otro VALIDACION. Ni ocultar panel ni doble clic permite segunda valoración.

Pérdida de acuse puede ocurrir después del commit. Reintento no crea otra fila; duplicado sigue siendo VALIDACION, no éxito idempotente (IN-09 exige rechazo). UI no infiere éxito del rechazo y no permite cambiar valoración para evadir unicidad. El texto de respuesta original permanece visible. Ningún endpoint extra de historial/lectura ciudadano se incorpora para resolver este caso.

Nueva conversación cancela solicitud cliente y descarta su resultado por epoch; una escritura ya confirmada en servidor conserva asociación a interacción original, nunca a nueva conversación.

## Verificación

B09: doce envíos del PDF, siete válidos (útiles y los cinco motivos) y cinco inválidos (ID inexistente, duplicado, motivo ausente, presente con Útil, fuera de lista), cero filas inválidas. Añadir cuerpo con texto libre, ID ajeno/depurado/anónimo, sesiones inválidas, dos envíos concurrentes, permisos directos, pérdida de acuse y purga12 meses. U06/I05 verifican UI/consentimiento/lector además de BD real.
