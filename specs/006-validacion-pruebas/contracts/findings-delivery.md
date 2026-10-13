# Contrato de hallazgos y entrega de hitos

RF-C3-VA-04/05 y RF-C4-PR-03/04; relaciones en [data-model](../data-model.md) y reglas de resultados en [execution](execution.md).

## Registro de hallazgos

Cada caso no aprobado de la última corrida por modelo/entorno tiene vínculo a hallazgo con identificador, caso/matriz/run, modelo o entorno, descripción, prioridad, tipo REAL, responsable, fecha objetivo y estado. Se reutiliza un hallazgo previo únicamente si conserva todos esos vínculos y causa; no fusionar fallos de ambos modelos borrando su evaluación independiente. Pendientes de revisión/evidencia se registran como impedimento de verificación; no inventar error factual o causa de modelo para rellenar campo. No se declara registro completo hasta clasificar causa y severidad.

Severidad fuente, tomar mayor si concurren reglas:

| Prioridad | C3, VA-04 | C4, PR-03 |
| --- | --- | --- |
| Crítica | Dato clave erróneo (plazo/requisito/norma/canal), invención sin respaldo o dato personal expuesto. | Afirma radicación/decisión, canal de emergencia incorrecto/ausente, guarda/envía conversación con No autorizo, bloqueo sin salida. |
| Alta | Dato clave incompleto o cita con documento/fecha erróneos. | Flujo secundario categoría/valoración/nueva conversación falla; error técnico visible; fallo en un solo entorno. |
| Media | Tipo de resultado incorrecto. | Texto fijo distinto al configurado o control mal ubicado sin impedir uso. |
| Baja | Solo redacción/formato. | Solo estética. |

REAL: Datos/Recuperación/Modelo con causa razonada y componente técnico descrito para interfaz; no crear un cuarto tipo. Revisor comprueba Críticos/Altos individualmente antes de aceptar. Todo cambio conserva requisito origen, propietario de001–005 y VA/PR que lo detectó.

Eventos registran autor/fecha, estado anterior/nuevo, explicación, referencias al ajuste y evidencia. `Ajustada` no habilita firma ni se convierte automáticamente en `Cerrada`. Validada/Cerrada enlazan corrida completa posterior al ajuste que comprobó el caso; C3 incluye evaluación completa de modelos pertinentes, y C4 matriz completa de los entornos definidos. Si reaparece fallo se reabre; nunca borrar historia. Cierre de hito exige todos los Críticos en Cerrada.

## Paquete H5-C3

Informe con cuatro elementos VA-05: matriz congelada, últimas corridas completas de cada modelo habilitado, hallazgos y ajustes. Además enlaza corrida integrada de VA-02 y manipulación/retiro VA-06. Resumen por modelo con N, aprobados/fallos/pendientes, ceil90 %, grupos100 %, comprobación modelo efectivo y cero Críticos abiertos. Copias/refs de matriz/resultados/revisiones con hashes comprobados, identidad release y requisito por puerta.

Acta declara recepción conforme a requisitos levantados y funcionamiento esperado, versión de matriz y modelos validados, adjunta informe concreto; firmas y fechas de supervisión y Geotrends posteriores a últimas corridas completas. No usar un informe DI de H2 como acta H5.

## Paquete H4-C4

Informe con seis elementos PR-04: matriz funcional congelada, última corrida completa, hallazgos, ajustes, resultado accesibilidad y resultado carga. Matriz/run/carga/accesibilidad corresponden a misma versión de ChatBot y combinación C3/config pertinente identificada. Demuestra PR-02/03 y cero Críticos abiertos, UI-02/IN-03 aprobados según contrato execution.

Acta declara recepción conforme y funcionamiento esperado, cita versiones de matriz y ChatBot, adjunta informe, ambas firmas/fechas posteriores a última ejecución completa. Accesibilidad/carga pendientes o de otra versión impiden ready-for-signature. Hitos tienen paquetes y veredictos separados.

## Comprobación de integridad y recepción

`validation:report` lee inputs y verifica contenido/hashes/cobertura/vigencia/hallazgos/revisiones/compartidos. Un informe puede generarse como draft aun con pendientes, enumerándolos; estado técnico nunca se convierte en firmado. Si hay incumplimiento previo DI/UI/IN documentado en un requisito levantado, se conserva puerta no conforme aunque el porcentaje global VA/PR alcance90 %. No se exige 100 % global distinto de fuente, pero tampoco se declara cumplimiento inexistente.

`ready-for-signature` requiere todo el expediente verificable. Exportar informe y borrador de acta sin firmas simuladas. Supervisión/Geotrends revisan y firman por su canal establecido fuera de ejecución del arnés. Persona autorizada registra recibo de archivo original firmado, hash, informe/matriz/versiones, ambas identidades y fechas, y evidencia de verificación real. La herramienta puede validar campos y coincidencia, no afirmar autenticidad de firma basada solo en OCR/nombre/hash.

Originales firmados en ubicación privada autorizada; si se guarda referencia externa, debe ser comprobable por revisor, no afirmar validado por enlace inaccesible. No publicar ni enviar actas automáticamente. Cambios posteriores producen expediente nuevo/pendiente para nueva release, conservando histórico firmado anterior.

## CLI propuesto

Desde backend, todavía no implementado:

```sh
npm run validation:report -- --milestone=H5-C3 --package=<insumos-c3.json> --output=<expediente-c3> --require-ready
npm run validation:report -- --milestone=H4-C4 --package=<insumos-c4.json> --output=<expediente-c4> --require-ready
npm run validation:acta -- --package=<expediente.json> --receipt=<recibo-original-firmado.json> --output=<validacion-acta.json>
```

Sin `--require-ready` report genera draft y exit0 si la generación es correcta, indicando pendientes; no acredita cierre. Con require-ready: exit0 solo puertas completas para firma, exit1 pendiente/no conforme; acta exit0 solo recibo verificado y coherente que permite signed, no firma automáticamente. Exit2 argumentos/esquema/lectura/config inválidos. Rechazar firmas anteriores a última corrida, matriz o informe distinto, una parte ausente, retiro pendiente, revisión semántica ausente, runs controlados sustituyendo real, hash alterado o verificación compartida insuficiente.

## Evidencia mínima de prueba del contrato

Pruebas negativas: hallazgo Crítico Ajustada, prioridad Alta mal clasificada, dato clave erróneo Media, cierre sin corrida posterior/completa, fallo de un modelo oculto en promedio, C4 móvil faltante, acta anticipada/una firma, informe que referencia otro hash/release y archivo de suite existente sin resultado. Positivos sintéticos verifican gates pero siempre se etiquetan test/double; jamás crean recepción o firmas oficiales.
