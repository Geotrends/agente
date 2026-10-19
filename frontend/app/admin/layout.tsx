import type { Metadata } from "next";
import type { ReactNode } from "react";
import AdminShell from "../../admin/AdminShell";

export const metadata: Metadata = { title: { default: "Administración · Panel Geobot", template: "%s · Panel Geobot" } };

/** Layout del panel: toda pantalla pasa por el cascarón (guarda de sesión, navegación y contadores). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
