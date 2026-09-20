# Schema 规划与现有来源

当前模型在 [models/schema.js](../../models/schema.js)，SQLite 表定义在 [001_questionnaire_submissions.sql](../../backend/migrations/001_questionnaire_submissions.sql)。两者存储用途不同，不能直接拼接为生产数据库。

| V2.0 计划文件 | 当前对应 | 本阶段 |
| --- | --- | --- |
| users.sql | Demo users/session | 保留原迁移 |
| families.sql | 本地 families 与问卷关联 | 不新增 DDL |
| family_members.sql | 待 Core 成员/监护契约确认 | 设计预留 |
| children.sql | 当前 students | 不自动改名 |
| timeline.sql | 本地 timelineEvents | 设计预留 |
| education.sql | assessments/questionnaire_submissions | 保留原来源 |
| ai.sql | 本地 reports 与规则洞察 | 无模型存储扩展 |
| consent.sql | 待 Core 确认的授权真源 | 不建立平行 consent 表 |

这些文件名是设计映射，不生成不可执行的空 SQL 或重复迁移。
