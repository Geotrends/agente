"use client";

import { useCallback, useEffect, useState } from "react";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";
import { useGatedInterval } from "../../../admin/useGatedInterval";
import { cargarSesion } from "../../../shared/adminSession";

type Aviso = {
  id: string; origen: "operacion" | "kb"; type: string; description: string; state: "no_revisada" | "revisada";
  firstAt: string; lastAt: string; repetitions: number; reviewedBy: string | null; reviewedAt: string | null;
  scope: "sistema" | "carga"; revision: string;
};
type Respuesta = { items: Aviso[]; total: number; noRevisadas: number; nextCursor: string | null };
const fecha = (iso: string) => new Date(iso).toLocaleString("es-CO");
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
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [mensaje, setMensaje] = useState("");

  const cargar = useCallback(async (cursor?: string) => {
    const q = new URLSearchParams({ estado: todas ? "todas" : "no_revisada", limit: "50" });
    if (cursor) q.set("cursor", cursor);
    const r = await llamar<Respuesta>("GET", `/notifications?${q}`);
    if (r.ok) { setDatos(prev => (cursor && prev ? { ...r.data, items: [...prev.items, ...r.data.items] } : r.data)); return; }
    if (r.status === 401) { window.location.assign("/admin/login"); return; }
    setMensaje(mensajeError(r.error, r.status));
  }, [todas]);

  useEffect(() => { void cargarSesion().then(s => { if (!s) window.location.assign("/admin/login"); else void cargar(); }); }, [cargar]);
  // Sondeo solo con actividad humana reciente: no mantiene viva la sesión (RNF-C3-AD-05).
  useGatedInterval(() => { void cargar(); }, 30_000);

  async function revisar(a: Aviso) {
    setMensaje("");
    const r = await llamar("POST", `/notifications/${encodeURIComponent(a.id)}/review`, { expectedRevision: a.revision });
    setMensaje(r.ok ? "Aviso marcado como revisado." : mensajeError(r.error, r.status));
    await cargar();
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1>Avisos</h1>
      <p><label><input type="checkbox" checked={todas} onChange={e => setTodas(e.target.checked)} /> Mostrar también los revisados</label></p>
      <p role="status" className="admin-aviso">{mensaje}</p>
      {datos && (
        <>
          <p>{datos.noRevisadas} sin revisar.</p>
          <AdminTable<Aviso> titulo="Avisos" filas={datos.items} clave={a => a.id} vacio="No hay avisos."
            columnas={[
              { clave: "tipo", titulo: "Tipo", render: a => NOMBRE_TIPO[a.type] ?? a.type },
              { clave: "desc", titulo: "Descripción", render: a => a.description },
              { clave: "ult", titulo: "Última ocurrencia", render: a => fecha(a.lastAt) },
              { clave: "prim", titulo: "Primera", render: a => fecha(a.firstAt) },
              { clave: "rep", titulo: "Repeticiones", render: a => a.repetitions },
              { clave: "estado", titulo: "Estado", render: a => (a.state === "revisada"
                ? `Revisado${a.reviewedAt ? ` el ${fecha(a.reviewedAt)}` : ""}` : "No revisado") },
              { clave: "acc", titulo: "Acción", render: a => (a.state === "no_revisada"
                ? <button type="button" className="button" onClick={() => { void revisar(a); }}>Marcar como revisado: {NOMBRE_TIPO[a.type] ?? a.type}</button> : "—") },
            ]} />
          {datos.nextCursor && <button type="button" className="button" onClick={() => { void cargar(datos.nextCursor!); }}>Cargar más avisos</button>}
        </>
      )}
    </main>
  );
}
