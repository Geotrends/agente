-- SPEC007 · tarifas editables desde el panel (RF-C3-AD-42). No reescribe precios anteriores: solo
-- cierra la vigencia de la actual e inserta una nueva. No altera 001–011.
GRANT UPDATE (valid_to) ON chat.tariff TO admin_app;
