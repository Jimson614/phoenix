# Gate 0/1 Recovery Notes

Status: `FROZEN DELIVERY EVIDENCE`

## What is intentionally not in Git

The delivery branch excludes all preservation bundles, patches containing business-source changes, untracked business assets, databases, WAL/SHM files, runtime state, logs, processed source material, publication identifiers, retry state, environment files, credentials, and machine-specific pointer files.

These items remain in the Founder-controlled off-repository preservation vault under retention key `2026-08-30_gate0`.

## Git-delivered recovery evidence

- [Asset preservation report](../../PHOENIX_ASSET_PRESERVATION_REPORT.md)
- [Gate report](../../PHOENIX_CORE_IDENTITY_GATE_REPORT.md)
- `GATE_0_1_DELIVERY_MANIFEST.sha256`
- `GATE_0_1_VALIDATION.md`

The in-repository manifest covers only approved documentation delivered by this branch. It is not a substitute for the separate preservation-vault manifest.

## Recovery rules

1. Recover into a new empty directory; never restore over an original dirty worktree.
2. Verify the selected bundle/archive against the preservation-vault SHA256 manifest.
3. Verify Git bundles before fetching an advertised ref.
4. Validate a patch against a clean checkout of its recorded base before applying it.
5. Treat each SQLite database, WAL, and SHM source set as one state; prefer the verified consistent snapshot for normal recovery.
6. Restore Content Automation state offline and inspect jobs, retry state, audit evidence, and publication identifiers before enabling any publisher.
7. Do not repair the Identity Compass broken pointer by deleting historical metadata; recover its preserved bundle into a new repository.
8. Escalate checksum mismatch, missing sidecar file, or identity ambiguity. Do not improvise a merge.

## Retention

The preservation vault remains non-deletable until the Founder approves a tested replacement backup and a documented retention change. The GitHub delivery contains architecture evidence only.
