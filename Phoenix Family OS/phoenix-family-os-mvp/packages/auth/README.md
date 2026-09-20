# auth

状态：结构预留，无独立 package.json 或可导入模块。

职责：平台认证与服务端身份的适配边界。

当前来源：

- [services/auth.js](../../services/auth.js)
- [services/backend-api.js](../../services/backend-api.js)
- [backend/auth.js](../../backend/auth.js)

原认证保留；真实微信认证与 Core 身份映射在专门实现阶段接入。
