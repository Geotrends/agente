/**
 * Soporte de las pruebas de integración del panel (SPEC007 T005).
 *
 * Levanta la aplicación REAL (`createApp`) sobre una base PostgreSQL aislada con los roles y
 * migraciones de producción (esquemas kb, chat y admin). Cuentas y datos son sintéticos; no se
 * usa AWS, producción ni texto ciudadano real, y cada arranque crea y destruye su propia base.
 * Los resultados son «controlados»: no acreditan producción.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { createApp } from "../../src/app.js";
import { setAdminPoolForTests } from "../../src/admin/db.js";
import { hashPassword } from "../../src/admin/passwords.js";
import { adminClock } from "../../src/admin/sessions.js";
import { operations } from "../../src/admin/operations.js";
import { setChatPoolForTests } from "../../src/chat/db.js";
import { createChatAdminDbWithKb } from "../di-integracion/chatAdminDb.js";

export const ORIGIN = "https://panel.prueba.gov.co";
export const PASSWORD = "contraseña-segura-123";
export const TECNICO = "administrador técnico" as const;
export const GESTOR = "Gestor documental" as const;

Object.assign(process.env, {
  AUTH_JWT_SECRET: "x".repeat(40), TRUST_PROXY: "1",
  // E2E_ADMIN_ORIGIN lo fija el servidor de pruebas de navegador (frontend/test/admin/helpers).
  CHAT_ALLOWED_ORIGINS: [ORIGIN, process.env.E2E_ADMIN_ORIGIN].filter(Boolean).join(","),
  ADMIN_IP_HMAC_SECRET: "secreto-hmac-de-prueba-0123456789abcdef",
});

export type Db = Awaited<ReturnType<typeof createChatAdminDbWithKb>>;

export type Session = {
  accountId: string;
  csrf: string;
  cookie: string;
  /** Carga multipart: metadata primero y luego el archivo. */
  upload: (metadata: unknown, file: { bytes: Buffer; name: string; type?: string } | null, opts?: { rawMetadata?: string; fileFirst?: boolean }) => Promise<Upload>;
  /** Llamada autenticada con CSRF y Origin del panel. */
  api: (method: string, path: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; headers: Headers; json: any; text: string }>;
};

export type Upload = { status: number; json: any; text: string };

export type AdminApp = {
  db: Db;
  /** Pool del escritor documental (kb_writer): solo para sembrar y comprobar. */
  kb: pg.Pool;
  /** Alias de Qdrant exclusivo de esta ejecución (solo con `qdrant: true`). */
  alias: string;
  uploadDir: string;
  base: string;
  clock: { t: number };
  server: Server;
  /** Crea una cuenta con contraseña conocida (sin cambio obligatorio salvo que se pida). */
  createAccount: (email: string, perfil: typeof TECNICO | typeof GESTOR, opts?: { name?: string; mustChange?: boolean; password?: string; active?: boolean }) => Promise<string>;
  login: (email: string, password?: string, ip?: string) => Promise<Session>;
  rawLogin: (email: string, password: string, ip?: string) => Promise<Response>;
  /** Llamada sin sesión. */
  anon: (method: string, path: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; headers: Headers; json: any }>;
  close: () => Promise<void>;
};

export async function startAdminApp(opts: { qdrant?: boolean } = {}): Promise<AdminApp> {
  const db = await createChatAdminDbWithKb();
  let alias = "";
  let uploadDir = "";
  let reader: pg.Pool | undefined;
  if (opts.qdrant) {
    // Qdrant real con alias propio, carpeta de cargas temporal y lector `app_reader` (como en producción).
    const { prepararQdrantDePrueba } = await import("../kb-integracion/qdrantPruebas.js");
    alias = prepararQdrantDePrueba();
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "geobot-cargas-prueba-"));
    process.env.KB_UPLOAD_DIR = uploadDir;
    process.env.KB_GRACIA_LIMPIEZA_MS = "0";
    const u = new URL(process.env.KB_TEST_ADMIN_URL || "postgres://geobot_admin:dev-admin@localhost:55432/geobot_test");
    u.pathname = `/${db.name}`; u.username = "app_reader"; u.password = "app-reader-pruebas";
    process.env.APP_DATABASE_URL = u.toString();
    reader = new pg.Pool({ connectionString: u.toString(), max: 2 });
  }
  setAdminPoolForTests(db.admin);
  setChatPoolForTests(db.chat);
  operations.reset();
  const clock = { t: Date.UTC(2026, 9, 12, 15, 0, 0) };
  adminClock.now = () => clock.t;
  const outer = express();
  outer.use(createApp());
  const server = outer.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;

  const createAccount: AdminApp["createAccount"] = async (email, perfil, opts = {}) => {
    const { rows } = await db.migrator.query(
      `INSERT INTO admin.account (email, display_name, profile, password_phc, must_change_password, active)
       VALUES (lower($1), $2, $3, $4, $5, $6) RETURNING id`,
      [email, opts.name ?? email.split("@")[0], perfil, await hashPassword(opts.password ?? PASSWORD), opts.mustChange ?? false, opts.active ?? true]);
    return rows[0].id as string;
  };

  const call = async (method: string, path: string, body: unknown, headers: Record<string, string>) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { origin: ORIGIN, "x-forwarded-for": "10.0.0.1", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, headers: res.headers, json, text };
  };

  const rawLogin: AdminApp["rawLogin"] = (email, password, ip = "10.0.0.1") =>
    fetch(`${base}/session`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": ip },
      body: JSON.stringify({ email, password }) });

  const login: AdminApp["login"] = async (email, password = PASSWORD, ip = "10.0.0.1") => {
    const res = await rawLogin(email, password, ip);
    if (res.status !== 200) throw new Error(`login ${email}: ${res.status}`);
    const body = await res.json() as { cuenta: { id: string }; csrfToken: string };
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    return {
      accountId: body.cuenta.id, csrf: body.csrfToken, cookie,
      api: (method, path, b, extra = {}) => call(method, path, b, { cookie, "x-csrf-token": body.csrfToken, "x-forwarded-for": ip, ...extra }),
      upload: async (metadata, file, o = {}) => {
        const form = new FormData();
        const meta = o.rawMetadata ?? JSON.stringify(metadata);
        const addFile = () => { if (file) form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type ?? "application/octet-stream" }), file.name); };
        if (o.fileFirst) addFile();
        if (metadata !== undefined || o.rawMetadata !== undefined) form.append("metadata", meta);
        if (!o.fileFirst) addFile();
        const res = await fetch(`${base}/documents`, {
          method: "POST", headers: { origin: ORIGIN, cookie, "x-csrf-token": body.csrfToken, "x-forwarded-for": ip }, body: form,
        });
        const text = await res.text();
        let json: any;
        try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
        return { status: res.status, json, text };
      },
    };
  };

  return {
    db, kb: db.kb, alias, uploadDir, base, clock, server, createAccount, login, rawLogin,
    anon: (method, path, body, extra = {}) => call(method, path, body, extra),
    close: async () => {
      setAdminPoolForTests(undefined);
      setChatPoolForTests(undefined);
      operations.reset();
      adminClock.now = () => Date.now();
      server.closeAllConnections?.();
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (opts.qdrant) {
        const { qdrant } = await import("../../src/services/qdrant.js");
        const { collections } = await qdrant().getCollections();
        for (const c of collections) if (c.name.startsWith(alias)) await qdrant().deleteCollection(c.name).catch(() => {});
        const { cerrarLectorManifiesto } = await import("../../src/services/manifest.js");
        await cerrarLectorManifiesto();
        await reader?.end().catch(() => {});
        await fs.rm(uploadDir, { recursive: true, force: true });
      }
      await db.close();
    },
  };
}
