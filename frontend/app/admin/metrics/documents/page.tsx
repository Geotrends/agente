"use client";


import AdminTable from "../../../../admin/AdminTable";
import MetricsView from "../../../../admin/MetricsView";

type Docs = {
  rango: { from: string; to: string }; respuestasConCitas: number;
  ranking: Array<{ posicion: number; nombre: string; direccion: string | null; citas: number }>;
  anonymousCoverage: string; nota: string;
};

export default function DocumentosCitadosAdmin() {
  return (
    <MetricsView<Docs> titulo="Documentos más citados" ruta="documents">
      {d => (
        <>
          <p>Respuestas con documentos citados: {d.respuestasConCitas}.</p>
          <p role="note">{d.nota}</p>
          <AdminTable titulo="Diez documentos más citados" filas={d.ranking} clave={x => `${x.posicion}-${x.nombre}`} columnas={[
            { clave: "p", titulo: "Posición", render: x => x.posicion },
            { clave: "n", titulo: "Documento", fila: true, render: x => x.nombre },
            { clave: "d", titulo: "Dirección", render: x => x.direccion ?? "No disponible" },
            { clave: "c", titulo: "Citas", render: x => x.citas }]} />
        </>
      )}
    </MetricsView>
  );
}
