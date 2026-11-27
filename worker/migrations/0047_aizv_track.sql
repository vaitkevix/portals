-- Aizvietošana: sākts (izpildītājs nospiež «Sākt») un pārcelšanas vēsture (JSON [{no, uz, iemesls, kas, laiks}])
ALTER TABLE jobs ADD COLUMN sakts TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN parcelts TEXT NOT NULL DEFAULT '';
