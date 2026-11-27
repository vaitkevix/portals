-- SH | I8 materiāli un inventārs: vienības + kustības (atlikums = SUM(daudz)). Automātiskās kustības dedublē pēc avots (sniegs:<id>, kais:<id>, c11:<kods>). Nedzēš. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS inv_item (id TEXT PRIMARY KEY, kods TEXT NOT NULL DEFAULT '', nosaukums TEXT NOT NULL, veids TEXT NOT NULL DEFAULT 'cits', vieniba TEXT NOT NULL DEFAULT 'gab.',
  minimums REAL NOT NULL DEFAULT 0, piezime TEXT NOT NULL DEFAULT '', izsniegts TEXT NOT NULL DEFAULT '', mh REAL NOT NULL DEFAULT 0, apk_mh REAL NOT NULL DEFAULT 0, apk_dat TEXT NOT NULL DEFAULT '',
  pasutits TEXT NOT NULL DEFAULT '', aktivs INTEGER NOT NULL DEFAULT 1, laiks TEXT NOT NULL DEFAULT '');
CREATE UNIQUE INDEX IF NOT EXISTS inv_item_k ON inv_item (kods) WHERE kods != '';
CREATE TABLE IF NOT EXISTS inv_move (id TEXT PRIMARY KEY, item TEXT NOT NULL, datums TEXT NOT NULL, daudz REAL NOT NULL DEFAULT 0, veids TEXT NOT NULL DEFAULT '', anorm TEXT NOT NULL DEFAULT '',
  adrese TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '', avots TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS inv_move_i ON inv_move (item, datums);
CREATE UNIQUE INDEX IF NOT EXISTS inv_move_a ON inv_move (avots) WHERE avots != '';
