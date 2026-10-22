-- Sign in with Apple の利用者の、Apple のリフレッシュトークン。退会するときに、Apple に取り消し（revoke）を知らせるために持つ。
-- Apple でログインしたことがない人・この版より前にログインした人は、空のまま（その人は、次にログインしたときに入る）。
ALTER TABLE users ADD COLUMN apple_refresh_token TEXT;
