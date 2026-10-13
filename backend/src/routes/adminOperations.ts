/**
 * Avisos, contadores, pendientes, auditoría y estado del panel (contracts/operations-contacts.md).
 * Avisos y contadores: ambos perfiles con el MISMO predicado de visibilidad; el resto, solo técnico.
 */
import { Router } from "express";
import { pageSize } from "../admin/contracts.js";
import { contadores, listarAuditoria, listarAvisos, listarPendientes, revisarAviso, type Viewer } from "../admin/inbox.js";
import { operations } from "../admin/operations.js";
import { ultimaReindexacion } from "../admin/documents.js";
import { requireAdmin, safe } from "./adminAuth.js";

const router = Router();
const tecnico = { perfil: "administrador técnico" } as const;
const ambos = requireAdmin({});
const ambosMutacion = requireAdmin({ mutation: true });
const lecturaTecnico = requireAdmin(tecnico);

const viewer = (req: { admin?: { accountId: string; perfil: string } }): Viewer =>
  ({ accountId: req.admin!.accountId, perfil: req.admin!.perfil as Viewer["perfil"] });

router.get("/admin/status", lecturaTecnico, safe(async (req, res) => {
  await operations.hydrate();
  res.json({
    componentes: await operations.status(),
    noRevisadas: (await contadores(viewer(req))).notifications,
    reindexacion: await ultimaReindexacion().catch(() => null),
  });
}));

router.get("/admin/notifications", ambos, safe(async (req, res) => {
  const r = await listarAvisos(viewer(req), { estado: req.query.estado, cursor: req.query.cursor, limit: pageSize(req.query.limit) });
  res.json({ avisos: r.items, items: r.items, total: r.total, noRevisadas: r.noRevisadas, nextCursor: r.nextCursor });
}));

router.post("/admin/notifications/:id/review", ambosMutacion, safe(async (req, res) => {
  const body = (req.body ?? {}) as { expectedRevision?: unknown };
  res.json(await revisarAviso(viewer(req), req.params.id, body.expectedRevision));
}));

router.get("/admin/counters", ambos, safe(async (req, res) => { res.json(await contadores(viewer(req))); }));

router.get("/admin/pending", lecturaTecnico, safe(async (req, res) => {
  res.json(await listarPendientes({ limit: pageSize(req.query.limit), cursor: req.query.cursor }));
}));

router.get("/admin/audit", lecturaTecnico, safe(async (req, res) => {
  res.json(await listarAuditoria({
    usuario: req.query.usuario, accion: req.query.accion, desde: req.query.desde, hasta: req.query.hasta,
    cursor: req.query.cursor, limit: pageSize(req.query.limit),
  }));
}));

export default router;
