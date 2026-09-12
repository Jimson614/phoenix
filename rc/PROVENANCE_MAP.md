# Phoenix Nova RC — provenance map

RC 分支：`codex/phoenix-nova-rc-20260912`；exact RC SHA 用 `git rev-parse HEAD` 读取，外部 release manifest 记录最终值。
本次没有将 main@846f77c 宣告为完整产品，也没有 Git merge；从 Website 分支独立建 worktree，再按模块复制并适配。

| Major module | Source workspace / branch / exact HEAD | 来源记录 | RC runtime |
| --- | --- | --- | --- |
| Website / brand / portal | D:\web · codex/website-v5-release-hardening-20260910 · d1942dec9354b87ec2eca0912be96275e485eca8 | source-provenance.json: website；原文件从该 commit 读取 | website/phoenix-nova-website-v5 |
| Family OS | D:\fc · codex/family-core-sandbox-20260909 · 6141d863475f146ec2494ebadd39c447fd38e9f5 | rc/sources/family，逐文件 SHA-256 | portal lib/rc/family/*.cjs + FamilyExperience |
| Application Compass | D:\app · codex/masters-intake-release-determinism-20260909 · ef74fba6e1f264180eb0f65f749a200298ce88d9 | rc/sources/application，逐文件 SHA-256 | portal lib/rc/application/*.cjs + ApplicationExperience |
| Education Compass Web | D:\phoenix · dirty main · 846f77c120cd00a49d89635dd4297b020af7d03a + working-tree snapshot | rc/sources/education，逐文件 SHA-256，dirty=true | rc/education-web |
| RC integration | 本次新代码 | 本 RC commit | preview.cjs、浏览器/storage 适配、路由与测试 |

## 来源验证

source-provenance.json 包含每个入选原文件 SHA-256 和 snapshotDigest；Education 的 dirty snapshotDigest 用来区分未提交内容与旧 HEAD。
Website 的 files/snapshotDigest 使用原 Git blob 字节；workingTreeFiles/workingTreeSnapshotDigest 单独保存 Windows checkout 字节，避免把 CRLF 转换误判为产品差异。
rc/sources 按原始字节保存，rc/.gitattributes 禁止自动文本转换，不在快照内改代码。Website 原始 blob 由基线 Git commit 保证。
`node rc/verify-provenance.cjs` 校验快照工作文件及 Git index 字节，Website 则校验基线 commit blob。此检查不对未获取的远端/V7 作承诺。

## 适配变更

- Website：增加 application 路由、RC 导航、Family 交互组件、Education CTA；增加 native Next 本地构建 profile。原 Vinext 部署脚本未运行。
- Family：保留 repository/schema/date/id 逻辑；将 wx storage 换成专属 RC sessionStorage；ID 加 rc_demo_ 前缀；reset 仅重置 RC key，不产生 Core 权威 ID。
- Application：保留 masters-intake/labels，CommonJS 后缀改 .cjs；新增浏览器三步界面与标签页草稿。示例材料只有元数据，MANUAL_REVIEW 不表示解析完成。
- Education：从 dirty snapshot 抽出 app/src/public 与锁定依赖；添加 /education basePath、资源/API路径、返回门户与 noindex；API 关闭 provider、使用规则 fallback；运行包只暴露可用 Web scripts。
- Git 基线中其他旧 Education/Family 根目录是继承的历史内容，不是本 RC 模块权威。选用范围以本表为准。

原来源保护凭据：审计 outputs/RC_SOURCE_PROTECTION_BEFORE.json 与 AFTER.json。比对 HEAD、branch、status 和全部 tracked/nonignored untracked 文件字节；node_modules 等 ignored 目录不属于该字节清单。
