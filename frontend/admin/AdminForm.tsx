"use client";

import { useEffect, useRef, isValidElement, type ReactNode } from "react";

/** Campo con etiqueta, ayuda y error asociados (aria-describedby / aria-invalid). */
export function Campo({ id, etiqueta, error, ayuda, children }: {
  id: string; etiqueta: string; error?: string; ayuda?: string;
  children: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
}) {
  const describe = [ayuda ? `${id}-ayuda` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const control = children({ id, ...(error ? { "aria-invalid": true as const } : {}), ...(describe ? { "aria-describedby": describe } : {}) });
  const required = isValidElement<{ required?: boolean }>(control) && control.props.required;
  return (
    <div className="admin-campo">
      <label htmlFor={id}>{etiqueta}{required && !/obligatori/i.test(etiqueta) && <span className="admin-obligatorio" aria-hidden="true"> *</span>}</label>
      {control}
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


export function ErrorSummary({ errores, prefijo = "", idCampo }: { errores: Record<string, string>; prefijo?: string; idCampo?: (key: string) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const signature = JSON.stringify(errores);
  useEffect(() => { if (Object.keys(errores).length) ref.current?.focus(); }, [signature]);
  if (!Object.keys(errores).length) return null;
  return <div ref={ref} tabIndex={-1} className="admin-error-resumen" aria-label="Resumen de errores">
    <p>Revise los siguientes campos:</p>
    <ul>{Object.entries(errores).map(([key, message]) => {
      const id = idCampo ? idCampo(key) : `${prefijo}${key}`;
      return <li key={key}><a href={`#${id}`} onClick={e => { e.preventDefault(); document.getElementById(id)?.focus(); }}>{message}</a></li>;
    })}</ul>
  </div>;
}
