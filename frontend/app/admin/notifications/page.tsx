"use client";

import { useEffect, useState, useRef } from "react";
import { useAdminQuery, QueryState } from "../../../admin/useAdminQuery";
import { fecha, numero } from "../../../admin/format";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";
import { useGatedInterval } from "../../../admin/useGatedInterval";
import AdminDialog from "../../../admin/AdminDialog";

type Aviso = {
  id: string; origen: "operacion" | "kb"; type: string; description: string; state: "no_revisada" | "revisada";
  firstAt: string; lastAt: string; repetitions: number; reviewedBy: string | null; reviewedAt: string | null;
  scope: "sistema" | "carga"; revision: string;
};
type Respuesta = { items: Aviso[]; total: number; noRevisadas: number; nextCursor: string | null };
const NOMBRE_TIPO: Record<string, string> = {
  modelo_no_disponible: "Modelo no disponible", doble_fallo_modelos: "Ambos modelos fallaron", reranker_degradado: "Reranker degradado",
  registro_no_disponible: "Registro no disponible", cuenta_bloqueada: "Cuenta bloqueada", calibracion_pendiente: "Calibración pendiente",
  publicacion_fallida: "Publicación fallida", tarifa_faltante: "Tarifa faltante", verificacion_fallida: "Verificación fallida",
  descarte_ocr: "Descarte por OCR", formato_con_datos_personales: "Formato con datos personales", carga_rechazada: "Carga rechazada",
  indexacion_fallida: "Indexación fallida", documento_vencido: "Documento vencido", fuente_retirada: "Enlace quitado",
  documento_derogado: "Documento derogado", fuera_de_alcance: "Fuera de alcance", texto_nativo_ilegible: "Texto ilegible",
  verificacion_atrasada: "Verificación atrasada", procedimiento_faltante: "Procedimiento faltante",
};

export default function AvisosAdmin() {
  const [todas, setTodas] = useState(false);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [novedades, setNovedades] = useState(false);
  const [comprobar, setComprobar] = useState(true);
  const [revisando, setRevisando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [confirmarTodos, setConfirmarTodos] = useState(false);
  const [revisandoTodos, setRevisandoTodos] = useState(false);

  const path = `/notifications?estado=${todas ? "todas" : "no_revisada"}&limit=50`;
  const { data: datos, busy: cargando, error, announcement, cargar } = useAdminQuery<Respuesta>(path);
  const pathActual = useRef(path);
  pathActual.current = path;
  useEffect(() => { setNovedades(false); setMarcados([]); }, [path]);
  useGatedInterval(() => {
    if (!comprobar || cargando || !datos) return;
    void llamar<Respuesta>("GET", path).then(r => {
      if (pathActual.current === path && r.ok && (r.data.total !== datos.total || JSON.stringify(r.data.items) !== JSON.stringify(datos.items.slice(0, r.data.items.length)) )) setNovedades(true);
    });
  }, 30_000);

  async function revisar(a: Aviso) {
    if (revisando || marcados.includes(a.id)) return;
    setRevisando(a.id); setMensaje("");
    const r = await llamar("POST", `/notifications/${encodeURIComponent(a.id)}/review`, { expectedRevision: a.revision });
    setMensaje(r.ok ? "Aviso marcado como revisado." : mensajeError(r.error, r.status));
    if (r.ok) { setNovedades(true); setMarcados(prev => [...prev, a.id]); window.dispatchEvent(new Event("admin-contadores")); }
    setRevisando(null);
  }

  /** Marca como revisados todos los avisos pendientes que esta cuenta puede ver (no solo los cargados). */
  async function revisarTodos() {
    if (revisandoTodos) return;
    setRevisandoTodos(true); setMensaje("");
    const r = await llamar<{ revisados: number; noRevisadas: number }>("POST", "/notifications/review-all", {});
    setRevisandoTodos(false); setConfirmarTodos(false);
    if (!r.ok) { setMensaje(mensajeError(r.error, r.status)); return; }
    setMensaje(r.data.revisados === 1 ? "Se marcó 1 aviso como revisado." : `Se marcaron ${numero(r.data.revisados)} avisos como revisados.`);
    setNovedades(false); setMarcados([]);
    window.dispatchEvent(new Event("admin-contadores"));
    await cargar();
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1 tabIndex={-1}>Avisos</h1>
      <QueryState busy={cargando} error={error} announcement={announcement} retry={cargar} />
      <p><label><input type="checkbox" checked={comprobar} onChange={e => setComprobar(e.target.checked)} /> Comprobar novedades automáticamente</label></p>
      <p>Las novedades se incorporan cuando usted lo decide; sus filas cargadas y su posición se conservan mientras revisa.</p>
      {novedades && <p role="status">Hay actualizaciones disponibles. <button type="button" className="button" disabled={cargando} onClick={() => { setNovedades(false); void cargar().then(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(".admin-tabla-contenedor")?.focus())); }}>Actualizar lista desde el inicio</button></p>}
      <p><label><input type="checkbox" checked={todas} onChange={e => setTodas(e.target.checked)} /> Mostrar también los revisados</label></p>
      <p role="status" className="admin-aviso">{mensaje}</p>
      {datos && (
        <>
          <div className="admin-acciones admin-acciones-barra">
            <p>{numero(datos.noRevisadas)} sin revisar.</p>
            {datos.noRevisadas > 0 && <button type="button" className="button" disabled={cargando || revisandoTodos} onClick={() => setConfirmarTodos(true)}>Revisar todos los pendientes ({numero(datos.noRevisadas)})</button>}
          </div>
          <AdminTable<Aviso> ocupado={cargando} titulo="Avisos" filas={datos.items} clave={a => a.id} vacio="No hay avisos."
            columnas={[
              { clave: "tipo", titulo: "Tipo", fila: true, render: a => NOMBRE_TIPO[a.type] ?? a.type },
              { clave: "desc", titulo: "Descripción", render: a => a.description },
              { clave: "ult", titulo: "Última ocurrencia", fecha: true, render: a => fecha(a.lastAt) },
              { clave: "prim", titulo: "Primera ocurrencia", fecha: true, render: a => fecha(a.firstAt) },
              { clave: "rep", titulo: "Repeticiones", numerica: true, ordenar: a => a.repetitions, render: a => numero(a.repetitions) },
              { clave: "estado", titulo: "Estado", render: a => (a.state === "revisada" || marcados.includes(a.id)
                ? `Revisado${a.reviewedAt ? ` el ${fecha(a.reviewedAt)}` : ""}` : "No revisado") },
              { clave: "acc", titulo: "Acción", render: a => (a.state === "no_revisada"
                ? <button type="button" className="button" aria-disabled={!!revisando || marcados.includes(a.id)} aria-label={`Marcar como revisado: ${NOMBRE_TIPO[a.type] ?? a.type}, aviso ${a.id}`} onClick={() => { void revisar(a); }}>{marcados.includes(a.id) ? "Revisado" : revisando === a.id ? "Marcando…" : "Marcar como revisado"}</button> : "Sin acciones pendientes") },
            ]} />
          {datos.nextCursor && <button type="button" className="button button-secondary" disabled={cargando} onClick={() => { void cargar(datos.nextCursor!); }}>Cargar más avisos</button>}
        </>
      )}
      <AdminDialog abierto={confirmarTodos} titulo="Revisar todos los avisos pendientes" onCancelar={() => { if (!revisandoTodos) setConfirmarTodos(false); }}>
        <p>Se marcarán como revisados los <strong>{numero(datos?.noRevisadas ?? 0)}</strong> avisos sin revisar que usted puede ver, incluidos los que aún no se cargaron en la lista. Cada uno queda registrado con su cuenta y la fecha.</p>
        <div className="admin-acciones">
          <button type="button" className="button" disabled={revisandoTodos} onClick={() => { void revisarTodos(); }}>{revisandoTodos ? "Marcando…" : "Marcar todos como revisados"}</button>
          <button type="button" className="button button-secondary" disabled={revisandoTodos} onClick={() => setConfirmarTodos(false)}>Cancelar</button>
        </div>
      </AdminDialog>
    </main>
  );
}
