import type { ReactNode } from "react";
import { safeHttpsUrl } from "./safeUrl";

export const NEW_TAB_SUFFIX = " (se abre en una pestaña nueva)";

type Props = {
  href: string;
  children: ReactNode;
  /** Texto plano equivalente al contenido, para el nombre accesible. */
  label: string;
  /** Dentro del contenido de una respuesta no se permiten `span` ni `svg`: el indicador es texto. */
  inResponse?: boolean;
  className?: string;
};

/**
 * Único enlace externo de Geobot (RF-C4-UI-04): abre en pestaña nueva con `noopener noreferrer`,
 * nombre accesible con «(se abre en una pestaña nueva)» e indicador visual externo. Un href que no
 * sea https absoluta no se renderiza como enlace: queda como texto.
 */
export function ExternalLink({ href, children, label, inResponse = false, className }: Props) {
  const safe = safeHttpsUrl(href);
  if (!safe) return <>{children}</>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label}${NEW_TAB_SUFFIX}`}
      className={className}
    >
      {children}
      {inResponse ? " ↗" : <span aria-hidden="true" className="external-indicator"> ↗</span>}
    </a>
  );
}
