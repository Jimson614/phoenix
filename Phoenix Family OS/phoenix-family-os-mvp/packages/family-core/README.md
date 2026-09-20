# family-core

状态：结构预留，无独立 package.json 或可导入模块。

职责：家庭、成员、孩子、目标、事件、决策的纯业务逻辑。

当前来源：

- [models/schema.js](../../models/schema.js)
- [services/repository.js](../../services/repository.js)

不得依赖 pages、components 或 wx；本地存储应通过适配器传入。
