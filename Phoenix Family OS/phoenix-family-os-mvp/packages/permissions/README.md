# permissions

状态：结构预留，无独立 package.json 或可导入模块。

职责：消费 Core 授权结果，检查用途、家庭归属与角色。

当前来源：

- [services/session.js](../../services/session.js)
- [backend/auth.js](../../backend/auth.js)

当前 Demo 会话不是完整 RBAC；不在这里新增共享 consent/assignment 真源。
