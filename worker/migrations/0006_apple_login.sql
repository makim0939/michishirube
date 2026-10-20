-- Sign in with Apple の利用者を足す。Apple のアカウントの番号（sub）だけを持つ（メールアドレス・名前は持たない）。
-- google_sub は、Apple でだけ登録した人には無いので、NOT NULL をやめる（SQLite は列の制約を変えられないので、作り直す）。
-- どちらか一方は必ずある（CHECK）。ほかの表は、users の id だけを参照しているので、そのまま引き継げる。
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  apple_sub TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  CHECK (google_sub IS NOT NULL OR apple_sub IS NOT NULL)
);

INSERT INTO users_new (id, google_sub, created_at) SELECT id, google_sub, created_at FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;
