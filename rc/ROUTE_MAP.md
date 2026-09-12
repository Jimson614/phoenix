# Phoenix Nova RC — route map

唯一演示入口：`http://127.0.0.1:4300/zh`。以下路径相对此 origin；仅 loopback。
`/` 重定向至 `/zh`。门户 Next 16.2.6、Education Next 16.3.1 分别运行；gateway 按 /education 前缀转发，跨 renderer 使用完整页面导航。

| Path | 内容 / 来源 | 能力边界 |
| --- | --- | --- |
| /zh, /en | Website V5 首页 / D:\web | 门户 |
| /{zh,en}/compass | Compass 产品入口 / D:\web | 成长探索按钮进入 /education |
| /{zh,en}/lighthouse | Growth Blueprint / D:\web | 信息页，无付费报告生成 |
| /{zh,en}/services | 服务 / D:\web | 信息页 |
| /{zh,en}/insights | 内容与洞察 / D:\web | 信息页 |
| /{zh,en}/oriental | 东方叙事 / D:\web | 信息页 |
| /{zh,en}/about | 品牌 / D:\web | 信息页 |
| /{zh,en}/family-center | 门户 D:\web + Family D:\fc | 演示家庭、成员、目标、时间线；保留原视觉预览。交互正文当前中文 |
| /{zh,en}/application | 门户 D:\web + Application D:\app | 必填资料 → 可选示例材料 → 事实草稿。交互正文当前中文；无真实上传/顾问提交 |
| /education | dirty Education Web / D:\phoenix | 成长探索入口 |
| /education/assessment | 同上 | 五步问卷，7 项核心问题 |
| /education/result | 同上 | 规则 fallback 结果、行动、标签页反馈；无结果时保留既有空状态 |
| POST /education/api/growth-snapshot | 原 validation + createSafeFallback 的 RC 适配 | 本机计算；无 DB / AI provider / 业务后台 |
| /rc/health | RC gateway | backend=deferred、production=false |

## 排除范围

/education/internal/wealth-compass-preview 在演示入口返回 404；Health / Wealth 不在本次范围。
/v1/* 不转接业务后台；验证 /v1/masters/consultations 返回 404。未知 locale/页面返回 404。
门户既有 Digital World 外链保留为外部站点，不算本 RC 页面，也未用它证明完成度。

4310 / 4311 是本机 renderer 端口，演示使用 4300。本轮没有公网发布、TLS、staging 或 production 配置。

## 演示顺序

1. /zh → /zh/family-center，添加演示成员、调整目标、查看时间线。
2. 成长探索 → /education/assessment，完成问卷、查看规则结果并评分。
3. /zh/application，使用虚构示例、加入示例材料、核对事实草稿。

Family/Application 使用专属 RC sessionStorage key，Education 保留 pn:free-compass:* sessionStorage。当前通过导航连接，尚未共享真实家庭身份或后台数据。
