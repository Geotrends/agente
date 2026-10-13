# US2 · evidencia local (T039)

**Fecha**: 2026-10-08 · **adapter=double**. Los detectores locales son reglas deterministas; las tasas semánticas con modelo real quedan pendientes de revisión.

| Criterio | Prueba | Resultado |
|---|---|---|
| DI-01 · 5 análisis / 5 trámites | `test/di-answer-limits.test.ts` | los 5 análisis se rechazan **antes** de recuperar o llamar al modelo, con contacto general; los 5 trámites siguen normal |
| DI-20 · 4 ajenas / 4 propias | idem | 4 ajenas (2 por regla local y 2 por marcador del modelo) dan las tres direcciones + contacto general sin contestar la materia |
| DI-21 · 4 insuficientes / 4 completas | idem | 4/4 insuficientes aclaradas (≥3 exigido), 0 completas aclaradas; segunda insuficiente → texto de ausencia y se limpia el estado; anónima pide pregunta completa y no persiste nada |
| DI-19 · 5 en curso / 5 informativas | `test/di-risk-channels.test.ts` | 5/5 en curso (≥4), 0/5 informativas (≤1); canales con nombre, valor y orden del registro, antes de la orientación |
| AD-35/36/37 · panel de contactos | `test/di-integracion/admin-contacts.test.ts` | recepción 3 válidas / 5 inválidas; general 4 / 3; inmediatos: altas, edición, reorden y bajas válidas y 4 altas inválidas (descripción de 121 caracteres, tipo inexistente, correo mal formado, nombre vacío); CAS 409 sin perder la otra edición; último canal protegido; Gestor y sin sesión 401/403 sin datos; mutación + auditoría atómicas |
| DI-24 · edición → siguiente respuesta | `us1.test.ts` | sin redespliegue ni caché |

## Pendiente

- **T038 (jsdom)**: `frontend/test/di-flows.test.mts` renderiza el panel real y comprueba 5 aperturas (anchos 1440/1280/1024 y 390/360), 6 recorridos de urgencia con los canales visibles ANTES de decidir (valores exactos y orden del registro) y que solo se pidió la configuración: ni sesión, ni conversación, ni modelo. La API los entrega en ≤2 s (`chat-perimeter.test.ts`). **No se ejecutó en un navegador real** (T096).
- Accesibilidad de las pantallas del panel (teclado, foco, lector WCAG 2.1 A/AA): construidas con etiquetas, errores asociados y foco visible, **sin verificación manual todavía** (T096).
