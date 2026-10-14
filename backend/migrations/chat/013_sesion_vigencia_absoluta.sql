-- SPEC008 (FR-018): vigencia absoluta de la sesión del panel. Además de los 30 minutos de
-- inactividad, una sesión vence 8 horas después de su creación aunque tenga actividad.
ALTER TABLE admin.session ADD COLUMN absolute_expires_at timestamptz;
UPDATE admin.session SET absolute_expires_at = created_at + interval '8 hours' WHERE absolute_expires_at IS NULL;
ALTER TABLE admin.session ALTER COLUMN absolute_expires_at SET NOT NULL;
ALTER TABLE admin.session ALTER COLUMN absolute_expires_at SET DEFAULT (now() + interval '8 hours');
