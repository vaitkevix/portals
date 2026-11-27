-- Rēķinu reģistrs: izrakstot saglabā rindu/summu kopiju (rēķins vairs nemainās), statuss un apmaksa. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS invoice (
  nr TEXT PRIMARY KEY, client TEXT NOT NULL DEFAULT '', klients TEXT NOT NULL DEFAULT '', ym TEXT NOT NULL DEFAULT '', datums TEXT NOT NULL DEFAULT '', termins TEXT NOT NULL DEFAULT '',
  summa REAL NOT NULL DEFAULT 0, pvn REAL NOT NULL DEFAULT 0, ar_pvn REAL NOT NULL DEFAULT 0, dati TEXT NOT NULL DEFAULT '',
  statuss TEXT NOT NULL DEFAULT 'izrakstīts', apmaksats TEXT NOT NULL DEFAULT '', apm_summa REAL NOT NULL DEFAULT 0, piezime TEXT NOT NULL DEFAULT '',
  izveidots TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '');
CREATE UNIQUE INDEX IF NOT EXISTS invoice_client_ym ON invoice (client, ym);
CREATE INDEX IF NOT EXISTS invoice_statuss ON invoice (statuss, termins);
