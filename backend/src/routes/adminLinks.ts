/** Propuestas y enlaces del scraper (contracts/documents-sources.md). */
import { Router } from "express";
import {
  agregarEnlace, aprobarPropuesta, crearPropuesta, listarEnlaces, listarPropuestas, quitarEnlace, rechazarPropuesta, retirarPropuesta,
} from "../admin/links.js";
import { pageSize } from "../admin/contracts.js";
import { requireAdmin, safe } from "./adminAuth.js";

const router = Router();
const ambos = requireAdmin({});
const ambosMutacion = requireAdmin({ mutation: true });
const tecnico = { perfil: "administrador técnico" } as const;
const lecturaTecnico = requireAdmin(tecnico);
const escrituraTecnico = requireAdmin({ ...tecnico, mutation: true });
const esTecnico = (perfil: string) => perfil === "administrador técnico";

router.get("/admin/link-proposals", ambos, safe(async (req, res) => {
  const a = req.admin!;
  res.json(await listarPropuestas(a.accountId, esTecnico(a.perfil), {
    state: req.query.state, owner: req.query.owner, cursor: req.query.cursor, limit: pageSize(req.query.limit),
  }));
}));
router.post("/admin/link-proposals", ambosMutacion, safe(async (req, res) => {
  res.status(201).json(await crearPropuesta(req.admin!.accountId, req.admin!.displayName, req.body));
}));
router.post("/admin/link-proposals/:id/withdraw", ambosMutacion, safe(async (req, res) => {
  res.json(await retirarPropuesta(req.admin!.accountId, req.params.id, req.body));
}));
router.post("/admin/link-proposals/:id/approve", escrituraTecnico, safe(async (req, res) => {
  res.json(await aprobarPropuesta(req.admin!.accountId, req.admin!.displayName, req.params.id, req.body));
}));
router.post("/admin/link-proposals/:id/reject", escrituraTecnico, safe(async (req, res) => {
  res.json(await rechazarPropuesta(req.admin!.accountId, req.admin!.displayName, req.params.id, req.body));
}));

router.get("/admin/scraper-links", lecturaTecnico, safe(async (_req, res) => { res.json(await listarEnlaces()); }));
router.post("/admin/scraper-links", escrituraTecnico, safe(async (req, res) => {
  res.status(201).json(await agregarEnlace(req.admin!.accountId, req.admin!.displayName, req.body));
}));
router.delete("/admin/scraper-links/:id", escrituraTecnico, safe(async (req, res) => {
  res.json(await quitarEnlace(req.admin!.accountId, req.admin!.displayName, req.params.id, req.body));
}));

export default router;
