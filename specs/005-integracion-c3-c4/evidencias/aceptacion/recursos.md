# Recursos compartidos y capacidad (T067)

Fecha: 2026-10-10. Decisiones de diseño y ajustes **preparados**; la medición real de N313/N303 en el anfitrión es T078/T079 (pendiente de acceso operativo). No se relajó cuota, límite de cuerpo ni plazo.

## Mantenido (sin cambio)

| Elemento | Estado |
| --- | --- |
| Worker de KB en servicio separado (`kb-worker`) con la misma imagen | se conserva: el chat no comparte proceso con la reindexación |
| Publicación por alias atómico de Qdrant | se conserva (SPEC001) |
| Cuota 60 consultas/min/IP, cuerpo 128 KiB, plazo 40 s | sin cambio |
| 25 consultas admitidas: `CHAT_MAX_CONCURRENT=8` + `CHAT_MAX_QUEUE=24` (≥ 25) | se conserva; prueba `capacity-queue.test.ts` |

## Hallazgo corregido (arranque en frío)

`ChatAdmissionQueue` suponía 10 s por consulta hasta aprender la real. Con 25 simultáneas en frío la 25.ª recibía `chat_queue_busy` (espera estimada 30 000 ms > plazo restante − 10 s = 29 988 ms): un error en la primera oleada de N303 tras un reinicio. Ahora el supuesto inicial es configurable (`CHAT_QUEUE_INITIAL_AVERAGE_MS`, defecto 5 000 ms) y se reemplaza por la media móvil real. La prueba falla con 10 s y pasa con 5 s; 33 simultáneas siguen dando «cola llena» en la plaza 33.

## Ajustes preparados si N313 falla (valores neutros por defecto)

`docker-compose.yml`, servicio `kb-worker`:

| Variable | Defecto | Efecto | Cuándo usarla |
| --- | --- | --- | --- |
| `KB_WORKER_CPU_SHARES` | 1024 | peso relativo de CPU frente al backend/anfitrión | bajar a 256–512 si el p95 del Observatorio/Geoportal sube >20 % durante la reindexación |
| `KB_WORKER_CPUS` | 0 (sin tope) | techo de CPU del worker | fijar (p. ej. núcleos − 2) si el peso no basta |
| `KB_WORKER_MEM_LIMIT` | 0 (sin tope) | techo de memoria | si la reindexación compite por RAM con el anfitrión |
| `EMBEDDING_INTRA_OP_THREADS` | automático (núcleos − 1 en sincronización) | hilos de embeddings | fijar a mano para dejar núcleos libres |

Regla: tras cualquier ajuste se **repite la condición completa** (30 muestras por destino y condición, reindexación completa y oleada de 25) sin cambiar el umbral de 120 %. No se detiene el chat ni se sube la cuota para pasar la prueba. Con la reindexación más lenta debe recomprobarse el umbral de ingesta de SPEC001 (tres ingestas productivas < 2 h, T083 de esa spec).

## Sin información real

Cantidad de núcleos/RAM del anfitrión, coexistencia efectiva con el Observatorio/Geoportal y duración de la reindexación completa: **no disponibles en este entorno**. Este documento no afirma que N313 se cumpla.
