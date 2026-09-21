# Phoenix Codex Workspace Migration Report

审计时间：2026-09-09（Asia/Shanghai）  
最终结论：`AUDIT_AND_PRESERVATION_COMPLETE / V7_MIGRATION_BLOCKED_EXTERNAL`。未执行任何可能覆盖 V7 或本机 dirty worktree 的迁移。

## 本机发现

- 预期源目录 `D:\CODEX` 不存在。
- 本机 Phoenix 主仓库位于 `D:\phoenix`。
- 未发现可核实的 KAIDE checkout。
- 未发现现有 SMB drive mapping。
- 主机名 `V7` 无法解析，TCP/445 不可达。

## Repository inventory

| Path | Branch / state | Exact SHA | Dirty | 判定 |
|---|---|---|---:|---|
| `D:\phoenix` | `main` | `846f77c120cd00a49d89635dd4297b020af7d03a` | 117 status entries | 主工作树；不得覆盖 |
| `D:\fc` | `codex/family-core-sandbox-20260909` | `6141d863475f146ec2494ebadd39c447fd38e9f5` | 0 | Family Core clean candidate; fork-published as Draft PR #14; exact-head CI PASS |
| `D:\app` | `codex/masters-intake-release-determinism-20260909` | `ef74fba6e1f264180eb0f65f749a200298ce88d9` | 0 | Application clean candidate; fork-published as Draft PR #15 |
| `D:\web` | `codex/website-v5-release-hardening-20260910` | `d1942dec9354b87ec2eca0912be96275e485eca8` | 0 | Website clean candidate; fork-published as Draft PR #16 |
| `C:\Users\1\Documents\Codex\2026-09-04\new-chat\work\aoyu-gate1` | `codex/aoyu-companion-gate1-20260904` | `a85c90f49031e7be8598efb8183476021a82109a` | 0 | 独立 clean worktree |

Remote：`https://github.com/yvettfang-netizen/phoenix.git`。

## Dirty worktree preservation

对 `D:\phoenix` 的 Education Compass 活跃修改执行了非破坏性快照：

| Artifact | 内容 | SHA-256 |
|---|---|---|
| `phoenix-education-working-tree.patch` | tracked Education Compass diff | `557f593b43bf2ea5a7f641329ee3f5dc5e5d3f0554cfc1d63809828a053a0bea` |
| `phoenix-education-untracked-source.zip` | 20 个 untracked Education source files | `46c4d19384246abe6fdc5af6153fc8672e16823c6fd60ffc9e2c4020efdbda32` |

Identity／Wealth 的 4 个私有微信项目配置未打包、未读取 secret 值、未改动，避免将可能的本机私有配置扩散到迁移包。

## 未执行的迁移

以下动作因 V7 不可达而未执行：

- 创建或写入 `D:\CODEX\01_PHOENIX`、`D:\CODEX\02_KAIDE`、`99_ARCHIVE`。
- 覆盖、移动或删除 V7 现有资产。
- 删除本机原件。
- 把 dirty worktree 当成 clean commit 或权威发布版本。

因此目前仍不能证明“V7 已拥有全部唯一权威 Phoenix 文件”；只能证明活跃 Education 修改已经有可校验的本机恢复包。

## 安全恢复步骤

1. 由基础设施负责人提供 V7 的可解析 hostname/IP 与 SMB share，确认 TCP/445 可达。
2. 只读列出目标 `01_PHOENIX`、`02_KAIDE`、`99_ARCHIVE`，生成冲突清单。
3. 为目标目录制作备份或快照，再创建迁移批次目录；禁止原位覆盖。
4. clean repository 优先按 remote + exact SHA 重建；dirty 内容用 patch/archive 作为独立恢复输入。
5. 逐 repo 核验 `remote / branch / HEAD / status`，写入 V7 INDEX。
6. 在 Jimson 确认 V7 副本完整前保留所有本机原件。

随附 `V7_WORKSPACE_INDEX_TEMPLATE.md` 可在目标可达后使用。
