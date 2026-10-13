/** Cuentas del panel (contracts/admin-api.md): solo administrador técnico; mutaciones con CSRF. */
import { Router } from "express";
import { createAccount, listAccounts, setTemporaryPassword, updateAccount } from "../admin/accounts.js";
import { pageSize } from "../admin/contracts.js";
import { requireAdmin, safe } from "./adminAuth.js";

const router = Router();
const tecnico = { perfil: "administrador técnico" } as const;
const lectura = requireAdmin(tecnico);
const escritura = requireAdmin({ ...tecnico, mutation: true });

router.get("/admin/accounts", lectura, safe(async (req, res) => {
  res.json(await listAccounts({ limit: pageSize(req.query.limit), cursor: req.query.cursor }));
}));

router.post("/admin/accounts", escritura, safe(async (req, res) => {
  res.status(201).json(await createAccount(req.admin!.accountId, req.body));
}));

router.patch("/admin/accounts/:id", escritura, safe(async (req, res) => {
  res.json(await updateAccount(req.admin!.accountId, req.params.id, req.body));
}));

router.post("/admin/accounts/:id/temporary-password", escritura, safe(async (req, res) => {
  res.json(await setTemporaryPassword(req.admin!.accountId, req.params.id, req.body));
}));

export default router;
