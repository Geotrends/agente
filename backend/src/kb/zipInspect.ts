/**
 * Inspección estructural de archivos ZIP (DOCX/XLSX) sin descomprimirlos (SPEC007 T031, R06).
 *
 * Lee el directorio central: número de entradas, tamaño expandido total y razón de expansión
 * (defensa contra bombas de descompresión) y comprueba las partes mínimas que distinguen un DOCX
 * o un XLSX reales del tipo MIME que declare el cliente.
 */
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import zlib from "node:zlib";

export type LimitesZip = { maxEntradas: number; maxExpandido: number; maxRazon: number };

/** Entrada del directorio central: lo necesario para verificar su expansión real. */
export type EntradaZip = { nombre: string; metodo: number; comprimido: number; declarado: number; offsetLocal: number };

export type InspeccionZip =
  | { ok: true; entradas: number; expandido: number; nombres: string[]; detalle: EntradaZip[] }
  | { ok: false; motivo: "no_es_zip" | "demasiadas_entradas" | "expansion_excesiva" | "razon_excesiva" | "dañado" };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

export async function inspeccionarZip(ruta: string, limites: LimitesZip): Promise<InspeccionZip> {
  const fh = await fs.open(ruta, "r");
  try {
    const { size } = await fh.stat();
    if (size < 22) return { ok: false, motivo: "no_es_zip" };
    const cola = Buffer.alloc(Math.min(size, 65_557));
    await fh.read(cola, 0, cola.length, size - cola.length);
    let eocd = -1;
    for (let i = cola.length - 22; i >= 0; i--) {
      if (cola.readUInt32LE(i) === EOCD) { eocd = i; break; }
    }
    if (eocd < 0) return { ok: false, motivo: "no_es_zip" };
    const total = cola.readUInt16LE(eocd + 10);
    const tamCentral = cola.readUInt32LE(eocd + 12);
    const offCentral = cola.readUInt32LE(eocd + 16);
    if (total === 0xffff || tamCentral === 0xffffffff || offCentral === 0xffffffff) return { ok: false, motivo: "no_es_zip" };
    if (total > limites.maxEntradas) return { ok: false, motivo: "demasiadas_entradas" };
    if (offCentral + tamCentral > size) return { ok: false, motivo: "dañado" };
    const central = Buffer.alloc(tamCentral);
    await fh.read(central, 0, tamCentral, offCentral);
    let pos = 0; let expandido = 0; let comprimido = 0;
    const nombres: string[] = [];
    const detalle: EntradaZip[] = [];
    for (let n = 0; n < total; n++) {
      if (pos + 46 > central.length || central.readUInt32LE(pos) !== CENTRAL) return { ok: false, motivo: "dañado" };
      const comp = central.readUInt32LE(pos + 20);
      const desc = central.readUInt32LE(pos + 24);
      const lNombre = central.readUInt16LE(pos + 28);
      const lExtra = central.readUInt16LE(pos + 30);
      const lComent = central.readUInt16LE(pos + 32);
      const nombre = central.toString("utf8", pos + 46, pos + 46 + lNombre);
      nombres.push(nombre);
      detalle.push({ nombre, metodo: central.readUInt16LE(pos + 10), comprimido: comp, declarado: desc, offsetLocal: central.readUInt32LE(pos + 42) });
      expandido += desc; comprimido += comp;
      if (expandido > limites.maxExpandido) return { ok: false, motivo: "expansion_excesiva" };
      pos += 46 + lNombre + lExtra + lComent;
    }
    if (comprimido > 0 && expandido / comprimido > limites.maxRazon) return { ok: false, motivo: "razon_excesiva" };
    return { ok: true, entradas: total, expandido, nombres, detalle };
  } finally {
    await fh.close();
  }
}

/**
 * Expansión REAL (SPEC008, NV-05). El directorio central lo escribe quien sube el archivo: sus
 * tamaños declarados no prueban nada. Aquí cada entrada se descomprime en flujo, sin guardarla,
 * contando bytes y cortando al pasar el tope total o la razón de expansión. Devuelve el total real.
 */
export async function verificarExpansionReal(
  ruta: string, detalle: EntradaZip[], limites: LimitesZip,
): Promise<{ ok: true; expandido: number } | { ok: false; motivo: "expansion_excesiva" | "razon_excesiva" | "dañado" }> {
  const { size } = await fs.stat(ruta);
  const fh = await fs.open(ruta, "r");
  let real = 0;
  try {
    for (const e of detalle) {
      if (e.nombre.endsWith("/")) continue;
      if (e.metodo !== 0 && e.metodo !== 8) return { ok: false, motivo: "dañado" };
      const local = Buffer.alloc(30);
      const { bytesRead } = await fh.read(local, 0, 30, e.offsetLocal);
      if (bytesRead < 30 || local.readUInt32LE(0) !== 0x04034b50) return { ok: false, motivo: "dañado" };
      const inicio = e.offsetLocal + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (inicio + e.comprimido > size) return { ok: false, motivo: "dañado" };
      if (e.comprimido === 0) continue;
      if (e.metodo === 0) {
        real += e.comprimido;
      } else {
        const flujo = createReadStream(ruta, { start: inicio, end: inicio + e.comprimido - 1 }).pipe(zlib.createInflateRaw());
        try {
          for await (const trozo of flujo as AsyncIterable<Buffer>) {
            real += trozo.length;
            if (real > limites.maxExpandido) { flujo.destroy(); return { ok: false, motivo: "expansion_excesiva" }; }
          }
        } catch {
          return { ok: false, motivo: "dañado" };
        }
      }
      if (real > limites.maxExpandido) return { ok: false, motivo: "expansion_excesiva" };
    }
  } finally {
    await fh.close();
  }
  if (size > 0 && real / size > limites.maxRazon) return { ok: false, motivo: "razon_excesiva" };
  return { ok: true, expandido: real };
}

export type FormatoCarga = "pdf" | "docx" | "xlsx";

/** Formato real por estructura (no por el MIME declarado). null si no es PDF/DOCX/XLSX. */
export async function detectarFormato(ruta: string, limites: LimitesZip): Promise<{ formato: FormatoCarga } | { error: string }> {
  const fh = await fs.open(ruta, "r");
  let cabecera: Buffer;
  try {
    cabecera = Buffer.alloc(8);
    await fh.read(cabecera, 0, 8, 0);
  } finally { await fh.close(); }
  if (cabecera.subarray(0, 5).toString("latin1") === "%PDF-") return { formato: "pdf" };
  if (cabecera.readUInt32LE(0) !== 0x04034b50) return { error: "El archivo no es un PDF, DOCX ni XLSX válido." };
  const z = await inspeccionarZip(ruta, limites);
  const real = z.ok ? await verificarExpansionReal(ruta, z.detalle, limites) : undefined;
  if (z.ok && real && !real.ok) {
    return { error: real.motivo === "dañado" ? "El archivo está dañado o no es un DOCX/XLSX válido."
      : "El archivo comprimido supera los límites de seguridad permitidos." };
  }
  if (!z.ok) {
    const msg = z.motivo === "no_es_zip" || z.motivo === "dañado" ? "El archivo está dañado o no es un DOCX/XLSX válido."
      : "El archivo comprimido supera los límites de seguridad permitidos.";
    return { error: msg };
  }
  if (z.nombres.includes("word/document.xml") && z.nombres.includes("[Content_Types].xml")) return { formato: "docx" };
  if (z.nombres.includes("xl/workbook.xml") && z.nombres.includes("[Content_Types].xml")) return { formato: "xlsx" };
  return { error: "El archivo no es un DOCX ni un XLSX válido." };
}
