-- SH | Mājas lieta (C7): objekta kontakti (vārds, loma, tālrunis, e-pasts) un saziņas žurnāls (datums, kas, teksts). Nedzēš — dzests 1. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS ml_contact (id TEXT PRIMARY KEY, anorm TEXT NOT NULL, vards TEXT NOT NULL DEFAULT '', loma TEXT NOT NULL DEFAULT '', tel TEXT NOT NULL DEFAULT '', epasts TEXT NOT NULL DEFAULT '',
  piezime TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', dzests INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ml_contact_a ON ml_contact (anorm);
CREATE TABLE IF NOT EXISTS ml_comm (id TEXT PRIMARY KEY, anorm TEXT NOT NULL, datums TEXT NOT NULL DEFAULT '', kas TEXT NOT NULL DEFAULT '', ar TEXT NOT NULL DEFAULT '', teksts TEXT NOT NULL DEFAULT '',
  laiks TEXT NOT NULL DEFAULT '', dzests INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ml_comm_a ON ml_comm (anorm, datums);
