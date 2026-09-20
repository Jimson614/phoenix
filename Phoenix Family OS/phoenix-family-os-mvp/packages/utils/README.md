# utils

状态：结构预留，无独立 package.json 或可导入模块。

职责：通用日期、ID 与平台无关工具。

当前来源：

- [utils/date.js](../../utils/date.js)
- [utils/id.js](../../utils/id.js)
- [utils/navigation.js](../../utils/navigation.js)

navigation 当前依赖微信环境，不应整体移入通用工具；先分离平台能力。
