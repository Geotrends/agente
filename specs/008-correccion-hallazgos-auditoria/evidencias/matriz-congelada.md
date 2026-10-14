# Matriz congelada tras el cambio de prompt (T067, constitución IX)

**Estado: pendiente — bloqueado por entorno.** T060 modificó el armado del contexto del prompt
(`neutralizePromptDelimiters` en `backend/src/chat/sources.ts`): inserta un carácter de ancho cero en
líneas que empiezan por `---`/`===` y en los marcadores `<!--`/`-->` dentro de fragmentos. La
constitución exige reejecutar la matriz de pruebas congelada completa en cada modelo habilitado
(gpt-oss-20b y gpt-oss-120b), lo que requiere Bedrock real (rol IAM de la instancia).

No ejecutado aquí: sin credenciales ni red hacia Bedrock. Pasos para cerrarlo:

1. En el entorno con el rol de la instancia: ejecutar el procedimiento de SPEC006 (`backend/test/validation-*.test.ts`
   y la matriz congelada) en los dos modelos.
2. Registrar el resultado de la última ejecución completa aquí.
3. Si algún caso cambia, clasificarlo (Datos / Recuperación / Modelo) antes de corregir.

Verificación offline realizada: las suites unitarias del prompt y de recuperación pasan (ver `regresion.md`).
