"use client";

import type { ReactNode } from "react";
import AdminShell from "../../admin/AdminShell";

/** Layout del panel: toda pantalla pasa por el cascarón (guarda de sesión, navegación y contadores). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
