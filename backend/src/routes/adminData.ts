/**
 * Interacciones, exportación y casos de mejora (contracts/interactions-statistics.md): SOLO técnico,
 * respuestas no-store, filtros parametrizados y sin rutas de edición ni borrado de interacciones.
 */
import fs from "node:fs";
import { Router } from "express";
import { pageSize } from "../admin/contracts.js";
import { prepararExportacion } from "../admin/export.js";
import { detalleCaso, listarCasos, transicionarCaso } from "../admin/improvements.js";
import { listarInteracciones, parseFiltro } from "../admin/interactions.js";
import { sessionActive } from "../admin/sessions.js";
import { consumo, documentosCitados, rangoDe, usoGeneral, valoraciones } from "../admin/statistics.js";
import { guardarTarifa, listarTarifas } from "../admin/tariffs.js";
import { requireAdmin, safe } from "./adminAuth.js";

const router = Router();
const tecnico = { perfil: "administrador técnico" } as const;
const lectura = requireAdmin(tecnico);
const escritura = requireAdmin({ ...tecnico, mutation: true });

router.get("/admin/interactions", lectura, safe(async (req, res) => {
  res.json(await listarInteracciones(parseFiltro(req.query), { cursor: req.query.cursor, limit: pageSize(req.query.limit) }));
}));

// Antes de cualquier ruta con :id. El archivo se completa y valida antes de enviar encabezados.
router.get("/admin/interactions/export", lectura, safe(async (req, res) => {
  const filtro = parseFiltro(req.query);
  const token = req.admin!.token;
  const exportacion = await prepararExportacion(filtro, { sesionVigente: () => sessionActive(token) });
  let limpio = false;
  const limpiar = () => { if (!limpio) { limpio = true; void exportacion.limpiar(); } };
  res.on("close", limpiar);
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${exportacion.nombre}"`,
    "Cache-Control": "no-store", "X-Filas": String(exportacion.filas),
  });
  fs.createReadStream(exportacion.ruta).on("error", () => { limpiar(); if (!res.headersSent) res.status(503).end(); else res.destroy(); }).pipe(res);
}));

router.get("/admin/improvements", lectura, safe(async (req, res) => {
  res.json(await listarCasos({
    estado: req.query.estado, tipoFallo: req.query.tipoFallo, desde: req.query.desde, hasta: req.query.hasta,
    origen: req.query.origen, categoria: req.query.categoria, cursor: req.query.cursor, limit: pageSize(req.query.limit),
  }));
}));
router.get("/admin/improvements/:id", lectura, safe(async (req, res) => { res.json(await detalleCaso(req.params.id)); }));
router.post("/admin/improvements/:id/transitions", escritura, safe(async (req, res) => {
  res.json(await transicionarCaso(req.admin!.accountId, req.params.id, req.body));
}));

// ── Tableros y tarifas (US7) ────────────────────────────────────────────────

router.get("/admin/metrics/usage", lectura, safe(async (req, res) => { res.json(await usoGeneral(rangoDe(req.query))); }));
router.get("/admin/metrics/documents", lectura, safe(async (req, res) => { res.json(await documentosCitados(rangoDe(req.query))); }));
router.get("/admin/metrics/ratings", lectura, safe(async (req, res) => { res.json(await valoraciones(rangoDe(req.query))); }));
router.get("/admin/metrics/consumption", lectura, safe(async (req, res) => { res.json(await consumo(rangoDe(req.query))); }));
router.get("/admin/tariffs", lectura, safe(async (_req, res) => { res.json(await listarTarifas()); }));
router.put("/admin/tariffs/:model", escritura, safe(async (req, res) => {
  res.json(await guardarTarifa(req.admin!.accountId, req.params.model, req.body));
}));

export default router;
