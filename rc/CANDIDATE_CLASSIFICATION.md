# Phoenix Nova RC — candidate classification

日期：2026-09-12。只组装四个现有候选的前端 RC；工作站整体结论仍为 HOLD。

| 原工作区 | Branch / exact source HEAD | 分类与本轮采用 | 保留但未启动 |
| --- | --- | --- | --- |
| D:\web | codex/website-v5-release-hardening-20260910 / d1942dec9354b87ec2eca0912be96275e485eca8 | ACTIVE：RC Git 基线、Website V5 中英文门户与品牌资产 | Vinext / Cloudflare 部署链未认证；原 Family Center 视觉预览仍保留 |
| D:\fc | codex/family-core-sandbox-20260909 / 6141d863475f146ec2494ebadd39c447fd38e9f5 | ACTIVE：Family 模型、repository、schema、日期/ID 工具；成员、目标、时间线体验 | Native 小程序、Core 身份、Guardian / Consent / RBAC、PostgreSQL sandbox、API skeleton / policy |
| D:\app | codex/masters-intake-release-determinism-20260909 / ef74fba6e1f264180eb0f65f749a200298ce88d9 | ACTIVE：masters-intake / labels 的资料校验、材料分支与事实草稿规则 | 完整 native 咨询、真实文件/解析、confirm/submit、顾问工作台、报告、worker、PostgreSQL |
| D:\phoenix | main / 846f77c120cd00a49d89635dd4297b020af7d03a + 未提交 Education 快照 | ACTIVE / PROTECTED DIRTY：当前 Education Web 问卷、结果、反馈、资产与 Web 测试 | HEAD 不能代表当前 Education；原修改、删除与未跟踪文件均保护，不整理、不提交到 main |
| D:\phoenix-rc | codex/phoenix-nova-rc-20260912 / 以最终 RC commit 为准 | ACTIVE：本次独立 RC 集成与演示根目录 | 不取代来源中尚未完成的工作 |

四个工作区不能按“main 最新”或目录名称折叠成一个版本。Website 只提供门户基线；Family/Application 提供既有模型与契约；Education 取脏工作区实际文件。

本轮增加浏览器适配组件与单一入口。Family/Application 是现有模型驱动的可交互演示，不声称原生全部页面或身份后台已经接入。Education Web 的实际交互复制到独立运行目录。原 native/backend 内容保存在 rc/sources。

本轮没有把任何候选列为 ARCHIVE CANDIDATE 或 SAFE TO REVIEW FOR DELETION，没有处理旧目录。V7 未验证，不采用未知 V7 文件，不做文件夹同步。
