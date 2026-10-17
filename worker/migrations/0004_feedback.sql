-- アプリの「ご意見・ご要望」から届いたもの。ログインしていなくても送れるので、利用者とは結び付けない。
-- 返信先（contact）は、本人が書いたときだけ入る
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  env TEXT NOT NULL DEFAULT ''
);
CREATE INDEX feedback_created ON feedback (created_at);
