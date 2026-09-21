# V7 Codex Workspace Index Template

状态：`TEMPLATE_ONLY`；目标 V7 当前不可达，本文件尚未写入 V7。

## Expected layout

```text
D:\CODEX\
├── 00_INDEX\
│   ├── README.md
│   └── REPOSITORY_INVENTORY.md
├── 01_PHOENIX\
│   ├── phoenix\
│   └── worktrees\
├── 02_KAIDE\
└── 99_ARCHIVE\
```

## Agent entry rules

1. 先读 `00_INDEX/README.md` 与 `REPOSITORY_INVENTORY.md`，再进入 repo。
2. 不递归扫描 `99_ARCHIVE`、`node_modules`、build output、backup、database data directory。
3. 不把 worktree path 当作独立 remote repository。
4. 任何写操作前核对 `git status --short`、branch、HEAD、remote。
5. dirty worktree 不允许 force checkout、reset、覆盖或移动。
6. secret 只记录变量名和来源，不记录值。
7. production merge、migration、deployment 必须有单独 Gate。

## Repository inventory schema

| Product | Authoritative path | Remote | Branch | Exact SHA | Dirty | Runtime | DB / migration | Owner | Last verified |
|---|---|---|---|---|---:|---|---|---|---|
| Phoenix monorepo | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` |
| KAIDE | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` |

## Candidate registry

| Domain | Candidate branch | Exact SHA | Gate | Supersedes | Notes |
|---|---|---|---|---|---|
| Family Core | `codex/family-core-sandbox-20260909` | `6141d863475f146ec2494ebadd39c447fd38e9f5` | policy 18/18 + PostgreSQL 35/35 CI PASS | PR #11 head | fork-published as upstream Draft PR #14 |
| Application Compass | `codex/masters-intake-release-determinism-20260909` | `ef74fba6e1f264180eb0f65f749a200298ce88d9` | engineering PASS / UAT blocked | PR #9 head | fork-published as upstream Draft PR #15 |
| Website V5 | `codex/website-v5-release-hardening-20260910` | `d1942dec9354b87ec2eca0912be96275e485eca8` | engineering PASS / production HOLD | PR #6 head | fork-published as upstream Draft PR #16; no deploy |
| Education Compass | working tree over `main` | `846f77c120cd00a49d89635dd4297b020af7d03a` + dirty diff | production blocked | — | preserve patch; not a commit candidate |

## DO NOT SCAN / archive policy

Archive entries must include: source path, captured SHA or checksum, capture date, reason, and replacement authority. An archive is never a deploy source unless explicitly promoted through a new Gate.
