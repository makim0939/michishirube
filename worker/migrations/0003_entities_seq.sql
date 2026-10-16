-- 書き込むたびに、すべての利用者を通した seq の最大を読む（worker/src/sync.ts）。
-- (user_id, seq) の索引では全体の最大を引けず、表を全部読んでしまうので、seq だけの索引を足す
CREATE INDEX user_entities_seq_all ON user_entities (seq);
