"use client";

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
            <dt>Valoraciones</dt><dd>{d.total}</dd>
            <dt>Útil</dt><dd>{d.util} ({d.porcentajeUtil} %)</dd>
            <dt>No útil</dt><dd>{d.noUtil} ({d.porcentajeNoUtil} %)</dd>
          </dl>
          <p>{d.nota}</p>
          <AdminTable titulo="Motivos de «No útil»" filas={d.motivos} clave={x => x.motivo} columnas={[
            { clave: "m", titulo: "Motivo", render: x => x.motivo }, { clave: "c", titulo: "Cantidad", render: x => x.cantidad }]} />
        </>
      )}
    </MetricsView>
  );
}
