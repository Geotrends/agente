"use client";

import { numero, decimal } from "../../../../admin/format";

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

const usd = (v: string, parcial: boolean) => `USD ${decimal(v)}${parcial ? " (parcial: hay consultas sin costo)" : ""}`;

export default function ConsumoAdmin() {
  return (
    <MetricsView<Consumo> titulo="Consumo y costo estimado" ruta="consumption">
      {d => (
        <>
          <p>{d.nota}</p>
          <AdminTable titulo="Consumo por modelo" filas={d.modelos} clave={m => m.modelo} columnas={[
            { clave: "m", titulo: "Modelo", fila: true, render: m => m.modelo },
            { clave: "c", titulo: "Consultas", render: m => `${numero(m.consultas)} (${numero(m.autorizadas)} en conversación, ${numero(m.anonimas)} anónimas)` },
            { clave: "e", titulo: "Tokens de entrada", numerica: true, ordenar: m => m.tokensEntrada, render: m => numero(m.tokensEntrada) },
            { clave: "s", titulo: "Tokens de salida", numerica: true, ordenar: m => m.tokensSalida, render: m => numero(m.tokensSalida) },
            { clave: "k", titulo: "Costo estimado", movil: true, numerica: true, render: m => usd(m.costoTotal, m.costoParcial) },
            { clave: "n", titulo: "Consultas sin costo", numerica: true, render: m => numero(m.consultasSinCosto) }]} />
          <p>Total: {numero(d.total.consultas)} consultas · {numero(d.total.tokensEntrada)} tokens de entrada · {numero(d.total.tokensSalida)} de salida · {usd(d.total.costoTotal, d.total.consultasSinCosto > 0)}.</p>
          <p>Ruta sin modelo (respuestas locales): {numero(d.rutaLocal.consultas)} consultas, costo cero.</p>
        </>
      )}
    </MetricsView>
  );
}
