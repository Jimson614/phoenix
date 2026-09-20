# API 当前状态

唯一已运行后端入口：backend/server.js。

| 路由 | 当前用途 |
| --- | --- |
| GET /health | 本地 Demo 健康检查 |
| POST /v1/demo/sessions | 本地 Demo 会话 |
| POST /v1/questionnaire-submissions | 认证后的最小化问卷提交 |

这些路由不因新目录而成为生产 API。后端默认绑定 127.0.0.1:8787，外部认证尚未实现。
未来 Family Context、Compass handoff、Timeline、Advisor 契约见 [PR #10](https://github.com/yvettfang-netizen/phoenix/pull/10)，不得视为已启用端点。
