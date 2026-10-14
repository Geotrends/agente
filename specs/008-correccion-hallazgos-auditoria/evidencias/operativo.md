# Acciones operativas fuera del código (T066)

1. **Rotar las llaves** de Gemini, Groq, DeepSeek y OpenAI que existen en el `.env` local: se consideran
   expuestas (se leyeron nombres y longitudes durante la auditoría, no valores, pero el archivo las
   contiene). Después, **eliminar** esas variables del `.env`.
2. Añadir `ADMIN_IP_HMAC_SECRET` al `.env` (≥ 32 caracteres, distinto de `AUTH_JWT_SECRET`;
   `openssl rand -base64 48`). Sin él, `make up` falla en `check-env` y el backend de producción no arranca.
3. Verificar fuera del repositorio: WAF/cuotas de borde, presupuesto y alarmas de Bedrock, y que el rol
   IAM de la instancia tenga solo los dos modelos permitidos.
4. Puerta verificable (FR-016, principio V): `make check-env` sin errores sobre el `.env` de despliegue.
5. Operación: el detalle de `/ready` y `/api/retrieval/status` ya no sale por el proxy público. Para
   diagnosticar: `docker compose exec backend wget -qO- http://127.0.0.1:4000/ready`.
