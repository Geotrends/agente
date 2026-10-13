"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Campo } from "../../../admin/AdminForm";
import AdminTable from "../../../admin/AdminTable";
import { llamar, mensajeError } from "../../../admin/adminClient";

type Tarifa = { modelo: string; region: string; moneda: string; version: string; inputPerMillion: string; outputPerMillion: string; vigenteDesde: string; fuente: string };

export default function TarifasAdmin() {
  const [items, setItems] = useState<Tarifa[] | null>(null);
  const [faltantes, setFaltantes] = useState<string[]>([]);
  const [aviso, setAviso] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    const r = await llamar<{ items: Tarifa[]; faltantes: string[] }>("GET", "/tariffs");
    if (r.ok) { setItems(r.data.items); setFaltantes(r.data.faltantes); } else setAviso(mensajeError(r.error, r.status));
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar(e: FormEvent<HTMLFormElement>, t: Tarifa) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setErrores({}); setAviso("");
    const r = await llamar("PUT", `/tariffs/${t.modelo}`, {
      expectedRevision: t.version, inputPerMillion: String(d.get("inputPerMillion") ?? ""), outputPerMillion: String(d.get("outputPerMillion") ?? ""),
    });
    if (r.ok) { setAviso(`Tarifa de ${t.modelo} guardada. Rige para consultas recibidas desde ahora; los costos anteriores no cambian.`); await cargar(); return; }
    if (r.error.campo) setErrores({ [`${t.modelo}-${r.error.campo}`]: r.error.mensaje });
    else setAviso(mensajeError(r.error, r.status));
  }

  return (
    <main className="admin-main admin-main-wide">
      <h1>Tarifas de los modelos</h1>
      <p>Precios en USD por millón de tokens, con hasta cuatro decimales. No cambian los costos ya registrados.</p>
      <p role="status" className="admin-aviso">{aviso}</p>
      {faltantes.length > 0 && <p role="alert" className="admin-error">Sin tarifa vigente: {faltantes.join(", ")}.</p>}
      {items && <AdminTable<Tarifa> titulo="Tarifas vigentes" filas={items} clave={t => t.modelo} columnas={[
        { clave: "m", titulo: "Modelo", render: t => t.modelo },
        { clave: "r", titulo: "Región", render: t => t.region },
        { clave: "i", titulo: "Entrada (USD / 1M)", render: t => t.inputPerMillion },
        { clave: "o", titulo: "Salida (USD / 1M)", render: t => t.outputPerMillion },
        { clave: "v", titulo: "Vigente desde", render: t => new Date(t.vigenteDesde).toLocaleString("es-CO") },
      ]} />}
      {items?.map(t => (
        <section key={t.modelo} aria-labelledby={`h-${t.modelo}`}>
          <h2 id={`h-${t.modelo}`}>Editar {t.modelo}</h2>
          <form className="admin-form" noValidate onSubmit={e => { void guardar(e, t); }}>
            <Campo id={`in-${t.modelo}`} etiqueta={`Precio de entrada de ${t.modelo} (USD por millón)`} error={errores[`${t.modelo}-inputPerMillion`]}>
              {p => <input {...p} name="inputPerMillion" className="input" inputMode="decimal" defaultValue={t.inputPerMillion} />}
            </Campo>
            <Campo id={`out-${t.modelo}`} etiqueta={`Precio de salida de ${t.modelo} (USD por millón)`} error={errores[`${t.modelo}-outputPerMillion`]}>
              {p => <input {...p} name="outputPerMillion" className="input" inputMode="decimal" defaultValue={t.outputPerMillion} />}
            </Campo>
            <button type="submit" className="button">Guardar tarifa de {t.modelo}</button>
          </form>
        </section>
      ))}
    </main>
  );
}
