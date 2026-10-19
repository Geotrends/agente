"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { llamar } from "./adminClient";
import { useGatedInterval } from "./useGatedInterval";

export type Operacion = {
  id: string; tipo: string; estado: "En curso" | "Terminada" | "Fallida"; fase: string;
  inicio: string | null; fin: string | null; intentos: number; error: string | null; limpiezaPendiente: boolean;
  proximoIntento?: string | null; intentosLimpieza?: number; requiereAtencion?: boolean;
};

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-CO") : "—");
const TIPOS: Record<string, string> = {
  publish: "Publicación", replace: "Reemplazo", reject: "Rechazo", withdraw: "Retiro", reindex: "Reindexación", metadata: "Metadata",
};

/**
 * Seguimiento de una operación durable: «En curso» hasta que termina o falla. Nunca muestra
 * «Terminada» por un 202; sondea mientras haya actividad humana (no mantiene viva la sesión).
 */
export default function DocumentOperationStatus({ operationId, onTerminada }: { operationId: string; onTerminada?: (o: Operacion) => void }) {
  const [op, setOp] = useState<Operacion | null>(null);
  const [error, setError] = useState("");
  const [reanudando, setReanudando] = useState(false);

  const leer = useCallback(async () => {
    const r = await llamar<Operacion>("GET", `/document-operations/${operationId}`);
    if (r.ok) { setOp(r.data); setError(""); } else setError(r.error.mensaje);
  }, [operationId]);

  const reanudar = useCallback(async () => {
    setReanudando(true);
    const r = await llamar<{ id: string }>("POST", `/document-operations/${operationId}/resume`, {});
    setReanudando(false);
    if (!r.ok) { setError(r.error.mensaje); return; }
    setError("");
    await leer();
  }, [operationId, leer]);

  useEffect(() => { void leer(); }, [leer]);
  useGatedInterval(() => { if (!op || op.estado === "En curso") void leer(); }, 3_000);
  // Avisa UNA vez por operación al salir de «En curso». `onTerminada` suele ser una función nueva en
  // cada render de la pantalla: como dependencia reiniciaba el efecto y recargaba la lista en bucle.
  const alTerminar = useRef(onTerminada);
  alTerminar.current = onTerminada;
  const avisada = useRef(false);
  useEffect(() => {
    if (op && op.estado !== "En curso" && !avisada.current) { avisada.current = true; alTerminar.current?.(op); }
  }, [op]);

  if (error) return <p role="alert" className="admin-error">{error}</p>;
  if (!op) return <p role="status">Consultando la operación…</p>;
  return (
    <div className="admin-aviso">
      <p role="status">
        {TIPOS[op.tipo] ?? op.tipo}: <strong>{op.estado}</strong>
        {op.estado === "En curso" && ` (${op.fase})`} · Inicio: {fecha(op.inicio)} · Fin: {fecha(op.fin)}
        {op.estado === "Fallida" && " · No se perdió la versión anterior; se avisó en la bandeja de avisos."}
        {op.limpiezaPendiente && op.estado === "En curso" && " · Confirmando la eliminación del contenido anterior."}
        {op.requiereAtencion && op.estado === "En curso" &&
          ` · Requiere atención: no se pudo completar tras varios intentos. Sigue reintentando; próximo intento: ${fecha(op.proximoIntento ?? null)}.`}
      </p>
      {op.estado === "En curso" && (
        // Sin interacción durante un minuto el sondeo se detiene (la sesión no se mantiene viva sola).
        <button type="button" className="button" onClick={() => { void leer(); }}>Actualizar estado de la operación</button>
      )}
      {op.estado === "En curso" && (op.requiereAtencion || op.proximoIntento) && (
        <button type="button" className="button" disabled={reanudando} aria-busy={reanudando} onClick={() => { void reanudar(); }}>
          {reanudando ? "Reanudando…" : "Reanudar ahora"}
        </button>
      )}
    </div>
  );
}
