/**
 * Migra el esquema administrativo (alias operativo de la migración chat/admin).
 *   CHAT_MIGRATOR_URL=postgres://… CHAT_DB_PASSWORD=… ADMIN_DB_PASSWORD=… MAINT_DB_PASSWORD=… \
 *     npm run admin:migrate
 */
import "../src/chat/migrateCli.js";
