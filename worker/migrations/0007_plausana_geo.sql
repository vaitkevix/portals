-- SH | Zāles pļaušana: objektu koordinātas kartei (no adreses, OpenStreetMap). © VAITKEVIX, SIA
ALTER TABLE pl_obj ADD COLUMN lat REAL;
ALTER TABLE pl_obj ADD COLUMN lng REAL;
