import type { ReactNode } from "react";

export type Columna<T> = { clave: string; titulo: string; render: (fila: T) => ReactNode };

/**
 * Tabla accesible: `caption` visible, encabezados `scope="col"` y estado vacío anunciado.
 * Los tableros y las listas la usan también como equivalente textual de cualquier gráfica.
 */
export default function AdminTable<T>({ titulo, columnas, filas, clave, vacio = "No hay elementos para mostrar." }: {
  titulo: string; columnas: Array<Columna<T>>; filas: T[]; clave: (fila: T) => string; vacio?: string;
}) {
  if (filas.length === 0) return <p role="status">{vacio}</p>;
  return (
    <div className="admin-tabla-contenedor" role="region" aria-label={titulo} tabIndex={0}>
      <table className="admin-tabla">
        <caption>{titulo}</caption>
        <thead>
          <tr>{columnas.map(c => <th key={c.clave} scope="col">{c.titulo}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map(f => <tr key={clave(f)}>{columnas.map(c => <td key={c.clave}>{c.render(f)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
