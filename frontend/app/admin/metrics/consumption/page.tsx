"use client";

import AdminTable from "../../../../admin/AdminTable";
import MetricsView from "../../../../admin/MetricsView";

type Modelo = {
  modelo: string; consultas: number; autorizadas: number; anonimas: number; tokensEntrada: number; tokensSalida: number;
  costoTotal: string; consultasSinCosto: number; costoParcial: boolean;
};
type Consumo = {
  rango: { from: string; to: string }; modelos: Modelo[]; rutaLocal: Modelo;
  total: { consultas: number; tokensEntrada: number; tokensSalida: number; costoTotal: string; consultasSinCosto: number }; nota: string;
};

const usd = (v: string, parcial: boolean) => `USD ${v}${parcial ? " (parcial: hay consultas sin costo)" : ""}`;

export default function ConsumoAdmin() {
  return (
    <MetricsView<Consumo> titulo="Consumo y costo estimado" ruta="consumption">
      {d => (
        <>
          <p>{d.nota}</p>
          <AdminTable titulo="Consumo por modelo" filas={d.modelos} clave={m => m.modelo} columnas={[
            { clave: "m", titulo: "Modelo", render: m => m.modelo },
            { clave: "c", titulo: "Consultas", render: m => `${m.consultas} (${m.autorizadas} en conversación, ${m.anonimas} anónimas)` },
            { clave: "e", titulo: "Tokens de entrada", render: m => m.tokensEntrada },
            { clave: "s", titulo: "Tokens de salida", render: m => m.tokensSalida },
            { clave: "k", titulo: "Costo estimado", render: m => usd(m.costoTotal, m.costoParcial) },
            { clave: "n", titulo: "Consultas sin costo", render: m => m.consultasSinCosto }]} />
          <p>Total: {d.total.consultas} consultas · {d.total.tokensEntrada} tokens de entrada · {d.total.tokensSalida} de salida · {usd(d.total.costoTotal, d.total.consultasSinCosto > 0)}.</p>
          <p>Ruta sin modelo (respuestas locales): {d.rutaLocal.consultas} consultas, costo cero.</p>
        </>
      )}
    </MetricsView>
  );
}
