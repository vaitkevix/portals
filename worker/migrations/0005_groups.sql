-- SH | Objektu grupas (visām lietotnēm) + darba grupas atzīme. © VAITKEVIX, SIA
CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, rule TEXT NOT NULL DEFAULT '', members TEXT NOT NULL DEFAULT '[]', ord INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO groups (id, name, rule, members, ord) VALUES ('jurmala', 'Jūrmala', 'J |', '[]', 0), ('vni', 'Valsts nekustamie īpašumi', 'VNĪ |', '[]', 1);
ALTER TABLE jobs ADD COLUMN grupa TEXT NOT NULL DEFAULT '';
