/** Documentos del panel (contracts/documents-sources.md): matriz y carga para ambos perfiles; acciones solo técnico. */
import { Router } from "express";
import {
  editarMetadata, listarDocumentos, obtenerOperacion, publicarDocumento, recibirCarga, rechazarDocumento, reindexar, retirarDocumento,
} from "../admin/documents.js";
import { pageSize } from "../admin/contracts.js";
import { requireAdmin, safe } from "./adminAuth.js";

const router = Router();
const ambos = requireAdmin({});
const cargar = requireAdmin({ mutation: true, multipart: true });
const tecnico = { perfil: "administrador técnico" } as const;
const lecturaTecnico = requireAdmin(tecnico);
const escrituraTecnico = requireAdmin({ ...tecnico, mutation: true });

router.get("/admin/documents", ambos, safe(async (req, res) => {
  res.json(await listarDocumentos(req.admin!.accountId, {
    mine: req.query.mine, state: req.query.state, cursor: req.query.cursor, limit: pageSize(req.query.limit),
  }));
}));

router.post("/admin/documents", cargar, async (req, res) => {
  try {
    res.status(201).json(await recibirCarga(req, req.admin!.accountId));
  } catch (error) {
    // La carga puede terminar con partes sin consumir: se cierra la conexión tras responder.
    res.setHeader("Connection", "close");
    res.once("finish", () => { req.destroy(); });
    await safe(async () => { throw error; })(req, res);
  }
});

router.post("/admin/documents/:id/publish", escrituraTecnico, safe(async (req, res) => {
  res.status(202).json(await publicarDocumento(req.admin!.accountId, req.params.id, req.body, req.header("idempotency-key")));
}));
router.post("/admin/documents/:id/reject", escrituraTecnico, safe(async (req, res) => {
  res.status(202).json(await rechazarDocumento(req.admin!.accountId, req.params.id, req.body, req.header("idempotency-key")));
}));
router.post("/admin/documents/:id/withdraw", escrituraTecnico, safe(async (req, res) => {
  res.status(202).json(await retirarDocumento(req.admin!.accountId, req.params.id, req.body, req.header("idempotency-key")));
}));
router.patch("/admin/documents/:id/metadata", escrituraTecnico, safe(async (req, res) => {
  res.json(await editarMetadata(req.admin!.accountId, req.params.id, req.body));
}));
router.post("/admin/reindexations", escrituraTecnico, safe(async (req, res) => {
  res.status(202).json(await reindexar(req.admin!.accountId, req.body, req.header("idempotency-key")));
}));
router.get("/admin/document-operations/:id", lecturaTecnico, safe(async (req, res) => {
  res.json(await obtenerOperacion(req.params.id));
}));

export default router;
