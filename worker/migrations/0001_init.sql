-- 記録・スキル・分野・メディアの情報・設定を、種類ごとに JSON で持つ。
-- seq は書き込みのたびに増える番号で、端末はこれを手がかりに差分だけを取りに来る
CREATE TABLE entities (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX entities_seq ON entities (seq);

-- 縮小した写真（動画は YouTube に置く）
CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

-- YouTube の認可情報など、サーバーだけが持つ値
CREATE TABLE secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
