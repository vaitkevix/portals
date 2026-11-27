-- SH | Klienta līgums: noslēgts, beidzas, auto pagarināšana, uzteikuma termiņš (dienas), PDF R2 (ct-…). © VAITKEVIX, SIA
ALTER TABLE clients ADD COLUMN lig_no TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN lig_lidz TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN lig_auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN lig_uzt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN lig_pdf TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN lig_pdf_nos TEXT NOT NULL DEFAULT '';
