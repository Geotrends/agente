"use client";

import { numero } from "../../../../admin/format";

import AdminTable from "../../../../admin/AdminTable";
import MetricsView from "../../../../admin/MetricsView";

type Val = {
  rango: { from: string; to: string }; total: number; util: number; noUtil: number; porcentajeUtil: number; porcentajeNoUtil: number;
  motivos: Array<{ motivo: string; cantidad: number }>; nota: string;
};

export default function ValoracionesAdmin() {
  return (
    <MetricsView<Val> titulo="Utilidad de las respuestas" ruta="ratings">
      {d => (
        <>
          <dl>
            <dt>Valoraciones</dt><dd>{numero(d.total)}</dd>
            <dt>Útil</dt><dd>{numero(d.util)} ({d.porcentajeUtil} %)</dd>
            <dt>No útil</dt><dd>{numero(d.noUtil)} ({d.porcentajeNoUtil} %)</dd>
          </dl>
          <p>{d.nota}</p>
          <AdminTable titulo="Motivos de «No útil»" filas={d.motivos} clave={x => x.motivo} columnas={[
            { clave: "m", titulo: "Motivo", fila: true, render: x => x.motivo }, { clave: "c", titulo: "Cantidad", numerica: true, ordenar: x => x.cantidad, render: x => numero(x.cantidad) }]} />
        </>
      )}
    </MetricsView>
  );
}
