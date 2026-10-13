/**
 * Conciliación de registros de una corrida de carga (N303, RNF-C3-IN-03, RF-C3-IN-05/07).
 *
 * Autorizados: cada `responseId` devuelto por el servicio debe existir en `chat.interaction`, ligado a
 * la conversación de la muestra, con modelo, tokens y costo. Anónimos: no hay identificador (no se
 * añade ninguno a la tabla, a la carga ni a los logs); se cotejan como MULTICONJUNTO por la fecha
 * de recepción dentro del intervalo de cada muestra y por los seis campos técnicos, en una ventana
 * exclusiva de la corrida. Una fila que no corresponde a ninguna muestra es tráfico ajeno: el
 * criterio queda PENDIENTE (no se afirma ni se niega con un conteo global).
 *
 * Es evidencia de acceso restringido: usa una conexión de solo lectura a la base de la corrida y no
 * imprime textos ni identificadores públicos.
 */
import type pg from "pg";
import type { Sample } from "./loadRunner.js";

export type Reconciliacion = {
  autorizados: { esperados: number; encontrados: number; faltantes: number; incoherentes: number; duplicados: number };
  anonimos: { esperados: number; emparejados: number; sinMuestra: number; faltantes: number; incompletos: number };
  /** Columnas de `chat.anonymous_usage`: deben ser exactamente las seis permitidas. */
  columnasAnonimas: string[];
  estado: "conforme" | "pendiente_trafico_ajeno" | "fallo";
  problemas: string[];
};

const SEIS = ["estimated_cost", "input_tokens", "mode", "model", "output_tokens", "received_at"];

export async function conciliar(db: pg.Pool, muestras: Sample[], opts: { toleranciaMs?: number; esperadosAutorizados?: number; esperadosAnonimos?: number } = {}): Promise<Reconciliacion> {
  const tol = opts.toleranciaMs ?? 2_000;
  const problemas: string[] = [];
  const ok = muestras.filter(m => m.ok);

  // Autorizados por identificador.
  const aut = ok.filter(m => m.autorizada && m.responseId);
  const esperadosAut = opts.esperadosAutorizados ?? aut.length;
  let encontrados = 0; let incoherentes = 0; let duplicados = 0;
  if (aut.length) {
    const { rows } = await db.query(
      `SELECT response_id::text, conversation_id::text, model, input_tokens, output_tokens, estimated_cost, received_at
         FROM chat.interaction WHERE response_id = ANY($1::uuid[])`, [aut.map(m => m.responseId)]);
    const porId = new Map<string, typeof rows>();
    for (const r of rows) porId.set(r.response_id, [...(porId.get(r.response_id) ?? []), r]);
    for (const m of aut) {
      const filas = porId.get(m.responseId!) ?? [];
      if (filas.length === 0) continue;
      if (filas.length > 1) duplicados++;
      encontrados++;
      const r = filas[0];
      const dentro = Math.abs(new Date(r.received_at).getTime() - m.inicioMs) <= m.ms + tol;
      if (r.conversation_id !== m.conversationId || !r.model || r.input_tokens == null || r.output_tokens == null || r.estimated_cost == null || !dentro) incoherentes++;
    }
  }
  const faltantesAut = Math.max(0, esperadosAut - encontrados);

  // Anónimos por multiconjunto y ventana exclusiva.
  const anon = ok.filter(m => !m.autorizada);
  const esperadosAnon = opts.esperadosAnonimos ?? anon.length;
  const desde = new Date(Math.min(...ok.map(m => m.inicioMs)) - tol);
  const hasta = new Date(Math.max(...ok.map(m => m.inicioMs + m.ms)) + tol);
  const { rows: filasAnon } = ok.length
    ? await db.query("SELECT received_at, mode, model, input_tokens, output_tokens, estimated_cost FROM chat.anonymous_usage WHERE received_at BETWEEN $1 AND $2 ORDER BY received_at", [desde, hasta])
    : { rows: [] as Array<Record<string, unknown>> };
  // Emparejamiento bipartito máximo (muestra ↔ fila cuyo `received_at` cae en su intervalo): con
  // solicitudes simultáneas un emparejamiento voraz puede robar la fila de otra muestra.
  const muestrasAnon = [...anon].sort((a, b) => a.inicioMs - b.inicioMs);
  const candidatos = muestrasAnon.map(m => filasAnon
    .map((r, idx) => ({ idx, t: new Date(r.received_at as Date).getTime() }))
    .filter(x => x.t >= m.inicioMs - tol && x.t <= m.inicioMs + m.ms + tol).map(x => x.idx));
  const filaAMuestra = new Map<number, number>();
  const intenta = (mi: number, visto: Set<number>): boolean => {
    for (const fi of candidatos[mi]) {
      if (visto.has(fi)) continue;
      visto.add(fi);
      const previa = filaAMuestra.get(fi);
      if (previa === undefined || intenta(previa, visto)) { filaAMuestra.set(fi, mi); return true; }
    }
    return false;
  };
  let emparejados = 0;
  for (let mi = 0; mi < muestrasAnon.length; mi++) if (intenta(mi, new Set())) emparejados++;
  const usadas = filaAMuestra;
  const sinMuestra = filasAnon.length - usadas.size;
  const incompletos = filasAnon.filter(r => r.mode !== "anónima" || !r.model || r.input_tokens == null || r.output_tokens == null || r.estimated_cost == null).length;
  const faltantesAnon = Math.max(0, esperadosAnon - emparejados);

  const { rows: cols } = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'chat' AND table_name = 'anonymous_usage' ORDER BY column_name");
  const columnasAnonimas = cols.map(c => c.column_name as string);
  if (JSON.stringify(columnasAnonimas) !== JSON.stringify(SEIS)) problemas.push("la tabla de consumo anónimo no tiene exactamente los seis campos permitidos");
  if (faltantesAut > 0) problemas.push(`${faltantesAut} registros autorizados faltan`);
  if (incoherentes > 0) problemas.push(`${incoherentes} registros autorizados con campos incoherentes`);
  if (duplicados > 0) problemas.push(`${duplicados} identificadores duplicados`);
  if (faltantesAnon > 0) problemas.push(`${faltantesAnon} registros anónimos faltan`);
  if (incompletos > 0) problemas.push(`${incompletos} registros anónimos incompletos`);
  const ajeno = sinMuestra > 0;
  if (ajeno) problemas.push(`${sinMuestra} filas anónimas en la ventana no corresponden a ninguna muestra (tráfico ajeno no separable)`);

  const duros = problemas.filter(p => !/tráfico ajeno/.test(p));
  return {
    autorizados: { esperados: esperadosAut, encontrados, faltantes: faltantesAut, incoherentes, duplicados },
    anonimos: { esperados: esperadosAnon, emparejados, sinMuestra, faltantes: faltantesAnon, incompletos },
    columnasAnonimas,
    estado: duros.length ? "fallo" : ajeno ? "pendiente_trafico_ajeno" : "conforme",
    problemas,
  };
}
