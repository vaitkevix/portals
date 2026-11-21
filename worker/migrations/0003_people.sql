-- Vienots lietotāju un pilnvaru saraksts visām lietotnēm (© VAITKEVIX, SIA)
CREATE TABLE IF NOT EXISTS people (name TEXT PRIMARY KEY, pin TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', ord INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, perms TEXT NOT NULL DEFAULT '{}');
