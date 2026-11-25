-- Izvešanas vēsture salīdzinājumam (2025 — ECO Mineral rēķini, tikai m³ un reizes, bez eiro). © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS izv_hist (gads INTEGER NOT NULL, men INTEGER NOT NULL, diena INTEGER NOT NULL DEFAULT 1, adrese TEXT NOT NULL,
  veids TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, m3 REAL NOT NULL DEFAULT 0, PRIMARY KEY (gads, men, diena, adrese, veids));
