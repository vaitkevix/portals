-- SH | Objekta pakalpojumi (kurā lietotnē objekts redzams) un ēkas dati. 1 = ir, 0/NULL = nav. © VAITKEVIX, SIA
ALTER TABLE obj_info ADD COLUMN zale INTEGER;
ALTER TABLE obj_info ADD COLUMN logi INTEGER;
ALTER TABLE obj_info ADD COLUMN darz INTEGER;
ALTER TABLE obj_info ADD COLUMN sniegs INTEGER;
ALTER TABLE obj_info ADD COLUMN ip TEXT NOT NULL DEFAULT '{}';
INSERT INTO obj_info (anorm, zale) SELECT anorm, 1 FROM pl_obj WHERE 1 ON CONFLICT(anorm) DO UPDATE SET zale = 1;
INSERT INTO obj_info (anorm, logi) SELECT anorm, 1 FROM logi_obj WHERE 1 ON CONFLICT(anorm) DO UPDATE SET logi = 1;
INSERT INTO obj_info (anorm, darz) SELECT anorm, 1 FROM darz_obj WHERE 1 ON CONFLICT(anorm) DO UPDATE SET darz = 1;
INSERT INTO obj_info (anorm, sniegs) SELECT anorm, 1 FROM sniegs_obj WHERE 1 ON CONFLICT(anorm) DO UPDATE SET sniegs = 1;
