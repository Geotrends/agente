/** Rutas de contactos oficiales (contracts/admin-api.md): solo administrador técnico, con CSRF. */
import { Router, type Response } from "express";
import {
  addImmediate, ContactNotFoundError, ContactValidationError, deleteImmediate, readContactSnapshot,
  reorderImmediate, RevisionConflictError, saveGeneral, saveReception, updateImmediate,
} from "../admin/contacts.js";
import { adminPool } from "../admin/db.js";
import { requireAdmin } from "./adminAuth.js";
import { safeErrorCode } from "../services/safeLog.js";

const router = Router();
const tecnico = { perfil: "administrador técnico" } as const;
const lectura = requireAdmin(tecnico);
const escritura = requireAdmin({ ...tecnico, mutation: true });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, error: unknown): void {
  if (error instanceof ContactValidationError) {
    res.status(422).json({ error: { codigo: "VALIDACION", campo: error.campo, mensaje: error.mensaje } });
  } else if (error instanceof RevisionConflictError) {
    res.status(409).json({ error: { codigo: "REVISION_OBSOLETA", mensaje: "Otra persona modificó los contactos. Recargue y vuelva a intentar." } });
  } else if (error instanceof ContactNotFoundError) {
    res.status(404).json({ error: { codigo: "NO_ENCONTRADO", mensaje: "El canal no existe." } });
  } else {
    console.error("[admin-contactos]", safeErrorCode(error));
    res.status(500).json({ error: { codigo: "ERROR_INTERNO", mensaje: "Ocurrió un error inesperado." } });
  }
}

router.get("/admin/contacts", lectura, async (_req, res) => {
  try {
    const s = await readContactSnapshot(adminPool());
    // Sin datos cargados: se devuelve el estado vacío con su revisión para poder cargarlos.
    if (!s) {
      const { rows } = await adminPool().query("SELECT revision FROM admin.contact_meta WHERE id = 1");
      res.json({ revision: Number(rows[0]?.revision ?? 0), recepcion: null, general: null, inmediatos: [] });
      return;
    }
    res.json(s);
  } catch (e) { fail(res, e); }
});

router.put("/admin/contacts/reception", escritura, async (req, res) => {
  try { res.json({ revision: await saveReception(req.admin!.accountId, req.body) }); } catch (e) { fail(res, e); }
});
router.put("/admin/contacts/general", escritura, async (req, res) => {
  try { res.json({ revision: await saveGeneral(req.admin!.accountId, req.body) }); } catch (e) { fail(res, e); }
});
router.post("/admin/contacts/immediate", escritura, async (req, res) => {
  try { res.status(201).json(await addImmediate(req.admin!.accountId, req.body)); } catch (e) { fail(res, e); }
});
// Antes de /:id para que "order" no se interprete como identificador.
router.put("/admin/contacts/immediate/order", escritura, async (req, res) => {
  try { res.json({ revision: await reorderImmediate(req.admin!.accountId, req.body) }); } catch (e) { fail(res, e); }
});
router.put("/admin/contacts/immediate/:id", escritura, async (req, res) => {
  if (!UUID.test(req.params.id)) { res.status(404).json({ error: { codigo: "NO_ENCONTRADO", mensaje: "El canal no existe." } }); return; }
  try { res.json({ revision: await updateImmediate(req.admin!.accountId, req.params.id, req.body) }); } catch (e) { fail(res, e); }
});
router.delete("/admin/contacts/immediate/:id", escritura, async (req, res) => {
  if (!UUID.test(req.params.id)) { res.status(404).json({ error: { codigo: "NO_ENCONTRADO", mensaje: "El canal no existe." } }); return; }
  try {
    const revision = (req.body as { revision?: unknown } | undefined)?.revision ?? req.query.revision;
    res.json({ revision: await deleteImmediate(req.admin!.accountId, req.params.id, revision) });
  } catch (e) { fail(res, e); }
});

export default router;
