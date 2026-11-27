-- SH | SIA darbinieki un «Pieņemu / Nevaru» (Izvešana, Kaisāmmateriāls), klientu pieteikumi no skata, Skata PIN rēķiniem, mājas lapas paziņojumi. © VAITKEVIX, SIA
ALTER TABLE izv_task ADD COLUMN pienem TEXT NOT NULL DEFAULT '';
ALTER TABLE izv_task ADD COLUMN nevar TEXT NOT NULL DEFAULT '';
ALTER TABLE kais_task ADD COLUMN pienem TEXT NOT NULL DEFAULT '';
ALTER TABLE kais_task ADD COLUMN nevar TEXT NOT NULL DEFAULT '';
-- SIA darbinieki: PIN glabā tikai kā jaucējvērtību (pin_h); vārds redzams kā «SIA · vārds»
CREATE TABLE IF NOT EXISTS company_people (id TEXT PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, pin_h TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1,
  izveidots TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS company_people_c ON company_people (company);
-- Klienta pieteikumi no skata (skats.html): papilddarbs → admins / lietotne
CREATE TABLE IF NOT EXISTS client_req (id TEXT PRIMARY KEY, client TEXT NOT NULL, klients TEXT NOT NULL DEFAULT '', adrese TEXT NOT NULL DEFAULT '', anorm TEXT NOT NULL DEFAULT '',
  app TEXT NOT NULL DEFAULT '', datums TEXT NOT NULL DEFAULT '', apraksts TEXT NOT NULL DEFAULT '', foto TEXT NOT NULL DEFAULT '', statuss TEXT NOT NULL DEFAULT 'jauns',
  visit TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '', apstr TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS client_req_s ON client_req (statuss, izveidots);
-- Skata PIN rēķiniem (jaucējvērtība)
ALTER TABLE clients ADD COLUMN view_pin TEXT NOT NULL DEFAULT '';
-- Vadītāja brīdinājumi iedzīvotājiem (maja.html)
CREATE TABLE IF NOT EXISTS ml_notice (id TEXT PRIMARY KEY, anorm TEXT NOT NULL, teksts TEXT NOT NULL DEFAULT '', no TEXT NOT NULL DEFAULT '', lidz TEXT NOT NULL DEFAULT '',
  kas TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS ml_notice_a ON ml_notice (anorm, lidz);
