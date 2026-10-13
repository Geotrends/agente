# Configuración IAM del servicio (T055)

Fecha: 2026-10-10. **Documento de configuración y verificación: no aplica cambios en AWS.** La política efectiva, el rol exclusivo, IMDSv2/hop limit y las denegaciones REALES se comprueban en T074/T075 con acceso operativo autorizado.

## Contrato

| Elemento | Valor |
| --- | --- |
| Identidad del runtime | rol de la instancia EC2 mediante `fromInstanceMetadata` (IMDSv2 obligatorio, sin IMDSv1) |
| Acción permitida | `bedrock:InvokeModel` (única; Converse sin streaming) |
| Recursos permitidos | `arn:aws:bedrock:us-east-1::foundation-model/openai.gpt-oss-20b-1:0` y `…/openai.gpt-oss-120b-1:0` |
| Prohibido | comodines, `InvokeModelWithResponseStream`, perfiles de inferencia/regionales, `ListFoundationModels`, S3, IAM, llaves de acceso estáticas, `AWS_BEARER_TOKEN_BEDROCK`, perfiles/SSO/procesos/web identity/contenedor |
| Región | `us-east-1` (`BEDROCK_REGION`, sin respaldo regional) |

Política versionada: [`backend/config/iam-bedrock-policy.json`](../../../../backend/config/iam-bedrock-policy.json).

## Verificación automática (documento)

```bash
npm --prefix backend run check:iam -- backend/config/iam-bedrock-policy.json   # una acción, dos ARN, 2 éxitos, 5 denegaciones
npm --prefix backend run test:in-integration                                    # incluye iam-policy.test.ts, instance-role.test.ts
```

Para el rol real, exportar **todas** las políticas inline y adjuntas (incluidos límites de permisos) a archivos JSON y pasarlas todas al verificador: la unión no puede permitir más que el contrato.

## Lista de revisión manual (T074/T075, entorno autorizado)

1. `aws iam list-attached-role-policies` y `list-role-policies`: solo la política del contrato; sin `AdministratorAccess`, `AmazonBedrockFullAccess` ni comodines.
2. `aws ec2 describe-instances --query ...MetadataOptions`: `HttpTokens=required` (IMDSv2) y `HttpPutResponseHopLimit=2` para que el contenedor alcance IMDS.
3. Sin `~/.aws`, variables de llaves ni perfiles montados en los contenedores; `/ready` en 200 (la readiness rechaza cualquiera de ellas).
4. Dos invocaciones exitosas (20b y 120b) desde el servicio y cuatro denegaciones reales (tercer modelo, listado, bucket, gestión de llaves).
5. Retiro temporal del rol **solo con autorización operativa**: la consulta responde 503 con aviso seguro; restaurar y comprobar recuperación.

## Lo que este documento no demuestra

Que el rol real esté configurado así, que IMDSv2/hop limit sean los indicados, ni las denegaciones reales. Hasta T075 el criterio de N307/N308 queda **pendiente**.
