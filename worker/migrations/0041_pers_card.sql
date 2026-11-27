-- SH | Personāls: darbinieka kartīte — dokumenti (R2 pd-…, tips, derīgs līdz) un kontrolsaraksts pieņemot/atlaižot (atslēgas, apģērbs, instruktāža, pārbaudes laiks). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS pers_doc (id TEXT PRIMARY KEY, vkey TEXT NOT NULL, vards TEXT NOT NULL DEFAULT '', tips TEXT NOT NULL DEFAULT '', nosaukums TEXT NOT NULL DEFAULT '', derigs TEXT NOT NULL DEFAULT '',
  r2 TEXT NOT NULL DEFAULT '', ct TEXT NOT NULL DEFAULT '', izmers INTEGER NOT NULL DEFAULT 0, pievienoja TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', dzests INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS pers_doc_v ON pers_doc (vkey);
CREATE TABLE IF NOT EXISTS pers_check (vkey TEXT NOT NULL, posms TEXT NOT NULL, punkts TEXT NOT NULL, vards TEXT NOT NULL DEFAULT '', izdarits INTEGER NOT NULL DEFAULT 0, datums TEXT NOT NULL DEFAULT '',
  kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', PRIMARY KEY (vkey, posms, punkts));
