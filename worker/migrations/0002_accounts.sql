-- 利用者ごとに分ける（Google でログインした人のデータを、その人だけが読み書きできるようにする）。
-- サーバーに置くのは、記録・型・分野・動画と写真の情報・設定・縮小した写真・動画のサムネイルだけ。
-- 動画の中身と YouTube の認可情報（refresh token）は置かない（YouTube の鍵は端末にだけある）

-- 利用者。Google のアカウントの番号（sub）だけを持つ（メールアドレス・名前は持たない）
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- ログインしている端末。トークンそのものではなく、ハッシュだけを持つ
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Google の画面で認可している途中のもの（10分で消える）。終わったら結果をアプリが一度だけ受け取り、すぐ消す
CREATE TABLE auth_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  challenge TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE user_entities (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX user_entities_seq ON user_entities (user_id, seq);

CREATE TABLE user_photos (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- これまで1人で使っていたデータは「legacy」として残し、前のトークンを知っている人がログインしたときに引き継ぐ
INSERT INTO user_entities (user_id, kind, id, data, updated_at, deleted, seq)
  SELECT 'legacy', kind, id, data, updated_at, deleted, seq FROM entities;
INSERT INTO user_photos (user_id, id, type, data, created_at)
  SELECT 'legacy', id, type, data, created_at FROM photos;

DROP TABLE entities;
DROP TABLE photos;
-- YouTube の認可情報はサーバーに置かなくなった（連携し直すと、端末にだけ置く）
DROP TABLE secrets;
