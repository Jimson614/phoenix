BEGIN;

-- 退款窗口需要判断"是否已下载过 PDF"，而下载此前完全没有留痕。
--
-- 只记第一次下载的时间，不记每一次：政策要判断的是"有没有下过"，
-- 记首次就够，也避免每次下载都写一次库。

ALTER TABLE reports ADD COLUMN IF NOT EXISTS pdf_first_downloaded_at timestamptz;

COMMENT ON COLUMN reports.pdf_first_downloaded_at IS
  '首次成功下载 PDF 的时间。为空表示从未下载过，是退款窗口的判据之一（OD-07）';

COMMIT;
