BEGIN;

-- 账号注销：删除个人数据，保留财务记录的最小集。
--
-- 会计与税务法规要求留存交易凭证，所以 orders / entitlements / payment_events /
-- refunds 的行必须保留；但它们通过 family_id、student_id、assessment_id、report_id
-- 指向个人数据，而且是 ON DELETE RESTRICT——在这个状态下删掉家庭或孩子会被数据库直接挡回去。
--
-- 解法是让财务记录与个人数据脱钩，而不是连财务记录一起删：把这四列改成可空 + SET NULL。
-- user_id 保持 RESTRICT：users 行本身会保留下来（只剩 id / role / created_at，
-- 没有任何个人信息，因为 wechat_identities 会被删除，与真人的关联随之断开），
-- 留着它财务记录才有归属，也避免孤儿外键。

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS users_deleted_idx ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- orders：四个指向个人数据的外键改为可空 + SET NULL
ALTER TABLE orders
  ALTER COLUMN family_id DROP NOT NULL,
  ALTER COLUMN student_id DROP NOT NULL,
  ALTER COLUMN assessment_id DROP NOT NULL,
  ALTER COLUMN report_id DROP NOT NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_family_id_fkey;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_student_id_fkey;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_assessment_id_fkey;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_report_id_fkey;

ALTER TABLE orders
  ADD CONSTRAINT orders_family_id_fkey
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL,
  ADD CONSTRAINT orders_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
  ADD CONSTRAINT orders_assessment_id_fkey
    FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL,
  ADD CONSTRAINT orders_report_id_fkey
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL;

-- entitlements：report_id 同理。user_id 与 order_id 保持 RESTRICT，两者都会保留。
ALTER TABLE entitlements ALTER COLUMN report_id DROP NOT NULL;
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS entitlements_report_id_fkey;
ALTER TABLE entitlements
  ADD CONSTRAINT entitlements_report_id_fkey
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL;

-- 注销后不得再凭已撤销的权益读到正文：报告行已经删除，这里补一条约束说明
-- report_id 为空的权益只可能来自账号注销，不是正常业务状态。
COMMENT ON COLUMN entitlements.report_id IS
  '正常业务下非空；为空表示该报告已随账号注销删除，本行仅作为财务凭证保留';
COMMENT ON COLUMN users.deleted_at IS
  '账号注销时间。该行只保留 id/role/created_at 用于财务记录归属，不含任何个人信息';

COMMIT;
