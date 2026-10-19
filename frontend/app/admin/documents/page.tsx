"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAdminQuery, QueryState, useDebounced } from "../../../admin/useAdminQuery";
import { fecha, EnlaceExterno } from "../../../admin/format";
import AdminDialog from "../../../admin/AdminDialog";
import { Campo } from "../../../admin/AdminForm";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";
import DocumentUploadForm, { DIRECCIONES, TIPOS } from "../../../admin/DocumentEditor";
import DocumentOperationStatus from "../../../admin/DocumentOperation";
import AdminTabs, { fijarHash, pestanaDelHash } from "../../../admin/AdminTabs";
import { consultarSesion } from "../../../shared/adminSession";

type Persona = { id: string; nombre: string } | null;
type Documento = {
  id: string; revision: string; codigo: string; nombre: string; tipo: string; direccion: string; enlace: string; estado: string;
  version: string; fechaActualizacion: string; formatoOriginal: string; usoOcr: string; fechaCarga: string;
  procedimientoOrigen: string; origen: "manual" | "scraper"; autor: Persona; validoHasta: string;
  sinActualizacionAutomatica: boolean;
  candidata: { versionId: string; estadoTecnico: string; subidaEn: string | null; autor: Persona } | null;
};
type Lista = { items: Documento[]; total: number; nextCursor: string | null };
type Accion =
  | { tipo: "rechazar" | "retirar"; doc: Documento }
  | { tipo: "editar"; doc: Documento };

const ESTADOS = ["Pendiente de aprobación", "Publicado", "Vencido", "Derogado"];
/** El servicio sigue llamando «Pendiente de aprobación» a ese estado; en pantalla se muestra más corto. */
const etiquetaEstado = (e: string) => (e === "Pendiente de aprobación" ? "Por aprobar" : e);
const TECNICO = "administrador técnico";

/** Minúsculas y sin tildes, para que «poda» encuentre «Poda» y «PODÁ». */
/** Números de página a mostrar: primera, última y el entorno de la actual; `null` es un salto «…». */
function paginasVisibles(actual: number, total: number): Array<number | null> {
  const set = new Set([1, total, actual - 1, actual, actual + 1].filter(n => n >= 1 && n <= total));
  const orden = [...set].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  orden.forEach((n, i) => { if (i > 0 && n - orden[i - 1] > 1) out.push(null); out.push(n); });
  return out;
}

const fechaCivil = (value: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(value) ? value.split("/").reverse().join("-") : /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
const iniciales = (d: Documento): Record<string, string> => ({
  title: d.nombre, type: d.tipo, direction: d.direccion, publicUrl: d.enlace,
  associatedProcedure: d.procedimientoOrigen === "N/A" ? "ninguno" : d.procedimientoOrigen,
  version: d.version === "N/A" ? "" : d.version,
  updatedDate: fechaCivil(d.fechaActualizacion),
  validUntil: fechaCivil(d.validoHasta),
});

export default function DocumentosAdmin() {
  const [esTecnico, setEsTecnico] = useState(false);
  const [seleccionado, setSeleccionado] = useState("");
  useEffect(() => { setSeleccionado(new URLSearchParams(window.location.search).get("id") ?? ""); }, []);
  const [soloMias, setSoloMias] = useState(false);
  const [estado, setEstado] = useState("");
  const [aviso, setAviso] = useState("");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [campoError, setCampoError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [orden, setOrden] = useState("recent");
  const [errorAccion, setErrorAccion] = useState("");
  const [operaciones, setOperaciones] = useState<string[]>([]);
  const [masivo, setMasivo] = useState<{ pendientes: Documento[] } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(15);
  const [exportando, setExportando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [seccion, setSeccion] = useState("matriz");
  const irA = (id: string) => { setSeccion(id); fijarHash(id); };

  const termino = useDebounced(busqueda.trim());
  const parametros = new URLSearchParams({ ...(soloMias ? { mine: "true" } : {}), ...(estado ? { state: estado } : {}), ...(termino ? { search: termino } : {}), ...(seleccionado ? { id: seleccionado } : {}) });
  const { data: lista, busy: cargando, error: errorConsulta, announcement: anuncio, cargar } = useAdminQuery<Lista>(`/documents?${parametros}&limit=${porPagina}&page=${pagina}&order=${orden}`);
  useEffect(() => { void consultarSesion().then(c => { if (c.estado === "ok") setEsTecnico(c.sesion.cuenta.perfil === TECNICO); }); }, []);
  useEffect(() => { setSeccion(pestanaDelHash(esTecnico ? ["matriz", "cargar", "reindexacion"] : ["matriz", "cargar"])); }, [esTecnico]);
  useEffect(() => { if (seleccionado && lista) { setSeccion("matriz"); document.getElementById(`documento-${seleccionado}`)?.focus(); } }, [seleccionado, lista]);

  // Una reindexación en curso (lanzada antes, desde otra pestaña o por la CLI) se retoma al abrir la pantalla.
  useEffect(() => {
    if (!esTecnico) return;
    void llamar<{ reindexacion?: { id: string; estado: string } | null }>("GET", "/status").then(r => {
      const re = r.ok ? r.data.reindexacion : null;
      if (re && re.estado === "En curso") setOperaciones(o => (o.includes(re.id) ? o : [re.id, ...o]));
    });
  }, [esTecnico]);

  const total = lista?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const paginaActual = pagina;
  const inicio = (paginaActual - 1) * porPagina;
  const visibles = lista?.items ?? [];
  useEffect(() => { setPagina(1); }, [termino, porPagina, soloMias, estado, orden, seleccionado]);
  useEffect(() => { if (lista && pagina > totalPaginas) setPagina(totalPaginas); }, [lista, pagina, totalPaginas]);

  /** Exporta TODAS las columnas de lo que coincide con la búsqueda y los filtros (CSV UTF-8 para Excel). */
  async function exportar() {
    if (exportando) return;
    setExportando(true); setAviso("Preparando la exportación…");
    const filtrados: Documento[] = [];
    let cursor: string | null = null;
    do {
      const q = new URLSearchParams(parametros);
      q.set("limit", "100");
      if (cursor) q.set("cursor", cursor);
      const r = await llamar<Lista>("GET", `/documents?${q}`);
      if (!r.ok) { setAviso(mensajeError(r.error, r.status)); setExportando(false); return; }
      filtrados.push(...r.data.items); cursor = r.data.nextCursor;
      setAviso(`Preparando exportación: ${filtrados.length} de ${r.data.total} documentos.`);
    } while (cursor);
    const celda = (v: string) => {
      const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; // evita fórmulas al abrir en Excel
      return `"${t.replace(/"/g, '""')}"`;
    };
    const cabecera = ["Código", "Nombre", "Tipo", "Dirección", "Enlace", "Estado", "Versión pendiente", "Versión", "Fecha de actualización",
      "Formato original", "Uso de OCR", "Fecha de carga", "Procedimiento de origen", "Origen", "Autor", "Válido hasta", "Sin actualización automática"];
    const filas = filtrados.map(d => [
      d.codigo, d.nombre, d.tipo, d.direccion, d.enlace, etiquetaEstado(d.estado), d.candidata ? `Sí (${d.candidata.estadoTecnico})` : "No", d.version,
      d.fechaActualizacion, d.formatoOriginal, d.usoOcr, d.fechaCarga, d.procedimientoOrigen, d.origen === "manual" ? "Manual" : "Scraper",
      d.autor?.nombre ?? "", d.validoHasta, d.sinActualizacionAutomatica ? "Sí" : "No",
    ].map(x => celda(String(x ?? ""))).join(";"));
    const blob = new Blob(["\uFEFF", [cabecera.map(celda).join(";"), ...filas].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `matriz-documental-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExportando(false);
    setAviso(`Exportados ${filtrados.length} documentos con todas las columnas.`);
  }

  async function encolar(ruta: string, cuerpo: object, mensaje: string): Promise<boolean> {
    const r = await llamar<{ operationId: string }>("POST", ruta, cuerpo);
    if (r.ok) { setOperaciones(o => [r.data.operationId, ...o]); setAviso(mensaje); return true; }
    setAviso(mensajeError(r.error, r.status));
    return false;
  }

  /** Reúne, de todas las páginas, los documentos con versión candidata ya procesada (publicables). */
  async function buscarPendientes() {
    setBuscando(true);
    const pendientes: Documento[] = [];
    let cursor: string | undefined;
    do {
      const q = new URLSearchParams({ limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const r = await llamar<Lista>("GET", `/documents?${q}`);
      if (!r.ok) { setBuscando(false); setAviso(mensajeError(r.error, r.status)); return; }
      pendientes.push(...r.data.items.filter(d => d.candidata?.estadoTecnico === "procesado"));
      cursor = r.data.nextCursor ?? undefined;
    } while (cursor);
    setBuscando(false);
    if (pendientes.length === 0) { setAviso("No hay documentos procesados esperando aprobación."); return; }
    setMasivo({ pendientes });
  }

  /** Publica uno por uno (cada documento es su propia operación durable) y resume el resultado. */
  async function publicarTodos() {
    if (!masivo) return;
    setPublicando(true);
    const ids: string[] = [];
    const fallos: string[] = [];
    for (const d of masivo.pendientes) {
      const r = await llamar<{ operationId: string }>("POST", `/documents/${d.id}/publish`, { expectedRevision: d.revision });
      if (r.ok) ids.push(r.data.operationId); else fallos.push(`${d.nombre}: ${mensajeError(r.error, r.status)}`);
    }
    setOperaciones(o => [...ids.reverse(), ...o]);
    setPublicando(false);
    setMasivo(null);
    setAviso(`Publicación aceptada para ${ids.length} de ${ids.length + fallos.length} documentos; están En curso.${fallos.length ? ` No se pudo publicar: ${fallos.join(" · ")}` : ""}`);
    await cargar();
  }

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accion) return;
    setErrorAccion(""); setCampoError("");
    if (guardando) return;
    const d = new FormData(e.currentTarget);
    const doc = accion.doc;
    if (accion.tipo === "editar") {
      const cambios: Record<string, string> = {};
      for (const k of ["title", "type", "direction", "publicUrl", "associatedProcedure", "version", "updatedDate", "validUntil"]) {
        const v = String(d.get(k) ?? "").trim();
        if (v !== iniciales(doc)[k]) cambios[k] = v;
      }
      if (!Object.keys(cambios).length) { setErrorAccion("No hay cambios para guardar."); return; }
      setGuardando(true);
      const r = await llamar<{ revision: string }>("PATCH", `/documents/${doc.id}/metadata`, { expectedRevision: doc.revision, changes: cambios });
      setGuardando(false);
      if (r.ok) { setAccion(null); setAviso("Datos actualizados; la siguiente consulta ya los usa."); await cargar(); return; }
      setErrorAccion(r.error.mensaje); setCampoError(r.error.campo && r.error.campo in iniciales(doc) ? r.error.campo : "");
      requestAnimationFrame(() => document.getElementById(`ed-${r.error.campo}`)?.focus());
      return;
    }
    const motivo = String(d.get("motivo") ?? "").trim();
    if (!motivo) { setErrorAccion("El motivo es obligatorio."); return; }
    const cuerpo = accion.tipo === "retirar"
      ? { expectedRevision: doc.revision, motivo, confirmedDocumentId: doc.id }
      : { expectedRevision: doc.revision, motivo };
    setGuardando(true);
    const r = await llamar<{ operationId: string }>("POST", `/documents/${doc.id}/${accion.tipo === "retirar" ? "withdraw" : "reject"}`, cuerpo);
    setGuardando(false);
    if (r.ok) { setOperaciones(o => [r.data.operationId, ...o]); setAccion(null); setAviso(accion.tipo === "retirar" ? "Retiro aceptado; el documento se elimina por completo al terminar." : "Rechazo aceptado; se descartará la versión pendiente. La versión publicada, si existe, se conserva."); await cargar(); return; }
    setErrorAccion(r.error.mensaje);
  }

  const columnas = [
    { clave: "codigo", titulo: "Código", render: (d: Documento) => d.codigo },
    { clave: "nombre", titulo: "Nombre", fila: true, render: (d: Documento) => <><EnlaceExterno href={d.enlace}>{d.nombre}</EnlaceExterno><details><summary>Origen y formato</summary><dl><dt>Origen</dt><dd>{d.origen === "manual" ? "Manual" : "Scraper"}</dd><dt>Autor</dt><dd>{d.autor?.nombre ?? "Sin autor registrado"}</dd><dt>Formato</dt><dd>{d.formatoOriginal}</dd><dt>OCR</dt><dd>{d.usoOcr}</dd><dt>Actualización</dt><dd>{d.fechaActualizacion}</dd><dt>Carga (Bogotá)</dt><dd>{d.fechaCarga}</dd><dt>Procedimiento</dt><dd>{d.procedimientoOrigen}</dd></dl></details></> },
    { clave: "tipo", titulo: "Tipo", render: (d: Documento) => d.tipo },
    { clave: "direccion", titulo: "Dirección", render: (d: Documento) => d.direccion },
    { clave: "estado", titulo: "Estado", render: (d: Documento) => (
      <>{etiquetaEstado(d.estado)}{d.candidata && d.estado !== "Pendiente de aprobación" ? " · con versión pendiente" : ""}
        {d.candidata && d.candidata.estadoTecnico !== "procesado" ? ` (${d.candidata.estadoTecnico === "en_cola" || d.candidata.estadoTecnico === "procesando" ? "procesando" : "no publicable"})` : ""}
        {d.sinActualizacionAutomatica ? " · Sin actualización automática" : ""}</>) },
    { clave: "version", titulo: "Versión", render: (d: Documento) => d.version },
    { clave: "validez", titulo: "Válido hasta", fecha: true, render: (d: Documento) => d.validoHasta === "N/A" ? "Sin vencimiento" : fecha(d.validoHasta, false) },
    ...(esTecnico ? [{ clave: "acciones", titulo: "Acciones", render: (d: Documento) => (
      <div className="admin-acciones admin-acciones-celda">
        {d.candidata?.estadoTecnico === "procesado" && (
          <button type="button" className="button" aria-label={`Publicar ${d.nombre}`} onClick={() => { void encolar(`/documents/${d.id}/publish`, { expectedRevision: d.revision }, `Publicación de «${d.nombre}» aceptada: está En curso.`).then(() => cargar()); }}>Publicar</button>)}
        {d.candidata && <button type="button" className="button" aria-label={`Rechazar ${d.nombre}`} onClick={() => { setErrorAccion(""); setCampoError(""); setAccion({ tipo: "rechazar", doc: d }); }}>Rechazar</button>}
        {d.estado !== "Pendiente de aprobación" && d.estado !== "Derogado" && (
          <button type="button" className="button button-danger" aria-label={`Retirar ${d.nombre}`} onClick={() => { setErrorAccion(""); setCampoError(""); setAccion({ tipo: "retirar", doc: d }); }}>Retirar</button>)}
        <button type="button" className="button button-secondary" aria-label={`Editar ${d.nombre}`} onClick={() => { setErrorAccion(""); setCampoError(""); setAccion({ tipo: "editar", doc: d }); }}>Editar</button>
      </div>) }] : []),
  ];

  return (
    <main className="admin-main admin-main-wide">
      <h1 tabIndex={-1}>Documentos</h1>
      <QueryState busy={cargando} error={errorConsulta} announcement={anuncio} retry={cargar} />
      {seleccionado && <p>Mostrando el documento seleccionado. <button className="button button-secondary" onClick={() => setSeleccionado("")}>Ver todos los documentos</button></p>}
      <p role="status" className="admin-aviso">{aviso}</p>
      {operaciones.map(id => <DocumentOperationStatus key={id} operationId={id} onTerminada={() => { void cargar(); }} />)}

      <AdminTabs etiqueta="Secciones de documentos" activa={seccion} onCambiar={irA} pestanas={[
        { id: "matriz", titulo: <>Matriz documental{lista ? ` (${lista.total})` : ""}</>, contenido: (
          <section aria-label="Matriz documental">
            <div className="admin-filtros">
              <label><input type="checkbox" checked={soloMias} onChange={e => setSoloMias(e.target.checked)} /> Solo mis cargas</label>
              <Campo id="filtro-estado" etiqueta="Estado">
                {p => <select {...p} className="input" value={estado} onChange={e => setEstado(e.target.value)}>
                  <option value="">Todos</option>{ESTADOS.map(s => <option key={s} value={s}>{etiquetaEstado(s)}</option>)}</select>}
              </Campo>
            </div>
            <Campo id="orden-documentos" etiqueta="Ordenar documentos">
              {p => <select {...p} className="input" value={orden} onChange={e => setOrden(e.target.value)}><option value="recent">Más recientes primero</option><option value="name">Nombre (A–Z)</option><option value="code">Código (A–Z)</option></select>}
            </Campo>
            <div className="admin-busqueda">
              <Campo id="busqueda-matriz" etiqueta="Buscar en la matriz">
                {p => <input {...p} type="search" className="input" value={busqueda} autoComplete="off"
                  placeholder="Código, nombre, tipo, dirección, estado, procedimiento…"
                  onChange={e => setBusqueda(e.target.value)} />}
              </Campo>
              {termino && lista && (
                <p role="status" className="admin-busqueda-cuenta">
                  {lista.total} documentos coinciden.
                  {" "}<button type="button" className="button button-secondary" onClick={() => setBusqueda("")}>Limpiar búsqueda</button>
                </p>
              )}
            </div>
            <div className="admin-acciones">
              <button type="button" className="button" disabled={cargando || !lista || total === 0 || exportando} onClick={() => { void exportar(); }}>Exportar (todas las columnas)</button>
              {esTecnico && (
                <button type="button" className="button" disabled={buscando || publicando} onClick={() => { void buscarPendientes(); }}>
                  {buscando ? "Buscando pendientes…" : "Publicar todos los pendientes del sistema"}
                </button>)}
            </div>
            {lista && <AdminTable<Documento> ocupado={cargando} filaId={d => `documento-${d.id}`} titulo="Matriz documental" ajustada filas={visibles} clave={d => d.id} columnas={columnas} vacio={termino ? "Ningún documento coincide con la búsqueda." : undefined} />}
            {lista && total > 0 && (
              <nav className="admin-paginacion" aria-label="Paginación de la matriz documental">
                <p role="status" className="admin-paginacion-info">
                  Mostrando {inicio + 1}–{Math.min(inicio + porPagina, total)} de {total}
                </p>
                <label className="admin-paginacion-tam">Por página{" "}
                  <select className="input" value={porPagina} onChange={e => setPorPagina(Number(e.target.value))}>
                    {[15, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <div className="admin-paginas">
                  <button type="button" className="button" disabled={cargando || paginaActual === 1} onClick={() => setPagina(paginaActual - 1)}>Anterior</button>
                  {paginasVisibles(paginaActual, totalPaginas).map((n, i) => n === null
                    ? <span key={`e${i}`} aria-hidden="true">…</span>
                    : <button key={n} type="button" className="button admin-pagina" aria-label={`Página ${n}`} aria-current={n === paginaActual ? "page" : undefined}
                        onClick={() => setPagina(n)}>{n}</button>)}
                  <button type="button" className="button" disabled={cargando || paginaActual === totalPaginas} onClick={() => setPagina(paginaActual + 1)}>Siguiente</button>
                </div>
              </nav>
            )}
          </section>) },
        { id: "cargar", titulo: "Cargar un documento", contenido: (
          <section aria-labelledby="h-carga">
            <h2 id="h-carga">Cargar un documento</h2>
            <DocumentUploadForm onCargado={m => { setAviso(m); irA("matriz"); void cargar(); }} />
          </section>) },
        ...(esTecnico ? [{ id: "reindexacion", titulo: "Reindexación", contenido: (
          <section aria-labelledby="h-reindex">
            <h2 id="h-reindex">Reindexación</h2>
            <p>Vuelve a generar el índice de búsqueda con todos los documentos publicados. El progreso aparece arriba, junto a las demás operaciones.</p>
            <button type="button" className="button" onClick={() => { void encolar("/reindexations", {}, "Reindexación aceptada: está En curso."); }}>Reindexar toda la base</button>
          </section>) }] : []),
      ]} />

      <AdminDialog abierto={!!masivo} onCancelar={() => { if (!publicando) setMasivo(null); }} titulo="Publicar todos los pendientes del sistema">
        {masivo && (
          <div className="admin-form">
            <p>Esta acción incluye todos los pendientes del sistema, aunque no coincidan con los filtros de la matriz. Se publicarán <strong>{masivo.pendientes.length}</strong> documentos ya procesados y el chat empezará a responder con ellos:</p>
            <ul className="admin-lista-corta" tabIndex={0} aria-label="Todos los documentos que se publicarán">
              {masivo.pendientes.map(d => <li key={d.id}>{d.nombre}</li>)}
            </ul>
            <div className="admin-acciones">
              <button type="button" className="button" disabled={publicando} onClick={() => { void publicarTodos(); }}>
                {publicando ? "Publicando…" : `Publicar ${masivo.pendientes.length} documentos`}
              </button>
              <button type="button" className="button" disabled={publicando} onClick={() => setMasivo(null)}>Cancelar</button>
            </div>
          </div>
        )}
      </AdminDialog>

      <AdminDialog abierto={!!accion} onCancelar={() => { if (!guardando) setAccion(null); }}
        titulo={!accion ? "" : accion.tipo === "retirar" ? "Retirar documento" : accion.tipo === "rechazar" ? "Rechazar documento" : "Editar metadata"}>
        {accion && (
          <form className="admin-form" noValidate onSubmit={confirmar}>
            {accion.tipo !== "editar" ? (
              <>
                <p>
                  {accion.tipo === "retirar"
                    ? `Se eliminará «${accion.doc.nombre}» de la matriz y de la base. Solo quedará un registro con el motivo.`
                    : `Se descartará la versión pendiente de «${accion.doc.nombre}». Si había una publicada, sigue respondiendo.`}
                </p>
                <Campo id="motivo" etiqueta="Motivo (obligatorio)" error={errorAccion || undefined}>
                  {p => <textarea {...p} name="motivo" className="input" rows={3} required />}
                </Campo>
              </>
            ) : (
              <>
                <p>Revise los valores actuales. Vaciar versión o fechas elimina ese valor; use «ninguno» para quitar el procedimiento asociado. El código y el contenido no se editan.</p>
                {errorAccion && !campoError && <p role="alert" className="admin-error">{errorAccion}</p>}
                <Campo id="ed-title" etiqueta="Título" error={campoError === "title" ? errorAccion : undefined}>{p => <input {...p} name="title" defaultValue={iniciales(accion.doc).title} className="input" />}</Campo>
                <Campo id="ed-type" etiqueta="Tipo" error={campoError === "type" ? errorAccion : undefined}>{p => <select {...p} name="type" className="input" defaultValue={iniciales(accion.doc).type}>{TIPOS.map(t => <option key={t}>{t}</option>)}</select>}</Campo>
                <Campo id="ed-direction" etiqueta="Dirección" error={campoError === "direction" ? errorAccion : undefined}>{p => <select {...p} name="direction" className="input" defaultValue={iniciales(accion.doc).direction}>{DIRECCIONES.map(t => <option key={t}>{t}</option>)}</select>}</Campo>
                <Campo id="ed-publicUrl" etiqueta="Enlace público (https)" error={campoError === "publicUrl" ? errorAccion : undefined}>{p => <input {...p} name="publicUrl" defaultValue={iniciales(accion.doc).publicUrl} type="url" className="input" />}</Campo>
                <Campo id="ed-associatedProcedure" etiqueta="Procedimiento asociado" error={campoError === "associatedProcedure" ? errorAccion : undefined}>{p => <input {...p} name="associatedProcedure" defaultValue={iniciales(accion.doc).associatedProcedure} className="input" />}</Campo>
                <Campo id="ed-version" etiqueta="Versión" error={campoError === "version" ? errorAccion : undefined}>{p => <input {...p} name="version" defaultValue={iniciales(accion.doc).version} className="input" />}</Campo>
                <Campo id="ed-updatedDate" etiqueta="Fecha de actualización" error={campoError === "updatedDate" ? errorAccion : undefined}>{p => <input {...p} name="updatedDate" defaultValue={iniciales(accion.doc).updatedDate} type="date" className="input" />}</Campo>
                <Campo id="ed-validUntil" etiqueta="Válido hasta" error={campoError === "validUntil" ? errorAccion : undefined}>{p => <input {...p} name="validUntil" defaultValue={iniciales(accion.doc).validUntil} type="date" className="input" />}</Campo>
              </>
            )}
            <div className="admin-acciones">
              <button type="submit" disabled={guardando} className={`button${accion.tipo === "editar" ? "" : " button-danger"}`}>{guardando ? "Guardando…" : "Confirmar"}</button>
              <button type="button" disabled={guardando} className="button button-secondary" onClick={() => setAccion(null)}>Cancelar</button>
            </div>
          </form>
        )}
      </AdminDialog>
    </main>
  );
}
