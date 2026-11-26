-- Personāls: atvaļinājuma pieteikumā atzīme «strādās atvaļinājuma laikā» (2026-11-26)
ALTER TABLE pers_vac ADD COLUMN strada TEXT NOT NULL DEFAULT '';
