import type { ReactNode } from "react";

export const normalizar = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-CO");
export const numero = (value: number) => new Intl.NumberFormat("es-CO").format(value);
/** Format decimal strings without converting monetary values to floating point. */
export function decimal(value: string): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  const [entero, fraccion] = value.split(".");
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (fraccion === undefined ? "" : `,${fraccion}`);
}
export function fecha(value: string | null | undefined, conHora = true): string {
  if (!value || value === "N/A" || value === "—") return "Sin dato";
  const civil = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(civil ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", { timeZone: civil ? "UTC" : "America/Bogota", dateStyle: "medium", ...(!civil && conHora ? { timeStyle: "short" as const } : {}) }).format(date) + (!civil && conHora ? " (Bogotá)" : "");
}
export function EnlaceExterno({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}<span className="sr-only"> (abre en otra pestaña)</span></a>;
}
