# PR #9：简历优先流程与外部验收补证

本轮从 `29df2358718232294dcda4af9f2410fd0b32aab6` 增量修改同一分支 `codex/masters-intake-p0`。原始 BASE 为 `846f77c120cd00a49d89635dd4297b020af7d03a`，仓库 `yvettfang-netizen/phoenix`。这是实现和复跑说明；当前候选的实际结果见同一 Draft PR 正文与下述按 SHA 保存的证据。上一轮 110/110 仅为历史记录，不能跟随 PR HEAD 自动视为通过。

## 学生体验与保留规则

| 场景 | 本轮修改 | 验证范围 |
| --- | --- | --- |
| 有简历 | 授权后先上传简历/成绩单，展示可确认的来源事实与人工核验提示；默认不展开完整背景表。必要联系/意向保留，缺项单独补录，完整编辑需要主动打开 | 客户端状态与请求契约测试；微信画面尚缺 |
| 无简历 | 教育背景、成绩语言、申请意向、相关经历四步；允许返回、保存及恢复服务端草稿 | 页面处理器及恢复测试；真实微信仍待验收 |
| 中文选项 | “尚未确定，希望顾问建议”内部映射 `UNDECIDED`；经历类型、上传/解析状态、确认页字段与报告能力显示中文 | 客户端标签/模板契约测试 |
| 材料和版本 | 简历、成绩单、语言、在读证明、毕业证、学位证、补充材料七类独立卡片；学籍切换隐藏但保留原件；缺件可提交 | 真实本机 multipart、私有文件、权限与版本回归 |

不降低资料确认、授权、服务端校验、20 份/10 MB 上限、私有文件和账号切换隔离。旧产品价格、支付、冻结文件、001–005 migration 保留；不增加副学士模块。

客户端草稿提交增加明确的空值转换：未填写的联系方式和可选日期传 `null`，暂无语言成绩传 `languageScores=null`，避免 UI 空字符串被真实服务端拒绝。HTTP 回归直接导入客户端序列化函数，核对部分填写、语言小分、经历日期和重启恢复，同时保留非法日期/邮箱的拒绝规则。切换到分步填写的 `path` 也通过同一版本化 PATCH 持久保存。

## 报告能力必须分别陈述

1. **规则草稿**：默认无候选院校，不代表完整选校；不能因成功导出而称为完整方案。
2. **顾问核验后的方案**：服务端派生能力标签。未复核、候选为空、方向或计划缺失均不能标记完整；有来源项目还需非未来核验日期、与咨询一致的入学年份、顾问复核及 Founder 批准/开放。修改产生新版本并清除旧审核，资料变化使旧报告失效。
3. **自动选校尚未实现**：`AUTO_SCHOOL_MATCHING=NOT_IMPLEMENTED`。没有自动院校目录检索、匹配或生成；外部 AI/OCR/运行时官网搜索保持关闭。官网 URL 格式和人工核验标记不等于程序自动鉴定来源真实性。

有来源测试使用完全虚构的计算机专业申请人，以及人工查阅的 [香港科技大学 2027/28 MSc in Big Data Technology 官方项目页](https://prog-crs.hkust.edu.hk/pgprog/2027-28/msc-bdt)。来源查阅日期为 2026-09-05；固定测试资料在 `server/tests/fixtures/masters-sourced-program.ts`，不把官方学校伪造为合成来源，也不使用真实学生。匹配说明注明语言/资格仍需个案核验，没有录取承诺。

`masters-workflow-http.test.ts` 用合成顾问/Founder 角色验证编辑 → 复核 → 批准 → 开放 → 学生查看 → PDF/XLSX 的版本、项目字段与内容摘要一致，并拒绝待核验来源、保留域名、未来核验日期和错误申请季。`test-masters-workbench.js` 通过真实浏览器编辑同一类来源项目并下载 XLSX。自动化中的角色行为证明权限和流程可执行，**不是现实顾问已为真实个案签字**。

常规无系统标签的 DOCX、文本 PDF 和图像扫描 PDF 分别经真实上传、私有保存和下载字节核对：无法可靠提取时进入人工核验，不捏造识别结果，也不要求重排附件才能先咨询。局部明确标签可直接解析，通用简历理解和扫描 OCR 尚未实现。

## 真实 PostgreSQL 与微信外部条件

配置、最小权限、负责人、审批和外部矩阵见 [Jimson 安全交接清单](MASTERS_JIMSON_TEST_ENV.md)。凭据由 Jimson 通过受控秘密渠道注入运行环境，Founder/运营不粘贴密钥；本文件不是消息派发或生产授权。

`masters-postgres.test.ts` 保留专用测试库哨兵与随机 UUID schema，执行 006 up/down/up、旧表与 migration 保留、重连、约束、并发及 lease fencing。新增 `fixtures/masters-postgres-http-flow.ts` 明确构造 PostgresStore，经真实 HTTP 上传七类材料、替换、关闭服务/Store 后重建、鉴权下载、顾问改派、队列/报告审核和导出；直接 SQL 核对数据库行。不能回退 FileStore，也不能把缺字体的 PDF 503 算为成功。

目前未提供专用 PostgreSQL、受控测试 AppID、批准的 HTTPS/合法域名及真机条件，因此 SQL/HTTP PostgreSQL、目标主机 ACL/静态加密/清理与数据库附件联合恢复、微信开发者工具、iOS 和 Android 的实际记录仍缺失。浏览器与 FileStore 流程单独报告，不能替代这些项目。真实微信必须通过 `wx.login` 和后端真实 `code2Session`，测试申请资料仍全部虚构。

## 候选证据生成

先提交所有修正并保持工作树干净，再运行：

```text
npm run verify:masters-candidate
```

该命令记录 HEAD/tree、开始结束时间、Node/npm、两份 package.json 的版本与 SHA-256，顺序执行附件要求的七条命令和只读环境检查：

```text
npm run test:all
node scripts/test-masters-workbench.js
npm run test:release
npm run scan:release-secrets
npm run test:education-postgres
npm run test:masters-postgres
npm run build:release
node scripts/check-masters-test-environment.js
```

浏览器测试需已安装的 Playwright 和浏览器，路径通过 `MASTERS_BROWSER_TEST_MODULE` / `MASTERS_BROWSER_EXECUTABLE` 注入；中文字体按运行文档配置。日志与 `summary.json` 位于被 Git 忽略的 `outputs/masters-round2/<HEAD_SHA>/`，每个日志在汇总中有 SHA-256，不提交原始敏感日志。

脚本不会把退出 0 的 `BLOCKED_EXTERNAL` 或 skipped 记为 PASS。Masters PostgreSQL 只有明确连接、无失败/跳过且 `httpFlow=PASS` 才通过。离线构建保持 `OFFLINE_TEST_ONLY`；没有实际 CI 记录就是 `NOT_RUN`。本地汇总不能自动批准外部主机/真机项目，因此剩余外部项时退出 2、总状态 BLOCKED；这不是单元测试失败。任何后续代码修改都需要新提交和新 SHA 下重跑，不复用旧目录。

本轮交付停止在同一 Draft PR 审阅位置。数据库、授权、微信运行与安全 P0 证据清零之前，不申请 Founder UAT。

```text
MERGED: NO
PRODUCTION_DEPLOYED: NO
REAL_STUDENT_DATA_ENABLED: NO
```
