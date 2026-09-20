# 持久化说明

小程序使用 services/store.js 管理微信本地数据；问卷代理使用 backend/database.js 管理本地 SQLite，两者尚不是共享生产家庭数据库。

结构迁移必须区分客户端 Demo 状态、问卷提交与未来 Core 主体，不能假定本地 family_id 已完成 Core 映射。参见 [Schema 映射](../schema/README.md)。
