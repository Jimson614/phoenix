# 数据与权限边界

当前的 touristappid、微信本地存储、Demo 角色和 loopback SQLite 不代表生产授权体系。
后端只允许本机回环地址；不因目录整理改变认证、数据接口或迁移行为。

未来 packages/auth 与 packages/permissions 需要依赖经确认的 Core 身份、家庭映射、监护关系、明确用途/版本的 consent、顾问分配与审计；不能在 Family OS 再建独立的共享授权真源。
身份/家庭/授权缺失时必须拒绝访问。顾问和 AI Agent 不应默认访问所有家庭、财富或健康数据。

仅用合成数据；API key、AppSecret、真实家庭/未成年人数据与备份不进入 Git。
新增 database/.gitignore 排除该目录下的数据库文件、data 与 backups；它不能替代人工检查或清除历史已跟踪内容。
