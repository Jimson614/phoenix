# Phoenix Nova Asset Preservation Report

Date: 2026-08-30
Gate: `0 — ASSET PRESERVATION`
Result: `PASS`

## Canonical baseline

- Repository: `https://github.com/yvettfang-netizen/phoenix.git`
- Verified remote default branch: `main`
- Verified remote commit: `955a5cf169125dc4d864969edc022e5a50ea3bc2`
- Delivery branch: `codex/core-identity-gates-0-1-delivery`

The original integration worktree was not merged, rebased, pulled, cleaned, restored, or overwritten during delivery preparation.

## Repository and worktree inventory

| Scope | Purpose | Branch | Full commit |
|---|---|---|---|
| Phoenix Core | Canonical identity and shared-domain repository | delivery based on `main` | `955a5cf169125dc4d864969edc022e5a50ea3bc2` |
| Clean Family OS integration clone | Preserved documentation and UX work | `codex/family-os-doc-baseline-and-ux-v0.2` | `c32f819abcf3fbf2be8e709f04c7ace3ac337dd9` |
| Website V3 | Independent presentation repository | `feat/website-v3` | `bd6c708b36008b0faf4c44b42d41a5c4ac794f07` |
| Website V7 | Independent hosted visual worktree | `codex/website-v7-gate1-visual` | `e841e6bf5d960d62b525776cf02c5d4bde4027d4` |
| Website Recovery | Protected GEO and Insights recovery work | `codex/website-v4-geo-gate1` | `f4e8f9a1f4ebe3dc923be239ce14eca144b78468` |
| Content Automation | Independent publishing workflow | `feat/phase2-wechat-official` | `8a943579b42f597943080390118648ced558de80` |
| Academy | Temporarily independent product/contract repository | `main` | `c32534fc9eee795b6ea57c3d9ff9b2d891cd4db0` |

## Preserved outside Git

The preservation vault contains:

- complete Git bundles for active and dormant histories;
- exact archives of dormant `.git.backup` directories and broken-worktree pointer evidence;
- binary patches for tracked dirty work;
- verified archives of untracked work;
- SQLite-safe snapshots plus raw database/WAL/SHM sets held together;
- Content Automation audit, job, retry, processed-source, output, and publication state;
- Website Recovery GEO/Insights work;
- per-file and aggregate SHA256 manifests.

These assets are intentionally excluded from the delivery branch because they may be large, machine-specific, operational, or sensitive. The off-repository retention key is `2026-08-30_gate0`. Custody and recovery rules are recorded in [GATE_0_1_RECOVERY_NOTES.md](docs/architecture/GATE_0_1_RECOVERY_NOTES.md).

## Git history validation

Ten preservation bundles were verified as complete/recoverable for their advertised refs. The live remote `main` bundle records `955a5cf169125dc4d864969edc022e5a50ea3bc2`.

The following Family OS commits are preserved but not reachable from the verified remote `main`:

- `31b3b7860cbd4d5a750ca009ed38eae698533f0f`
- `c32f819abcf3fbf2be8e709f04c7ace3ac337dd9`

They were not merged or cherry-picked into this delivery.

## Data-state validation

Three SQLite source/snapshot pairs passed `PRAGMA integrity_check`. Source database bytes were unchanged by snapshot creation. No database or record-level contents are committed to Git.

## Non-deletable assets

Until a separately approved retention decision, do not delete or overwrite:

- the original dirty worktrees and Git metadata;
- dormant `.git.backup` histories and Identity Compass pointer evidence;
- the two clean-clone-only Family OS commits;
- database/WAL/SHM source sets and verified snapshots;
- Content Automation operational state and uncommitted adapter work;
- Website Recovery work;
- all checksummed preservation bundles, patches, archives, and manifests.

## Gate 0 decision

- Dirty work protected: PASS
- Dormant history recoverable: PASS
- Database state safely preserved: PASS
- Content Automation state preserved: PASS
- Website Recovery state preserved: PASS
- Unique Family OS commits identified: PASS
- Destructive commands against original worktrees: NONE

Gate 0: **PASS**.
