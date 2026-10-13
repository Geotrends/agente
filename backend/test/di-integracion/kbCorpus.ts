/** Corpus sintético de la matriz documental y oro de calibración para las pruebas de recuperación. */
import { randomUUID } from "node:crypto";
import type { Pool } from "../../src/kb/db.js";

export const DOCS: Array<{ nombre: string; texto: string }> = [
  { nombre: "Registro de mascotas RUM", texto: "# Registro Único Municipal\n\nPara registrar una mascota en el RUM presente la cédula del propietario, el carnet de vacunación y una fotografía del animal. El trámite es gratuito y se realiza en la Secretaría de Medio Ambiente." },
  { nombre: "Adopción de mascotas", texto: "# Adopción\n\nLa adopción de una mascota exige diligenciar el formato de solicitud, recibir una visita domiciliaria y firmar el compromiso de tenencia responsable de animales de compañía." },
  { nombre: "Poda de árboles", texto: "# Poda de árboles\n\nLa poda o tala de árboles en espacio público requiere solicitud previa a la autoridad ambiental, visita técnica y concepto favorable del funcionario competente." },
  { nombre: "Denuncia de maltrato animal", texto: "# Maltrato animal\n\nPara denunciar el maltrato animal comunique el hecho por la línea de atención o radique una queja con descripción de lo ocurrido, lugar y fecha." },
  { nombre: "Licencia ambiental", texto: "# Licencia ambiental\n\nLos proyectos que puedan generar deterioro grave a los recursos naturales requieren licencia ambiental previa, con estudio de impacto y concepto técnico." },
  { nombre: "Calidad del aire", texto: "# Calidad del aire\n\nEl boletín mensual de calidad del aire reporta material particulado PM2.5 y PM10 medido por las estaciones de monitoreo del Valle de Aburrá." },
];

export async function sembrar(kb: Pool): Promise<void> {
  for (const [i, d] of DOCS.entries()) {
    const clave = `https://ambientometroenvigado.com/doc-${i}/`;
    const { rows: [el] } = await kb.query(
      `INSERT INTO kb.kb_elemento (clave, codigo, nombre, tipo, direccion, url_origen, estado, formato_original, procedimientos_origen, fuente)
       VALUES ($1, NULL, $2, 'pagina', 'ecosistemas', $1, 'publicado', 'html', ARRAY['Ambientómetro'], 'ambientometro') RETURNING id`, [clave, d.nombre]);
    const { rows: [v] } = await kb.query(
      `INSERT INTO kb.kb_version (elemento_id, hash_contenido, contenido_md, fecha_acceso) VALUES ($1, $2, $3, now()) RETURNING id`,
      [el.id, randomUUID().replace(/-/g, "").padEnd(64, "0"), d.texto]);
    await kb.query("UPDATE kb.kb_elemento SET version_publicada_id = $2 WHERE id = $1", [el.id, v.id]);
  }
}


export const ORO = {
  cases: [
    { id: "f1", kind: "factual" as const, query: "¿Qué necesito para registrar una mascota en el RUM?" },
    { id: "f2", kind: "factual" as const, query: "¿Cómo denuncio el maltrato animal?" },
    { id: "f3", kind: "factual" as const, query: "¿Qué exige la adopción de una mascota?" },
    { id: "a1", kind: "abstention" as const, query: "¿Cuál es la receta del sancocho antioqueño?" },
    { id: "a2", kind: "abstention" as const, query: "¿Quién ganó el mundial de fútbol de 1986?" },
  ],
};
