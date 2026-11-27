-- Budžets: klienta akcepts caur saiti (nejauša atslēga, publiska lapa tikai lasīšanai + «Apstiprinu»)
CREATE TABLE IF NOT EXISTS budz_akc (k TEXT PRIMARY KEY, id TEXT NOT NULL, versija INTEGER NOT NULL DEFAULT 1, html TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '',
  vards TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '', aktivs INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS budz_akc_id ON budz_akc (id);
