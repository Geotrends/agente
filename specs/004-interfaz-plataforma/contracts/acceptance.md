# Matriz de aceptación — SPEC004

Contrato congelable antes de implementación. Cada caso conserva cantidades/umbrales originales; casos adicionales protegen integración, no sustituyen los originales. Automatizado no acredita revisión manual ni servicios simulados acreditan producción.

## Cobertura 12 UI / 8 dependencias C4 / 2 servicios

| Caso | Requisito | Recorrido y resultado exigido | Evidencia |
| --- | --- | --- | --- |
| U01 | RF-C4-UI-01 | Cinco entornos: Chrome/Firefox/Edge escritorio, Chrome Android, Safari iOS; botón visible sin scroll/no sobre mapa, apertura DC-01, dos consultas y cinco ciclos con conversación completa/ordenada. | Capturas/vídeo portal, versiones/OS, requests sin recarga iframe, comparación transcripción |
| U02 | RF-C4-UI-02 | Anchos320/375/767/768/1366: fullscreen bajo768, cierre visible; desde768 ancho400/altura min640,85 %; cero scroll horizontal panel. Campo visible con teclado real Android/iOS. | Dimensiones/capturas y grabación móvil/orientación |
| U03 | RF-C4-UI-03 | Nueve respuestas3 pasos/3 tablas/3 prosa, sin símbolos Markdown; ol/ul/table/th scope col; lector anuncia listas/columnas; a320 tabla scroll propio. | DOM/screenshot y lector manual |
| U04 | RF-C4-UI-04 | Diez respuestas con cita+aviso datos, desktop/móvil ratón/toque/teclado;100 % links pestaña nueva, indicador/nombre exactos, target/rel; mapa/conversación intactos. | DOM/ventanas y comparación estado mapa |
| U05 | RF-C4-UI-05 | Seis recorridos con dos consultas:2 autorizados/reinicio,2 anónimos/reinicio,2 cancelar. Diálogo literal, flujo DC01→02→03, primera sin historial; cancelar idéntica y teclado. | Tráfico sintético/DOM/foco antes/después |
| U06 | RF-C4-UI-06 | Diez autorizadas:5 útiles/5 no útiles uno por motivo; asociado a ID, un solo registro, gracias/deshabilitados, teclado/lector;3 anónimas sin controles/registros. | BD real de prueba+UI manual |
| U07 | RF-C4-UI-07 | Cinco consultas delay5 s+una falla; indicador literal≤500 ms, campo/envío bloqueados, sin requests adicionales ni cambio foco; desaparece y habilita en seis. | Cronología/foco/tráfico |
| U08 | RF-C4-UI-08 | Seis fallas2 indisponibilidad/2 plazo/2 red; literal+3 canales del snapshot sin llamadas extra; original en reintento, tras2 fallos oculto, recuperación muestra respuesta, fallo sin valoración. | Tráfico/payload sintético/DOM |
| N01 | RNF-C4-UI-01 | Tres cargas caché vacía: solo script≤10 KB antes del clic, luegoiframe/assets, clics siguientes sin recarga. Medir conservador≤10.000 bytes sin comprimir. | HAR filtrado sin contenido ciudadano+medida artefacto |
| N02 | RNF-C4-UI-02 | Axe por todos estados cero incumplimientos A/AA; lista manual100 %; teclado, lector escritorio+móvil, zoom200 %, texto≥4,5:1/control/grande≥3:1. | Reportes axe y revisión humana firmada |
| N03 | RNF-C4-UI-03 | Diez cargas maliciosas C3+3 consultas HTML/Markdown; cero ejecución/tags/attrs prohibidos, URLs solohttps, texto ciudadano plano; normales conservan formato. | DOM/tráfico y nueve respuestas normales U03 |
| N04 | RNF-C4-UI-04 |100 % colores/fuentes en guía y coincidentes con CSS oficial;10 elementos estilos computados, logo juntoGeobot, ningún contraste inválido. | Guía/hash CSS/logo, computed styles, ratios |
| I01 | RF-C4-IN-01 | Seis recorridos:una solicitud y mismo ID trasAutorizo,0 emisión anónima, ID distinto reinicio/recarga,0 IDs en storage. | Requests y storage inspeccionados |
| I02 | RF-C4-IN-02 | Tres recorridos:12 autorizadas,12.ª exactamente10 pares; ninguna anónima lleva historial; una fallida excluida. | Payloads sintéticos por consulta |
| I03 | RF-C4-IN-03 | Cuatro pruebas:40 s muestra;50 s fallo45–46 s sin tardía/historial;reintento plazo propio;ningún resultado previo en conversación nueva. | Reloj/reductor y navegador tiempo real |
| I04 | RF-C4-IN-04 | Seis pruebas:2VALIDACION sinreintento,2ERROR_INTERNO conreintento,1HTTP502HTML,1JSON incompleto; sin detalles técnicos y sin historial fallido. | DOM y estado/payloads |
| I05 | RF-C4-IN-05 | Seis respuestas:2 conID con envío,2 conversación sinID y2 anónimas sin controles/ocultos enfocables; texto normal visible. | UI+registro real |
| I06 | RF-C4-IN-06 | Cuatro pruebas cubren recuperación antes de emergencia, caída apertura/emergencia, recuperación antes de fallo, caída apertura/fallo;≤5 s carga, mensaje literal/enlace en ausencia, nuevos valores vigentes, sin valores de reserva. | Red/cronología/inspección código |
| P01 | RNF-C4-IN-01 | Tres recorridos Chrome/Firefox, revisión código/storage;0 texto/IDs persistidos, cinco ciclos conservan transcripción; recarga/cierre página destruyen. | Inspección localStorage/sessionStorage/IndexedDB/cookies/URL y código |
| P02 | RNF-C4-IN-02 | Seis pruebas:2 frames válidos origen oficial,3 bloqueos ajeno/subdominio/http,1cabecera; repetir bloqueos Android/iOS. | Headers nginx reales+consola/vídeo |
| B09 | RF-C3-IN-09 | Doce envíos:7 válidos cruzables con interacción y5 inválidos sin filas: inexistente,duplicado,motivo ausente,indebido,fuera lista. Texto adicional no guardado. | PostgreSQL real/HTTP,no solo mock |
| B10 | RF-C3-IN-10 | Tres llamadas:valores iguales registro, cambio tras edición panel sin redespliegue,0LLM,≤2 s. | BD/API/panel real/tráfico |

## Estados para accesibilidad

Botón cerrado; primera carga; apertura; consentimiento pendiente y ambas decisiones; creandoID/fallo; categorías y cuatro opciones; emergencia con contactos y sin contactos; lista vacía; esperando/reduced-motion; éxito de cada estructura; fallo recuperable/no recuperable/contactos ausentes/contador agotado; diálogo reinicio/cancelación; valoración disponible/motivo/enviando/confirmada/fallida y respuesta sinID. Examinar iframe, shell y host: axe no ve automáticamente todos los contextos cruzados, ejecutar dentro iframe y host.

Manual: nombres/roles/foco/orden Tab/ShiftTab/Escape, lectura de status sin mover foco, lectura de tabla/encabezados, enlaces anunciados, zoom y reflow, modal móvil/inert restaurado y control mapa, confirmación, teclado virtual, áreas seguras y orientación. Registrar todos criterios A/AA aplicables con fundamento si no aplica; ninguna ausencia de test significa aprobado.

## Regresiones adicionales obligatorias

- 768 exacto; tablet/orientación; host diferente viewportiframe; teclado móvil real; ocultar con solicitud en curso conserva reloj/resultado.
- Reinicio durante lectura de respuesta/valoración/config; respuesta vieja jamás rehidrata nuevaepoch. Cancelar diálogo mientras respuesta llega no pierde contenido.
- Doble clic y envío por teclado con mismo frame de eventos:unrequest. Token expirado/renovación no envía historial a ID/portador nuevo ni genera retry automático.
- Storage/logs de anónimo:0 textos/IDs/categoría/valoración; backend no registra por bypass. No payload de conversación enpostMessage.
- postMessage origin incorrecto/source incorrecta/version/esquema inválidos ignorados; no wildcard ni origen ciudadano configurable.
- Tabla ancha, enlaces con paréntesis/URL codificada, énfasis anidado, HTML/eventos/protocolos inseguros, Markdown malformado; respuesta DOM final cumpleallowlist.
- Valoración ajena/depurada/anónima/token inválido/propiedades extra rechazadas; concurrencia una fila; pérdida de acuse no crea segunda ni muestra agradecimiento falso. Purga12 meses+≤24 h conserva únicamente estadísticas sinIDs y FK no bloquea.
- Migración sobre volúmenes limpio/existente, segunda ejecución sin cambios; KB/matriz/contactos intactos, runtime sinDDL/UPDATE/DELETE valoración.
- Fallo escritura respuesta conserva contenido sinID; ninguna ausencia documental se confunde con búsqueda fallida. Usuario no recibe proveedor/modelo/costo/meta técnica.

## Evidencia y cierre

Manifest por ejecución: fecha, git commit+hash cambios locales, imagen/bundle/launcher/CSS/logo/corpus/contactos/política, matriz versión/hash, entorno/OS/browser/viewport/lector, adapter controlled/integrated, resultado/evidencia/revisor por caso. Textos únicamente sintéticos en pruebas; HAR/logs sin tokens/credenciales/conversación real.

Hallazgo: requisito/caso, esperado/observado, REAL Datos/Recuperación/Modelo conforme tabla7, prioridad original, causa/corrección, evidencia antes/después y última reejecución completa. Documento final señala pendientes y nunca declara aceptaciónH4-C4 por mocks o checklist verde.

Cerrar diseño no ejecuta estos casos. Cierre implementación requiere22/22 filas completas,12/12UI y8/8C4-IN y servicios directos reales, sin requisito Importante omitido; guías/portal revisados. Cambios al prompt/recuperación/base repiten además matriz congelada002 en ambos modelos por constituciónIX.
