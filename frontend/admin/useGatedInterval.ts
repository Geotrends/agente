"use client";

import { useEffect, useRef } from "react";
import { currentTracker } from "./sessionActivity";

/**
 * Sondeo condicionado a actividad humana (RNF-C3-AD-05): solo ejecuta `fn` mientras la pestaña
 * está visible y hubo interacción en los últimos 60 s. Una pantalla abierta e ignorada deja de
 * hacer solicitudes y la sesión del servidor puede vencer a los 30 minutos.
 */
export function useGatedInterval(fn: () => void, ms: number): void {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    const t = setInterval(() => {
      const tracker = currentTracker();
      if (tracker?.pollingAllowed()) ref.current();
    }, ms);
    return () => clearInterval(t);
  }, [ms]);
}
