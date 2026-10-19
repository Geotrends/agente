"use client";

import { fecha, numero } from "../../../../admin/format";

import AdminTable from "../../../../admin/AdminTable";
import MetricsView from "../../../../admin/MetricsView";

type Uso = {
  rango: { from: string; to: string }; total: number; autorizadas: number; anonimas: number;
  porDia: Array<{ dia: string; consultas: number }>; porCategoria: Array<{ categoria: string; consultas: number }>;
  porTipo: Array<{ tipo: string; consultas: number }>; nota: string;
};

export default function UsoAdmin() {
  return (
    <MetricsView<Uso> titulo="Uso del servicio" ruta="usage">
      {d => (
        <>
          <dl>
            <dt>Consultas totales</dt><dd>{numero(d.total)}</dd>
            <dt>En conversación (autorizadas)</dt><dd>{numero(d.autorizadas)}</dd>
            <dt>Anónimas</dt><dd>{numero(d.anonimas)}</dd>
          </dl>
          <p>{d.nota}</p>
          <AdminTable titulo="Consultas por día" filas={d.porDia} clave={x => x.dia} columnas={[
            { clave: "dia", titulo: "Día", fila: true, fecha: true, render: x => fecha(x.dia, false) }, { clave: "n", titulo: "Consultas", numerica: true, ordenar: x => x.consultas, render: x => numero(x.consultas) }]} />
          <AdminTable titulo="Por categoría (solo conversación)" filas={d.porCategoria} clave={x => x.categoria} columnas={[
            { clave: "c", titulo: "Categoría", fila: true, render: x => x.categoria }, { clave: "n", titulo: "Consultas", numerica: true, ordenar: x => x.consultas, render: x => numero(x.consultas) }]} />
          <AdminTable titulo="Por tipo de resultado (solo conversación)" filas={d.porTipo} clave={x => x.tipo} columnas={[
            { clave: "t", titulo: "Tipo", fila: true, render: x => x.tipo }, { clave: "n", titulo: "Consultas", numerica: true, ordenar: x => x.consultas, render: x => numero(x.consultas) }]} />
        </>
      )}
    </MetricsView>
  );
}
