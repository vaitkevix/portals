-- SH | Klienti (pasūtītāji), objektu piesaiste, cenas par vienību katrai lietotnei — izpildes aktiem un rēķiniem. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, regnr TEXT NOT NULL DEFAULT '', adrese TEXT NOT NULL DEFAULT '', epasts TEXT NOT NULL DEFAULT '',
  kontakts TEXT NOT NULL DEFAULT '', liguma_nr TEXT NOT NULL DEFAULT '', cenas TEXT NOT NULL DEFAULT '{}', aktivs INTEGER NOT NULL DEFAULT 1, ord INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS client_obj (anorm TEXT PRIMARY KEY, client TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS client_obj_c ON client_obj (client);
