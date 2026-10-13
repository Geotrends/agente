/**
 * Migración del esquema administrativo (T007).
 *
 * Las migraciones administrativas viven en `migrations/chat/` (009 en adelante) y comparten
 * ledger, propietario `chat_owner` y roles con el resto del esquema chat/admin: un único orden
 * (identidad → conversación → registro → panel) evita dependencias cruzadas entre dos directorios.
 * El esquema `kb` lo migra el escritor documental (`migrations/005_*`) con su propio ledger.
 * Corre con cuenta administradora de PostgreSQL, nunca con los roles del runtime.
 */
import type pg from "pg";
import { applyChatAdminMigrations, type RolePasswords } from "../chat/migrate.js";

export async function applyAdminMigrations(db: pg.Pool, passwords: RolePasswords): Promise<string[]> {
  return applyChatAdminMigrations(db, passwords);
}
