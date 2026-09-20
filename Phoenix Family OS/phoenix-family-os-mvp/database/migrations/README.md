# 迁移预留

唯一执行目录仍是 [backend/migrations](../../backend/migrations/001_questionnaire_submissions.sql)。

以后若迁到这里，必须同时修改加载器、迁移测试、版本登记与运行路径，并证明不会重复执行既有迁移。本阶段没有新的 SQL、数据库操作或生产配置。
