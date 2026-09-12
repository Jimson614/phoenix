# Phoenix UI 本地代码验收报告

状态：LOCAL_UI_CODE_VERIFIED + BLOCKED_MANUAL

## 已通过

- 16 个源码页面均完成 WXML/WXSS 视觉升级。
- release 仍为 14 页，两个 Admin Demo 页面继续排除。
- 初始纯 UI 阶段 3478 个受保护文件 SHA-256 无变化；本次用户明确要求修正 Education Compass 付费漏斗后，最终快照仅有 2 个经授权的逻辑文件变化：`pages/compass/index.js` 与 `utils/education-compass-navigation.js`，其余 3476 个不变。
- app pages 顺序、三个 TabBar pagePath、lazyCodeLoading 无变化。
- WXML 事件绑定 131/131、data-* 32/32，无丢失。
- 16/16 WXML、18/18 JSON、18/18 WXSS 静态结构通过。
- 61 个本地图片引用均存在；远程 UI 资源、web-view、CSS url、本地缺失资源均为 0。
- 两张 UI 资产合计 875790 字节，低于 1.5 MiB 源码预算。
- client、server、Education contracts/HTTP/integrations、Mock HTTP smoke、release 和 secret scan 均通过。
- DevTools 实际暴露的两处 WXSS universal selector 兼容问题已修复：`pages/compass/index.wxss` 的 `.product-card > *` 与 `pages/home/index.wxss` 的 `.onboarding > *` 均改为显式类选择器；源码与 `dist/offline-test` 全量扫描为 0，并新增自动回归保护。
- 已移除共享 `.page` 容器的强制整屏高度，嵌套内容区恢复按内容自然撑开；“我的”页和开始前确认区的纵向留白同步收紧，并保留不小于 88rpx 的可点击高度。
- Education Compass 首次进入固定为免费 Level 1，不展示价格或支付入口；只有同一学生的服务端状态返回 `START_LEVEL_2` 后，才允许进入并展示 ¥39.90 Level 2。直接拼接 `level=2` 或伪造来源测评 ID 均不能绕过。

## 证据边界

- build:release 生成的是 dist/offline-test，分类为 OFFLINE_TEST_ONLY。
- smoke:education 为 LOCAL_HTTP_MOCK，externalCalls=0。
- PostgreSQL 测试因没有专用测试数据库而为 BLOCKED_EXTERNAL。
- 本环境未取得可自动控制的微信开发者工具与 iOS/Android 真机截图，因此四类视觉验收均为 BLOCKED_MANUAL，截图数为 0。
- 已识别微信开发者工具版本 `2.01.2510260`，并尝试通过 CLI 以端口 `9420` 打开源码项目；工具进程能够启动，但端口未监听，日志同时出现 `WeappLocalData` 文件锁错误，CLI 最终超时。因此未把该尝试记为编译通过，也未改动或删除开发者工具用户数据。
- 后续手工打开工作副本后，DevTools 日志先准确报告上述两处 `error at token '*'`；两处文件修复触发热编译后，日志不再新增同类编译错误。仍需用户在当前窗口点击一次“编译”确认模拟器视觉状态。
- 未执行真实微信支付、退款、OpenAI/飞书外部写入、小程序上传、发布或生产部署。
