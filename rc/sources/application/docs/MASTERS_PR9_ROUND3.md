# PR #9：CI 与隔离工程验收

继续 `codex/masters-intake-p0`，输入基线为 `1eb1e019be997adfa2ccb2d6d454416e91c130e8`。本文说明执行机制；实际结果以同一新 SHA 的 Actions run 和 artifact 为准，不把设计说明或旧测试当作通过。

## 自动检查

根目录 `.github/workflows/masters-intake-ci.yml` 对任务分支 push、相关 PR 和手动事件生效。工作目录为带空格的 `Phoenix Compass/education compass`；checkout 实际 PR head/push SHA，不用合并预览 SHA。仅 `contents: read`，不持久化 Git 凭据、不使用 `pull_request_target`、不注入仓库秘密、不部署。

依照两份现有锁文件执行 `npm ci`，Node 24 满足服务端最低 22.13.0。临时安装 Playwright 1.58.2/Chromium；中文测试字体来自 [Noto CJK 固定提交](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c)，遵守其中的 SIL Open Font License。`NotoSansSC-VF.ttf` SHA-256：`d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964`。字体不提交仓库，不替代目标主机授权核验。

实际执行现有命令：`npm run test:all`、`node scripts/test-masters-workbench.js`、`npm run test:release`、`npm run scan:release-secrets`、`npm run test:education-postgres`、`npm run test:masters-postgres`、`npm run build:release`，以及只读环境检查。

默认 `verify:masters-candidate` 保留外验未完成的 BLOCKED/退出码 2。CI 显式使用 `--automation-only`，严格依据真实测试的语义结果决定自动检查退出码。缺连接、字体、跳过、BLOCKED、缺 HTTP/权限/恢复证据不能自动 PASS。外部闸门不因此改变，离线包仍为 `OFFLINE_TEST_ONLY`，不授权上传。

## 临时 PostgreSQL

`scripts/ci/masters-isolated-postgres.js` 仅在 GitHub Linux 临时 runner 执行。固定摘要的 PostgreSQL 16.13 镜像，仅映射 runner `127.0.0.1` 端口，不安装本机服务、不购买资源、不增加 Actions 额度、不接入公司数据库。

随机生成密码、会话密钥、一天有效的测试 CA/服务端证书，只传给本次测试进程，不写仓库或 GitHub Secrets。保留 `sslmode=verify-full`，读取 `pg_stat_ssl` 确认 TLS 1.2/1.3，并实际验证不可信 CA、错误主机名、明文连接被拒绝。错误域名仅在负向测试进程内映射到本机，不改操作系统 DNS。

新建 `education_ci_test`、`masters_ci_test`、`masters_release_restore_ci_test`、`masters_withdrawn_restore_ci_test`，撤销 PUBLIC 数据库和 public schema 权限。分别建立 education 迁移、Masters 迁移、Masters HTTP 应用角色；均无 superuser、createdb、createrole、replication、bypassrls。

迁移角色只在专用库的随机 UUID schema 执行原样 001–006、006 down/up 和清理。HTTP 使用独立 DML 账号：schema USAGE、业务表 DML、迁移记录只读，无表所有权或角色继承。实际断言建表、建/删 schema、变更迁移记录被数据库拒绝。手工独立测试时新增 `MASTERS_TEST_APP_DATABASE_URL`：同库、同 CA、不同账号；迁移连接仍为 `MASTERS_TEST_DATABASE_URL`，显式哨兵仍为 `MASTERS_TEST_DATABASE_ALLOW_MUTATION=YES`。

## 加密备份与恢复

只生成虚构申请人和原件。在已开放报告、已撤回清理两个检查点停止源 HTTP 写入，将真实 `pg_dump` 与私有原件联合 AES-256-GCM 加密；密钥仅留内存，验证篡改密文无法解密。分别 `pg_restore` 到两个全新的干净库和私有目录。

恢复后的 HTTP 仍使用 DML 账号，核对咨询、报告 ID/资料版本/报告版本、原件摘要、学生/当前顾问下载、旧顾问/其他学生拒绝及报告导出。样本包含既有固定官网来源项目，验证规则草稿经顾问复核成为 `ADVISOR_VERIFIED_PLAN`，由 Founder 批准/开放，恢复后项目、来源、分类和导出一致；撤回检查点不能重新开放材料或报告。数据库包、原件、密钥不上传 artifact。清理仅作用于本次 UUID schema、命名容器及其数据卷、临时文件，不执行 Docker 全局 prune。

## 证据与边界

Artifact `masters-engineering-<SHA>-<attempt>` 包含 `summary.json`、`infrastructure.json` 和脱敏日志，绑定实际 checkout/test SHA、tree、时间、Node/npm、命令、日志 SHA-256。PR #9 当轮评论列实际 Run URL、ID、事件和 GitHub conclusion，旧版本证据保留为历史。

逐项使用 PASS / FAIL / BLOCKED / NOT_IMPLEMENTED：POSTGRESQL_HTTP、CI、ISOLATED_BACKUP_RESTORE、TARGET_HOST_SECURITY、WECHAT_DEVTOOLS、WECHAT_IOS、WECHAT_ANDROID、REPORT_ASSISTED、AUTO_SCHOOL_MATCHING。自动报告验证指有来源项目的合成身份编辑、复核、批准、查看和导出；真实顾问 UAT 仍需另验。

目标主机 ACL、静态加密及恢复、微信开发者工具、iOS/Android 按 [Jimson 交接](MASTERS_JIMSON_TEST_ENV.md) 独立记录。配置存在不是 PASS，网页不是微信，临时库不是目标主机。保留规则草稿和顾问核验完整方案，`AUTO_SCHOOL_MATCHING=NOT_IMPLEMENTED`。未合并、未部署生产、未开放真实学生资料或外部 AI。
