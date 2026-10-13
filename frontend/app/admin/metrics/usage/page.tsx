"use client";

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
            <dt>Consultas totales</dt><dd>{d.total}</dd>
            <dt>En conversación (autorizadas)</dt><dd>{d.autorizadas}</dd>
            <dt>Anónimas</dt><dd>{d.anonimas}</dd>
          </dl>
          <p>{d.nota}</p>
          <AdminTable titulo="Consultas por día" filas={d.porDia} clave={x => x.dia} columnas={[
            { clave: "dia", titulo: "Día", render: x => x.dia }, { clave: "n", titulo: "Consultas", render: x => x.consultas }]} />
          <AdminTable titulo="Por categoría (solo conversación)" filas={d.porCategoria} clave={x => x.categoria} columnas={[
            { clave: "c", titulo: "Categoría", render: x => x.categoria }, { clave: "n", titulo: "Consultas", render: x => x.consultas }]} />
          <AdminTable titulo="Por tipo de resultado (solo conversación)" filas={d.porTipo} clave={x => x.tipo} columnas={[
            { clave: "t", titulo: "Tipo", render: x => x.tipo }, { clave: "n", titulo: "Consultas", render: x => x.consultas }]} />
        </>
      )}
    </MetricsView>
  );
}
