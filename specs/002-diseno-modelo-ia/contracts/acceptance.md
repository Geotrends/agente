# Contrato de validación y matriz de aceptación

RF-C3-VA-01/03/05, constitución IX/X y los 28 RF/RNF de DI. Ningún resultado inicial de código equivale a aceptación; esta matriz prescribe ejecuciones futuras. Prioridad original y número/tasa de casos se conservan.

## Manifiesto de cada ejecución

Guardar en `evidencias/aceptacion/<run>/` versión Git y hash de cambios locales/imagen, prompt/configuración, corpus/alias/colección, embedding/reranker/tokenizador revisión hash, contactosrevision, tarifasversiones, región/modelos, matriz hash/fecha y responsable funcional. Por caso: id, RF/RNF, fixtures sintéticos, esperado/observado, pass/fail, modo/modelo solicitado solo por runner offline y modelo efectivo, evidencia. FalloREAL antes de ajuste, prioridad contractual y repetición completa posterior. El último informe completo manda, no un subconjuntoverde anterior.

Datos de prueba personales son sintéticos; capturas no sehabilitan en producción ni recolectan ciudadanos reales. Evidencia de tráfico solo destino/servicio/modelos permitidos, sin credenciales. Sondeos con secretos jamás impresos. Revisiónmanual firma español/tono/estructura/citas/calidad; controles automáticos no sustituyen decisiones del revisor.

## Cobertura obligatoria

| Requisito | Criterio contractual | Evidencia requerida |
| --- | --- | --- |
| RF-C3-DI-01 | 10 preguntas: 5 de análisis rechazadas sin cálculo y con canal oficial; 5 de trámites normales. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-02 | 12 preguntas preclasificadas: 3 por nivel y 3 simples con ≥10 intercambios; nivel correcto, repetición con mismo puntaje y cero llamadas al puntuar. | Automática con evidencia real del componente requerido |
| RF-C3-DI-03 | 9 pruebas: principal, respaldo y doble caída por cada nivel; modelo esperado y doble fallo registrado/visible. | Automática con evidencia real del componente requerido |
| RF-C3-DI-04 | 10 preguntas: 5 ausentes con texto exacto, sin citas ni datos adicionales; 5 presentes con respuesta documental. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-05 | Barrido documentado, mayor valor válido y cero preguntas respondibles con mensaje de ausencia; no sustituir por conservar solo recall relativo. | Barrido real del oro/corpus vigente y auditoría del informe |
| RF-C3-DI-06 | 3 consultas con reranker apagado: continuidad, mejores RRF, panel degradado sin umbral y recuperación normal al reactivarlo. | Automática con evidencia real del componente requerido |
| RF-C3-DI-07 | 10 respuestas: enlaces que abren y fechas coincidentes con matriz/ficha. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-08 | 10 respuestas, 3 con fuente sobrante simulada: ninguno sobrante en cita final; solo documentos usados. | Automática con evidencia real del componente requerido |
| RF-C3-DI-09 | 15 preguntas: 10 de decisión cumplen los tres elementos y 5 informativas sin atribuirse decisiones. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-10 | Revisor evalúa 10 respuestas por esos 6 puntos; ≥9 cumplen los seis. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-11 | 5 conflictos preparados: 5 siguen y citan el procedimiento. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-12 | 5 consultas con evidencia de aporte de ambos métodos, candidatos ≤16, fragmentos ≤8 y orden por relevancia. | Automática con evidencia real del componente requerido |
| RF-C3-DI-13 | Muestra de ≥5 documentos, ≥2 con tablas: límites, palabras intactas, solapamiento con tolerancia de una palabra y tablas completas. | Automática con evidencia real del componente requerido |
| RF-C3-DI-14 | 3 situaciones: varias fuentes útiles, única fuente útil y casi duplicados; diversidad, hasta 8 de única fuente, duplicado eliminado y todos sobre umbral. | Automática con evidencia real del componente requerido |
| RF-C3-DI-15 | 10 pruebas: 5 seguimientos ampliados correctamente y 5 autónomas sin ampliación. | Automática con evidencia real del componente requerido |
| RF-C3-DI-16 | 10 consultas, 5 por modelo y ≥1 del respaldo: registros completos y costo coincidente con recálculo manual. | Automática con evidencia real del componente requerido |
| RF-C3-DI-17 | Revisar instrucciones y 10 preguntas a cada modelo, ≥3 por dirección: coinciden requisitos, plazos, normas y canal. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-18 | 6 cortes forzados, 3 por modelo: cumplen los tres elementos; 3 normales sin aviso. | Automática con evidencia real del componente requerido |
| RF-C3-DI-19 | 5 consultas en curso y 5 informativas: ≥4 de primeras con canales antes de orientación; ≤1 informativa con canales; valores exactos del registro. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-20 | 8 consultas: 4 ajenas cumplen los tres elementos y 4 propias normales. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-21 | 8 consultas: ≥3 de 4 insuficientes aclaradas y 4 completas sin aclaración; insuficiencia persistente termina con DI-04. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-22 | 8 consultas: 4 ofensivas, 2 con pregunta válida, y 4 equivalentes neutras; sin agresión/reproches, orientación equivalente válida y conversación continua. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-23 | 8 consultas: 4 con cédula/dirección/teléfono/correo/nombre de tercero y 4 equivalentes sin datos; solo primeras con aviso y sin reproducción, orientación equivalente; adicional, aviso en los 3 turnos con datos. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-24 | 8 consultas de las tres direcciones con los tres valores; actualización en panel visible en siguiente respuesta sin redespliegue. | Automática de contrato + aceptación real y revisión funcional |
| RF-C3-DI-25 | 9 respuestas: 3 por estructura, ≥8 correctas por revisor funcional; ninguna informativa con pasos artificiales o tablas de una sola fila. | Automática de contrato + aceptación real y revisión funcional |
| RNF-C3-DI-01 | 15 consultas, 5 por tipo de dato, y conversación >10 intercambios: inspección real de salida sin datos completos, únicamente pregunta/fragmentos/historial y solo los 10 intercambios recientes. | Inspección del payload enviado + prueba real sintética sin datos ciudadanos |
| RNF-C3-DI-02 | Configuración y tráfico de 20 consultas: solo ambos modelos habilitados y 0 conexiones a otros proveedores. | Configuración, captura de destinos y llamadas reales en AWS |
| RNF-C3-DI-03 | 10 respuestas largas, 5 por modelo: ninguna >2.200 tokens según registro de longitud. | Automática con evidencia real del componente requerido |

## Dependencias y regresiones

- IN-01/02/03: UUID backend, rechazo de identificador ajeno/desconocido; 12 solicitudes deIN-02, 8 válidas/4 inválidas, historial 15→10 pares sin LLM en inválidas; tipos/fuentes/IDs consistentes.
- IN-05/06/07/08: filas autorizadas únicas, etiquetas exactas y conservación de normas; 6 anónimas solo campos permitidos, cero texto/hash/ID en toda BD/log; 6 escrituras fallidas+2 recuperadas, 1 aviso por episodio y omitirse responseId. Retención 11 meses 29 d conserva, 12 meses 1 d depura y dos ejecuciones automáticas registradas.
- IN-04:9 casos contractuales de validación/disponibilidad/tiempo/interno; plazo 40 s incluye cola y escritura; no detalles internos en ningún error.
- AD-35/36/37/48:8 intentos recepción, 7 general, 10 acciones inmediatas; 5 estados forzados visibles<60 s, normalidad/Gestor denegado. AD-28/29/30:8 avisosdetipos distintos, contador en 3 pantallas, revisión conserva actor/fecha y agrupación.
- RNF-AD-01..07 y AD-08/09/10/41: auth y roles enUI/API, sal única/hash, password 12, bloqueo 5/15 y 20/15 porIP, sesión 30 min, cambio obligatorio y última cuenta administrador a; auditoría append-only. Rechazos bajo concurrencia con DB real, no solo interfaz.
- RNF-IN-04/05/06/11: origenallowlist, 60/min/IPventanadeslizante, 128 KiBcuerpo sin límite de caracteresextra; ataques 9 casos (3 pregunta/3 historial/3 fragmento). HTMLsaneado, links https y texto ciudadano plain, sin autorizar inyección a través de marcadores/citas.
- RNF-IN-02/03:100 consultas secuenciales (40 simples/30 medias/30 complejas, 10 con historial 10 y 10 largas) en 2 días, p95≤20 s y ningún silencio>40 s. 3 oleadas 25 simultáneas separadas 2 min en 2 días, éxito/p95 y registros correctos; registros anónimos sin datos prohibidos. Es aceptación de integración, no nueva condición arbitraria deDI.
- Accesibilidad: teclado, foco, etiquetas, contraste y lector en pantallas tocadas; links abren nueva pestaña sin borrar consulta. Identidadinstitucional registrada, sin crecimiento de cargaObservatorio hasta apertura.

## Interfaces del runner a implementar

`npm run test:di-integration`: integración local contratos/persistencia/permisos/fallos, AWS doble sin tráfico. `npm run eval:di -- --manifest=<ruta> --models=both --output=<ruta>`: matriz real con IAM temporal, forzado de modelo solo offline y privado, noendpoint público. `npm run eval:tokenizer`: paridadIDs/corpus offline, sin inferencias. `npm run eval:di-traffic`:20 consultas conregistrodedestinos no autorizados=0. `npm run eval:di-load`:modo sequential/waves según contrato y salidadelospercentiles.

Estos scripts son entregables de implementación, hoy no existen: no presentar sus comandos como verificaciones ya ejecutadas. Toda prueba simulada etiqueta adapter=double y no cuenta como aceptación de AWS. Tests manuales figuran en informe con suficiente evidencia y firma. Scripts de calibración existentes se extienden, no duplican pipelines Python online.

## Puertas de cierre

1. Tipos/unitarias/integraciónDB-Qdrant/contratos, auditoría sin altas e imágenes backend/frontend nativas pasan CI; ninguna prueba desactivada para integrar.
2. Tokenizer con paridad; prompt/params iguales; corpus y calibración vigentes; contactos/tarifas oficiales cargados y autenticación de panel operativa.
3. Todos 28 criterios+dependencias directas satisfechos, revisionesfuncionalesmanuales y tráfico real; ninguna dependencia solo simulada.
4. Documento de diseño e informe final trazables conhallazgosREAL resueltos/reprueba. No afirmar aceptaciónH5-C3 global en esta faseH2-C3.

Pruebas complementarias exactas: IN-10 tres llamadas al bloque completo de contactos en≤2 s, edición visible y 0 LLM; C4-DC-02 cinco consultas anónimas incluyendo dos seguimientos sin historial/texto/estado arrastrado. RNF-AD-06:19 fallos de IP+1 éxito+5 fallos no bloquean; pausar polling para RNF-AD-05 a 29/31 min.
