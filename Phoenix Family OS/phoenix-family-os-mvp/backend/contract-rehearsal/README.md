# Family OS 合成契约演练 V1

状态：`SYNTHETIC REHEARSAL / FOUNDER REVIEW REQUIRED / NO PRODUCTION AUTHORITY`

这是测试目录中的隔离参考模型，不是 Family OS 服务端、Core 服务、数据库适配器或可上线产品。仅接受固定虚构样例，不能上传客户问卷或业务数据。没有 HTTP 服务、网络调用、环境变量读取、文件写入、数据库或外部写回。仅显式传入 `mode: SYNTHETIC_ONLY` 才能实例化。

## 运行

在 Family OS 项目根目录，用 Node.js 24 执行：

```sh
node backend/contract-rehearsal/run.cjs
```

零新增依赖。入口依次检查：运行代码没有引用本目录、`backend` 仍在小程序打包排除清单中、适配器静态导入白名单、4 个 CJS 文件语法、合成契约测试及覆盖率。静态扫描不是沙箱或生产安全证明。

## 文件

- `fixtures.cjs`：2 个虚构家庭、固定父母/监护人/学生/顾问、3 个 Compass 的受控样例和 Mock Core。
- `adapter.cjs`：严格样例校验、模拟授权、内存交接/Timeline/Journey、主动请求顾问、显式分配后开案和受保护笔记引用。
- `adapter.test.cjs`：成功、拒绝、重放、撤回、过期、失败注入、回滚、快照防修改测试。
- `run.cjs`：本地验证入口；不被适配器或产品导入。

## 权限与数据边界

1. 身份和规则均为 `SYNTHETIC_*`；没有签发真实 Core ID，也没有导入实际题库、评分或政策。
2. 唯一可能通过的 payload 使用固定测试值；未知字段、任意自由文本、真实文档、公共报告 URL 和客户端角色声明均拒绝。
3. 每次重复提交重新核验模拟成员关系、监护关系、授权、权益和映射状态；原成功回执不能绕过撤回。
4. 每次操作先修改独立内存副本，只有审计和提交故障点均通过才替换状态；拒绝只追加最小化模拟审计，不写原始输入。
5. 返回值和测试快照都是深拷贝；没有原地修改 Timeline 的接口。
6. 顾问跟进必须另有目的授权和有效家庭分配。笔记只放固定 `content_ref`，不进入 Timeline。
7. Health 保持未启用。这里不解释、不实现其他窗口可能讨论的 Health 产品设计。

## 限制，不得扩大验收表述

- Mock Core 是固定测试状态，不是身份认证、正式同意账本、RBAC/RLS 或生产审计。
- `inspectSyntheticState` 是仅用于断言的全局测试快照，不可作为 API、家庭页或顾问页数据来源。
- 同一进程的 100 次重放只证明此同步模型的重复处理，不证明多进程/分布式并发安全。
- 新实例丢弃全部内存；持久化 outbox、跨重启恢复、真实数据库事务和独立进程故障恢复不在此演练中。
- 演练拒绝全部非固定字段值，不是可泛化 JSON Schema 校验器；不能据此宣称接收任意真实 Education/Identity/Wealth 输出。
- 当前 `npm run typecheck` 仅检查既有两个文件，不覆盖这些 CJS；CJS 验证由语法检查、严格样例校验及测试承担。
- `npm run build` 是项目结构验证，不是微信平台编译；模拟器、iOS/Android 与人工验收未运行。

契约差异、尚未批准的决定与后续 gate 见 [演练审查说明](../../docs/contracts/SYNTHETIC_REHEARSAL_REVIEW_V1.md)。本目录不改变既有 PR #10 的文档，也不代表批准该 PR 的产品决定。
