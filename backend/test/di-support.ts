import type { ContactSnapshot } from "../src/chat/contracts.js";
import type { RetrievedHit } from "../src/chat/sources.js";

/** Contactos sintéticos de prueba (no son valores oficiales). */
export const CONTACTOS: ContactSnapshot = {
  revision: 7,
  recepcion: { pqrsd: "https://pqrsd.prueba.gov.co/radicar", whatsapp: "+57 300 000 1111", email: "pqrsd@prueba.gov.co" },
  general: { phone: "(604) 000 2222", email: "contacto@prueba.gov.co", url: "https://prueba.gov.co/contacto" },
  inmediatos: [{ id: "i1", name: "Línea de emergencias", description: "Atención 24 horas", type: "teléfono", value: "123", position: 1 }],
};

export function hit(n: number, over: Partial<RetrievedHit> = {}): RetrievedHit {
  return {
    path: `https://prueba.gov.co/doc-${n}.pdf`, snippet: `Contenido del documento ${n}.`, title: `Documento ${n}`,
    sourceUrl: `https://prueba.gov.co/doc-${n}.pdf`, documentId: `doc-${n}`, fechaActualizacion: "2026-03-15", category: "Ecosistemas", ...over,
  };
}
