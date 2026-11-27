-- SH | Personāls: prombūtņu reģistrs (C3) — slimības lapa B/A, bezalgas, mācības, cits; no/līdz (lidz '' = turpinās). Arī no SMS «SLIMS». Nedzēš — dzests 1. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS pers_abs (id TEXT PRIMARY KEY, vards TEXT NOT NULL DEFAULT '', vkey TEXT NOT NULL DEFAULT '', tips TEXT NOT NULL DEFAULT 'B', no TEXT NOT NULL DEFAULT '', lidz TEXT NOT NULL DEFAULT '',
  piezime TEXT NOT NULL DEFAULT '', avots TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', dzests INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS pers_abs_v ON pers_abs (vkey);
CREATE INDEX IF NOT EXISTS pers_abs_d ON pers_abs (no, lidz);
