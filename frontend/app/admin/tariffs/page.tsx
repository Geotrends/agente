"use client";

import { useState, type FormEvent } from "react";
import { Campo, ErrorSummary } from "../../../admin/AdminForm";
import { useAdminQuery, QueryState } from "../../../admin/useAdminQuery";
import { fecha, decimal, EnlaceExterno } from "../../../admin/format";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";

type Tarifa = { modelo: string; region: string; moneda: string; version: string; inputPerMillion: string; outputPerMillion: string; vigenteDesde: string; fuente: string };

export default function TarifasAdmin() {
  const [aviso, setAviso] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});

  const { data: respuesta, busy: cargando, error: errorConsulta, announcement: anuncio, cargar } = useAdminQuery<{ items: Tarifa[]; faltantes: string[] }>("/tariffs");
  const items = respuesta?.items;
  const faltantes = respuesta?.faltantes ?? [];

  /** Edita la tarifa vigente (`t`) o registra la primera de un modelo que no tiene (`t` nulo). */
  async function guardar(e: FormEvent<HTMLFormElement>, modelo: string, t: Tarifa | null) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setErrores({}); setAviso("");
    const fuente = String(d.get("sourceUrl") ?? "").trim();
    const r = await llamar("PUT", `/tariffs/${modelo}`, {
      ...(t ? { expectedRevision: t.version } : {}),
      inputPerMillion: String(d.get("inputPerMillion") ?? "").trim(), outputPerMillion: String(d.get("outputPerMillion") ?? "").trim(),
      ...(fuente && fuente !== t?.fuente ? { sourceUrl: fuente } : !t ? { sourceUrl: "" } : {}),
    });
    if (r.ok) { setAviso(`Tarifa de ${modelo} guardada. Rige para consultas recibidas desde ahora; los costos anteriores no cambian.`); await cargar(); return; }
    if (r.error.campo) setErrores({ [`${modelo}-${r.error.campo}`]: r.error.mensaje });
    else setAviso(mensajeError(r.error, r.status));
  }

  const formulario = (modelo: string, t: Tarifa | null) => (
    <section key={modelo} aria-labelledby={`h-${modelo}`}>
      <h2 id={`h-${modelo}`}>{t ? `Editar ${modelo}` : `Registrar tarifa de ${modelo}`}</h2>
      {!t && <p>Este modelo aún no tiene tarifa vigente: sin ella no se calcula su costo. Ingrese los precios publicados por AWS y la página de donde los tomó.</p>}
      <form className="admin-form" noValidate onSubmit={e => { void guardar(e, modelo, t); }}>
        <Campo id={`in-${modelo}`} etiqueta={`Precio de entrada de ${modelo} (USD por millón)`} ayuda="Use punto para los decimales, por ejemplo 0.1500." error={errores[`${modelo}-inputPerMillion`]}>
          {p => <input {...p} name="inputPerMillion" className="input" inputMode="decimal" defaultValue={t?.inputPerMillion} />}
        </Campo>
        <Campo id={`out-${modelo}`} etiqueta={`Precio de salida de ${modelo} (USD por millón)`} ayuda="Use punto para los decimales, por ejemplo 0.6000." error={errores[`${modelo}-outputPerMillion`]}>
          {p => <input {...p} name="outputPerMillion" className="input" inputMode="decimal" defaultValue={t?.outputPerMillion} />}
        </Campo>
        <Campo id={`src-${modelo}`} etiqueta={`Fuente del precio de ${modelo} (https)`} ayuda={t ? "Déjela igual si el precio sale de la misma página." : "Por ejemplo, la página de precios de Amazon Bedrock."} error={errores[`${modelo}-sourceUrl`]}>
          {p => <input {...p} name="sourceUrl" type="url" className="input" defaultValue={t?.fuente} />}
        </Campo>
        <button type="submit" className="button">{t ? `Guardar tarifa de ${modelo}` : `Registrar tarifa de ${modelo}`}</button>
      </form>
    </section>
  );

  return (
    <main className="admin-main admin-main-wide">
      <h1 tabIndex={-1}>Tarifas de los modelos</h1>
      <QueryState busy={cargando} error={errorConsulta} announcement={anuncio} retry={cargar} />
      <p>Precios en USD por millón de tokens, con hasta cuatro decimales. No cambian los costos ya registrados.</p>
      <ErrorSummary errores={errores} idCampo={key => key.endsWith("-inputPerMillion") ? `in-${key.replace(/-inputPerMillion$/, "")}`
        : key.endsWith("-sourceUrl") ? `src-${key.replace(/-sourceUrl$/, "")}` : `out-${key.replace(/-outputPerMillion$/, "")}`} />
      <p role="status" className="admin-aviso">{aviso}</p>
      {faltantes.length > 0 && <p role="alert" className="admin-error">Sin tarifa vigente: {faltantes.join(", ")}. Regístrela más abajo.</p>}
      {items && <AdminTable<Tarifa> ocupado={cargando} titulo="Tarifas vigentes" filas={items} clave={t => t.modelo} columnas={[
        { clave: "m", titulo: "Modelo", fila: true, render: t => t.modelo },
        { clave: "r", titulo: "Región", render: t => t.region },
        { clave: "i", titulo: "Entrada (USD / 1M)", numerica: true, render: t => decimal(t.inputPerMillion) },
        { clave: "o", titulo: "Salida (USD / 1M)", numerica: true, render: t => decimal(t.outputPerMillion) },
        { clave: "v", titulo: "Vigente desde", fecha: true, render: t => fecha(t.vigenteDesde) },
        { clave: "f", titulo: "Fuente", render: t => <EnlaceExterno href={t.fuente}>Ver fuente</EnlaceExterno> },
      ]} />}
      {respuesta && <div className="admin-rejilla">
        {faltantes.map(m => formulario(m, null))}
        {items?.map(t => formulario(t.modelo, t))}
      </div>}
    </main>
  );
}
