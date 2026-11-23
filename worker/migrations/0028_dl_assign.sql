-- SH | Darba laiks: darbinieka amats katrā objektā (uzk | set | abi). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS dl_assign (phone TEXT NOT NULL, anorm TEXT NOT NULL, amats TEXT NOT NULL DEFAULT 'uzk', PRIMARY KEY (phone, anorm));
CREATE INDEX IF NOT EXISTS dl_assign_a ON dl_assign (anorm);
INSERT OR IGNORE INTO dl_assign (phone, anorm, amats) SELECT phone, anorm, CASE WHEN amats IN ('uzk', 'set', 'abi') THEN amats ELSE 'uzk' END FROM dl_worker WHERE anorm != '';
