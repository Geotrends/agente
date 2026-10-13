# Revisión de interfaz y accesibilidad (T096) — PENDIENTE

No se pudo ejecutar en esta sesión: no hay navegador automatizable. Lo que sí está probado sin navegador real: la máquina de consentimiento (`frontend/test/di-consent.test.ts`, 6 pruebas) y el panel renderizado con jsdom (`frontend/test/di-flows.test.mts`, 8 pruebas: aperturas, urgencias antes de decidir, anónimas, autorizadas, recarga, errores, enlaces https y etiquetas/roles básicos), la API de configuración en ≤ 2 s y el build estático. jsdom no calcula diseño, foco visible ni contraste, y no reemplaza un lector de pantalla. Lista para el revisor:

## Chat (escritorio ×3 y móvil ×2)
- [ ] Apertura fija de Geobot con alcance, política (https, nueva pestaña) y botones **Autorizo / No autorizo**; el campo de pregunta está deshabilitado hasta decidir.
- [ ] 6 recorridos de urgencia: los canales inmediatos se ven antes de decidir, con valores exactos del registro, sin consultar al modelo ni autorizar.
- [ ] 5 anónimas con 2 seguimientos: aviso fijo de que no se conserva la conversación; en pantalla solo la consulta actual.
- [ ] Recargar / cerrar / ruta directa: se vuelve a pedir la decisión; no hay forma de consultar sin ella.
- [ ] Enlaces de citas y fuentes: abren en pestaña nueva sin borrar la pregunta; solo https.
- [ ] Teclado, foco visible, etiquetas, contraste, lector de pantalla (WCAG 2.1 A/AA) y región viva del historial.

## Panel `/admin`
- [ ] Ruta directa sin sesión → login; Gestor documental → 403 sin datos en contactos, estado y avisos.
- [ ] Cambio obligatorio de contraseña temporal: solo sesión, contraseña y salir hasta cambiarla.
- [ ] Contactos: errores por campo asociados a su entrada; 409 de revisión conserva lo escrito; edición → siguiente respuesta del chat.
- [ ] Estado y avisos en las 3 pantallas con contador; estados visibles < 60 s; revisión conserva la fila.
- [ ] Polling pausado: verificar sesión a los 29 y 31 min de inactividad.
- [ ] Teclado, foco, etiquetas, mensajes de campo, contraste y lector en login, contraseña, contactos, estado y avisos.

Firma: ______________________ Fecha: __________
