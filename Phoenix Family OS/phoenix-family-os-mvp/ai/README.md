# AI 设计边界

当前 [services/ai-provider.js](../services/ai-provider.js) 只调用确定性本地规则。

本目录包含三个 agent、context、三层 memory、prompts、evaluation 的职责说明，没有模型调用、后台任务或持久化记忆。对外仍称成长洞察。
