-- 型の「参考の目安」（criteria）と「出典」（sources）は、画面からなくしたので、保存済みの型からも消す。
-- seq・updated_at は進めない。端末は、アプリを更新したときに自分で消す（進めると、全端末が型を受け取り直す）。
-- 元に戻せない（消した値は、端末のバックアップ ZIP や、D1 の Time Travel にしか残らない）。
UPDATE user_entities
SET data = json_remove(data, '$.criteria', '$.sources')
-- json_valid：壊れた JSON が1行でもあると、json_remove が全体を止めてしまい、Worker のデプロイまで止まる
WHERE kind = 'skill' AND data IS NOT NULL AND json_valid(data);
