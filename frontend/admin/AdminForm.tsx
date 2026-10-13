import type { ReactNode } from "react";

/** Campo con etiqueta, ayuda y error asociados (aria-describedby / aria-invalid). */
export function Campo({ id, etiqueta, error, ayuda, children }: {
  id: string; etiqueta: string; error?: string; ayuda?: string;
  children: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
}) {
  const describe = [ayuda ? `${id}-ayuda` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="admin-campo">
      <label htmlFor={id}>{etiqueta}</label>
      {children({ id, ...(error ? { "aria-invalid": true as const } : {}), ...(describe ? { "aria-describedby": describe } : {}) })}
      {ayuda && <p id={`${id}-ayuda`}>{ayuda}</p>}
      {error && <p id={`${id}-error`} className="admin-error" role="alert">{error}</p>}
    </div>
  );
}

export function AdminForm({ onSubmit, children, etiqueta }: { onSubmit: (datos: FormData) => void; children: ReactNode; etiqueta: string }) {
  return (
    <form className="admin-form" aria-label={etiqueta} noValidate onSubmit={e => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)); }}>
      {children}
    </form>
  );
}
