import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ReactNode } from "react";

export const metadata: Metadata = {
  // El título es lo primero que anuncia un lector de pantalla (WCAG 2.4.2).
  title: "Geobot · Observatorio Ambiental de Envigado",
  description: "Orientación sobre trámites, requisitos y canales de atención de Ecosistemas, Bienestar Animal y Gestión Ambiental del Municipio de Envigado."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
