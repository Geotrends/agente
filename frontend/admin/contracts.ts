/**
 * Contratos del panel compartidos por todas las pantallas (SPEC007). Reflejan los DTO del backend;
 * la fuente de verdad son los contratos en `specs/007-administracion-c3-c4/contracts/`.
 */
import type { PerfilAdmin } from "../shared/adminSession";

export type { PerfilAdmin };

export type Contadores = { notifications: number; pending?: number; openImprovements?: number };

export type ItemNavegacion = {
  href: string;
  etiqueta: string;
  /** Perfiles con acceso. La API es la autoridad: esto solo evita mostrar enlaces inútiles. */
  perfiles: readonly PerfilAdmin[];
  /** Clave del contador que se muestra junto al enlace. */
  contador?: keyof Contadores;
};

const TECNICO: PerfilAdmin = "administrador técnico";
const GESTOR: PerfilAdmin = "Gestor documental";

export const NAVEGACION: readonly ItemNavegacion[] = [
  { href: "/admin/documents", etiqueta: "Documentos", perfiles: [TECNICO, GESTOR] },
  { href: "/admin/proposals", etiqueta: "Propuestas", perfiles: [TECNICO, GESTOR] },
  { href: "/admin/pending", etiqueta: "Pendientes", perfiles: [TECNICO], contador: "pending" },
  { href: "/admin/links", etiqueta: "Enlaces", perfiles: [TECNICO] },
  { href: "/admin/contacts", etiqueta: "Contactos", perfiles: [TECNICO] },
  { href: "/admin/notifications", etiqueta: "Avisos", perfiles: [TECNICO, GESTOR], contador: "notifications" },
  { href: "/admin/status", etiqueta: "Estado", perfiles: [TECNICO] },
  { href: "/admin/audit", etiqueta: "Auditoría", perfiles: [TECNICO] },
  { href: "/admin/interactions", etiqueta: "Interacciones", perfiles: [TECNICO] },
  { href: "/admin/improvements", etiqueta: "Mejoras", perfiles: [TECNICO], contador: "openImprovements" },
  { href: "/admin/metrics/usage", etiqueta: "Uso", perfiles: [TECNICO] },
  { href: "/admin/metrics/documents", etiqueta: "Documentos citados", perfiles: [TECNICO] },
  { href: "/admin/metrics/ratings", etiqueta: "Utilidad", perfiles: [TECNICO] },
  { href: "/admin/metrics/consumption", etiqueta: "Consumo y costo", perfiles: [TECNICO] },
  { href: "/admin/tariffs", etiqueta: "Tarifas", perfiles: [TECNICO] },
  { href: "/admin/accounts", etiqueta: "Cuentas", perfiles: [TECNICO] },
  { href: "/admin/password", etiqueta: "Contraseña", perfiles: [TECNICO, GESTOR] },
];

export const RUTAS_SIN_SESION = ["/admin/login"] as const;

/** Pantalla de entrada tras iniciar sesión (según perfil). */
export function pantallaInicial(perfil: PerfilAdmin): string {
  return "/admin/documents";
}
