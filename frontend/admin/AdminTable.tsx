"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { normalizar, numero } from "./format";

export type Columna<T> = { clave: string; titulo: string; render: (fila: T) => ReactNode; fila?: boolean; numerica?: boolean; movil?: boolean; /** Fecha y hora: columna angosta cuyo texto se parte en líneas. */ fecha?: boolean; ordenar?: (fila: T) => string | number };

/** Native table semantics, legible columns and explicit optional sorting/search. */
export default function AdminTable<T>({ titulo, columnas, filas, clave, vacio = "No hay registros para esta consulta.", ajustada = false, ocupado = false, buscar, alcance = "registros cargados", filaId }: {
  titulo: string; columnas: Array<Columna<T>>; filas: T[]; clave: (fila: T) => string; vacio?: string;
  ajustada?: boolean; ocupado?: boolean; buscar?: (fila: T) => string; alcance?: string; filaId?: (fila: T) => string;
}) {
  const id = useId();
  const [termino, setTermino] = useState("");
  const [orden, setOrden] = useState<{ clave: string; asc: boolean } | null>(null);
  const visibles = useMemo(() => {
    let result = buscar && termino ? filas.filter(f => normalizar(buscar(f)).includes(normalizar(termino))) : [...filas];
    const col = columnas.find(c => c.clave === orden?.clave);
    if (col?.ordenar && orden) result = [...result].sort((a, b) => {
      const x = col.ordenar!(a), y = col.ordenar!(b);
      const comparison = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true, sensitivity: "base" });
      return orden.asc ? comparison : -comparison;
    });
    return result;
  }, [filas, columnas, buscar, termino, orden]);
  const principal = Math.max(0, columnas.findIndex(c => c.fila));
  const acciones = columnas.findIndex(c => c.movil || ["acciones", "acc", "ir"].includes(c.clave));
  const secundaria = acciones >= 0 ? acciones : columnas.findIndex((c, i) => i !== principal && c.numerica);
  const otra = secundaria >= 0 ? secundaria : columnas.findIndex((_, i) => i !== principal);
  const adicionales = columnas.filter((_, i) => i !== principal && i !== otra);
  const clase = (c: Columna<T>, index: number) => `${c.numerica ? "admin-numero" : ""}${c.fecha ? " admin-col-fecha" : ""}${columnas.length > 2 && index !== principal && index !== otra ? " admin-col-secundaria" : ""}`;
  const counts = new Map<string, number>();
  const positions = new Map<T, number>();
  filas.forEach((f, index) => { counts.set(clave(f), (counts.get(clave(f)) ?? 0) + 1); positions.set(f, index); });
  return <div className="admin-tabla-bloque" aria-busy={ocupado}>
    {buscar && <div className="admin-busqueda">
      <label htmlFor={`${id}-buscar`}>Buscar en {titulo.toLocaleLowerCase("es")}</label>
      <input id={`${id}-buscar`} type="search" className="input" value={termino} onChange={e => setTermino(e.target.value)} />
      <p role="status">{numero(visibles.length)} coincidencias en {alcance}.</p>
    </div>}
    {columnas.some(c => c.ordenar) && <p className="admin-tabla-ayuda">El orden se aplica a los {alcance}.</p>}
    <p id={`${id}-ayuda`} className="admin-tabla-ayuda">Si hay columnas fuera de la vista, enfoque la tabla y use las flechas izquierda y derecha para desplazarse.</p>
    <div className={`admin-tabla-contenedor${ajustada ? " admin-tabla-ajustada" : ""}`} role="region" aria-label={titulo} aria-describedby={`${id}-ayuda`} tabIndex={0}>
      <table className="admin-tabla admin-tabla-movil">
        <caption>{titulo}</caption>
        <thead><tr>{columnas.map((c, index) => <th key={c.clave} scope="col" className={clase(c, index)}
          aria-sort={c.ordenar ? (orden?.clave === c.clave ? (orden.asc ? "ascending" : "descending") : "none") : undefined}>
          {c.ordenar ? <button type="button" className="admin-orden" onClick={() => setOrden({ clave: c.clave, asc: orden?.clave === c.clave ? !orden.asc : true })}>
            {c.titulo}<span aria-hidden="true"> {orden?.clave === c.clave ? (orden.asc ? "↑" : "↓") : "↕"}</span><span className="sr-only">: ordenar {orden?.clave === c.clave && orden.asc ? "descendente" : "ascendente"}</span>
          </button> : c.titulo}</th>)}</tr></thead>
        <tbody>{visibles.length === 0 ? <tr><td colSpan={columnas.length}><p role="status">{termino ? "No hay coincidencias. Cambie o borre la búsqueda." : vacio}</p></td></tr> : visibles.map(f => <tr key={(counts.get(clave(f)) ?? 0) > 1 ? `${clave(f)}-${positions.get(f)}` : clave(f)} id={filaId?.(f)} tabIndex={filaId ? -1 : undefined}>{columnas.map((c, index) => {
          const Cell = c.fila ? "th" : "td";
          return <Cell key={c.clave} scope={c.fila ? "row" : undefined} className={clase(c, index)}>{c.render(f)}
            {index === principal && adicionales.length > 0 && <details className="admin-columnas-movil"><summary>Ver columnas adicionales</summary><dl>{adicionales.map(extra => <div key={extra.clave}><dt>{extra.titulo}</dt><dd>{extra.render(f)}</dd></div>)}</dl></details>}
          </Cell>;
        })}</tr>)}</tbody>
      </table>
    </div>
  </div>;
}
