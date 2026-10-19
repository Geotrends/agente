"use client";

import { useState, type FormEvent } from "react";
import { Campo } from "../../../admin/AdminForm";
import { useAdminQuery, QueryState, useDebounced } from "../../../admin/useAdminQuery";
import { fecha } from "../../../admin/format";
import AdminTable from "../../../admin/AdminTable";

type Fila = { id: string; actor: { id: string | null; nombre: string | null; rol: string | null }; accion: string; objeto: string; objetoId: string | null; resultado: string; fecha: string };
type Lista = { items: Fila[]; total: number; nextCursor: string | null };
type Cuenta = { id: string; nombre: string; email: string };

const ACCIONES = [
  ["sesion.inicio", "Iniciar sesión"], ["cuenta.bloqueo", "Bloquear cuenta"], ["cuenta.cambio_contrasena", "Cambiar contraseña"], ["mejora.transicion", "Avanzar caso de mejora"],
  ["cuenta.crear", "Crear cuenta"], ["cuenta.reactivar", "Reactivar cuenta"], ["cuenta.desactivar", "Desactivar cuenta"], ["cuenta.cambiar_perfil", "Cambiar perfil"], ["cuenta.contrasena_temporal", "Asignar contraseña temporal"],
  ["documento.cargar", "Cargar documento"], ["documento.publicar", "Publicar documento"], ["documento.rechazar", "Rechazar versión"], ["documento.retirar", "Retirar documento"], ["documento.editar_metadata", "Editar datos del documento"], ["documento.reindexar", "Reindexar base"], ["documento.reanudar_operacion", "Reanudar operación"],
  ["propuesta.crear", "Crear propuesta"], ["propuesta.aprobar", "Aprobar propuesta"], ["propuesta.rechazar", "Rechazar propuesta"], ["propuesta.retirar", "Retirar propuesta"], ["enlace.agregar", "Agregar enlace"], ["enlace.quitar", "Quitar enlace"],
  ["contactos.recepcion.editar", "Editar recepción"], ["contactos.general.editar", "Editar contacto general"], ["contactos.inmediato.crear", "Crear canal"], ["contactos.inmediato.editar", "Editar canal"], ["contactos.inmediato.eliminar", "Eliminar canal"], ["contactos.inmediato.ordenar", "Ordenar canales"], ["tarifa.editar", "Editar tarifa"],
];

export default function AuditoriaAdmin() {
  const [busquedaCuenta, setBusquedaCuenta] = useState("");
  const [seleccionCuenta, setSeleccionCuenta] = useState<Cuenta | null>(null);
  const terminoCuenta = useDebounced(busquedaCuenta.trim());
  const { data: paginaCuentas, busy: buscandoCuentas, error: errorCuentas, cargar: cargarCuentas } = useAdminQuery<{ items: Cuenta[]; total: number; nextCursor: string | null }>(`/accounts?limit=100${terminoCuenta ? `&search=${encodeURIComponent(terminoCuenta)}` : ""}`);
  const cuentas = paginaCuentas?.items ?? [];
  const opciones = seleccionCuenta && !cuentas.some(c => c.id === seleccionCuenta.id) ? [seleccionCuenta, ...cuentas] : cuentas;
  const [filtros, setFiltros] = useState({ usuario: "", accion: "", desde: "", hasta: "" });

  const { data: datos, busy: cargando, error: error, announcement: anuncio, cargar } = useAdminQuery<Lista>(`/audit?${new URLSearchParams({ limit: "50", ...Object.fromEntries(Object.entries(filtros).filter(([,v]) => v)) })}`);


  function aplicar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setFiltros({ usuario: String(d.get("usuario") ?? ""), accion: String(d.get("accion") ?? ""), desde: String(d.get("desde") ?? ""), hasta: String(d.get("hasta") ?? "") });
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1 tabIndex={-1}>Auditoría</h1>
      <QueryState busy={cargando} error={error} announcement={anuncio} retry={cargar} />
      <p>Registro de solo lectura: no contiene contraseñas ni contenido de documentos.</p>
      <p>El ordenamiento y la carga incremental conservan los filtros aplicados.</p>
      <form className="admin-filtros" onSubmit={aplicar} aria-label="Filtros de auditoría">
        <Campo id="aud-buscar-cuenta" etiqueta="Buscar usuario por nombre o correo">
          {p => <input {...p} type="search" className="input" value={busquedaCuenta} onChange={e => setBusquedaCuenta(e.target.value)} />}
        </Campo>
        <p role="status">{buscandoCuentas ? "Buscando usuarios…" : `${cuentas.length} usuarios cargados.`}</p>
        {errorCuentas && <><p role="alert">{errorCuentas}</p><button type="button" className="button button-secondary" onClick={() => { void cargarCuentas(); }}>Reintentar búsqueda de usuarios</button></>}
        {paginaCuentas?.nextCursor && <button type="button" className="button button-secondary" disabled={buscandoCuentas} onClick={() => { void cargarCuentas(paginaCuentas.nextCursor!); }}>Cargar más usuarios</button>}
        <Campo id="aud-usuario" etiqueta="Usuario">
          {p => <select {...p} name="usuario" className="input" value={seleccionCuenta?.id ?? ""} onChange={e => setSeleccionCuenta(opciones.find(c => c.id === e.target.value) ?? (e.target.value ? { id: e.target.value, nombre: "Recuperación reservada", email: "" } : null))}><option value="">Todos</option>
            {opciones.filter(c => c.id !== "contractor_recovery").map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.email})</option>)}
            <option value="contractor_recovery">Recuperación reservada (contractor_recovery)</option></select>}
        </Campo>
        <Campo id="aud-accion" etiqueta="Acción">
          {p => <select {...p} name="accion" className="input" defaultValue=""><option value="">Todas</option>{ACCIONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
        </Campo>
        <Campo id="aud-desde" etiqueta="Desde">{p => <input {...p} name="desde" type="date" className="input" />}</Campo>
        <Campo id="aud-hasta" etiqueta="Hasta">{p => <input {...p} name="hasta" type="date" className="input" />}</Campo>
        <button type="submit" className="button">Filtrar</button>
      </form>
      {datos && (
        <>
          <p>{datos.total} registros.</p>
          <AdminTable<Fila> ocupado={cargando} titulo="Registro de auditoría" filas={datos.items} clave={f => f.id} vacio="No hay registros para ese filtro."
            columnas={[
              { clave: "fecha", titulo: "Fecha y hora", fecha: true, render: f => fecha(f.fecha) },
              { clave: "actor", titulo: "Usuario o rol", render: f => f.actor.nombre ?? f.actor.rol ?? f.actor.id ?? "Sin dato" },
              { clave: "accion", titulo: "Acción", render: f => ACCIONES.find(a => a[0] === f.accion)?.[1] ?? f.accion },
              { clave: "objeto", titulo: "Objeto", render: f => `${f.objeto}${f.objetoId ? ` · ${f.objetoId}` : ""}` },
              { clave: "res", titulo: "Resultado", render: f => f.resultado },
            ]} />
          {datos.nextCursor && <button type="button" className="button button-secondary" disabled={cargando} onClick={() => { void cargar(datos.nextCursor!); }}>Cargar más registros</button>}
        </>
      )}
    </main>
  );
}
