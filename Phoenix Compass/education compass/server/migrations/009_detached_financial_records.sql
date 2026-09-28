BEGIN;

-- 让账号注销能在真实数据库上完成。
--
-- 007 把 orders / entitlements 的 report_id 改成了可空，账号注销时置空，
-- 让财务凭证与个人数据脱钩。但 005 的触发器
-- phoenix_v005_enforce_product_report_kind 在 UPDATE OF report_id 时仍会去查
-- 这份报告的类型；report_id 为空时查不到，直接抛 'Product/report deliverable mapping
-- is missing'，整个注销事务回滚。结果是：凡是买过报告的用户，都无法注销。
--
-- 放行的范围刻意收窄为"UPDATE 且新值为空"：这只可能来自账号注销的脱钩操作。
-- INSERT 时 report_id 为空仍然会被拒绝——007 去掉了 NOT NULL 约束，
-- 如果连 INSERT 也放行，新建订单就能绕开商品/报告类型的对应校验。

CREATE OR REPLACE FUNCTION phoenix_v005_enforce_product_report_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actual_report_kind text;
  allowed_report_kind text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.report_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT report_kind
  INTO actual_report_kind
  FROM reports
  WHERE id = NEW.report_id;

  SELECT report_kind
  INTO allowed_report_kind
  FROM product_deliverables
  WHERE product_code = NEW.product_code;

  IF actual_report_kind IS NULL OR allowed_report_kind IS NULL THEN
    RAISE EXCEPTION 'Product/report deliverable mapping is missing'
      USING ERRCODE = '23514';
  END IF;

  IF actual_report_kind <> allowed_report_kind THEN
    RAISE EXCEPTION 'Product cannot unlock this report kind'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
