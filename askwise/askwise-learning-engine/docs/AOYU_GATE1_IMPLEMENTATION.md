# Aoyu Gate 1 implementation candidate

Status: PARTIAL_IMPLEMENTATION / BLOCKED_ASSET / BLOCKED_EVENT_SOURCE / UAT_NOT_RUN.
Baseline: yvettfang-netizen/phoenix, main 846f77c120cd00a49d89635dd4297b020af7d03a.
This candidate is not Founder approval, an Academy integration, or production deployment.

## Scope

The existing `/student-task` and `/task/[taskId]` routes consume the existing pilot identity, task/session snapshots, persisted Hint 1–3, and confirmed completion evidence. Form focus, blur, retry submission and failed requests provide actual UI events. No timer fabricates learning events. The academic engine, schema and identity/permission model are unchanged; engine-file edits are type-only corrections.

`AoYuCompanion` accepts `progress`, `aoyuState`, `soundEnabled`, `scopeKey`, `eventKey`, and `completionKey`. Its only speech comes from the seven fixed strings. It defaults to text fallback and never plays sound. It does not receive progress in the actual pilot routes because no authoritative Aoyu growth source exists. `calculateAoyuStage(42)` returns CHENGLIN, 41–65, and 1/24 stage progress. The 42% example is not a student's live progress.

Approved V1.1 images and an aligned closed-eye layer can be supplied through `approvedAsset`; see `public/assets/aoyu/chenglin-v1.1/README.md`. No approved artwork is bundled. Current CSS and scheduling provide an integration seam, not a faithful conversion of the unavailable HTML. State-specific head/nod/water-ring/scale animation and asset provenance remain blocked.

The presentation ledger uses localStorage per stable student scope and Web Locks for tab concurrency. It consumes hidden events rather than queues them, limits daily welcome, enforces the 90-second encouragement interval across midnight, suppresses consecutive identical messages, and identifies completion by task/session rather than replaceable evidence row IDs. Storage or lock failure suppresses welcome/celebration conservatively. This guarantee is browser-local; clearing storage or another device is outside it. Cross-device exactly-once delivery needs a separately approved durable source.

## Baseline fixes required for validation

- Correct invalid `studentDbReady` export, missing SQLite row/types, and existing engine type annotations/imports; `0` to `false` preserves the existing false branch.
- Pin better-sqlite3 13.0.3 because 9.6.0 has no Node 24 Windows prebuild and local C++ tools are absent. The new driver's bundled N-API binaries are described in its [official release notes](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0). This is a major dependency upgrade requiring Founder review; no existing customer DB was opened or migrated.
- Initialize the pilot DB on first request and force dynamic learning routes. Concurrent build imports previously opened/seeded SQLite and failed with SQLITE_BUSY; builds now avoid reading/baking student records.
- Add explicit lint/typecheck configuration, consistent npm/pnpm locks, and ignore local runtime data.
- On failed form submission, preserve inputs; re-read authoritative state only when online. Do not automatically retry writes. A transport error does not prove DB rollback; the baseline action still has multiple non-transactional writes and a later logger step.

## Verification

Use Node 24.19.x and npm 12.0.2. `npm ci --ignore-scripts`, then `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. The candidate was verified using the bundled Node 24.19.0/npm 12.0.2. Unit/SSR/client tests: 111 PASS; prior engine and Compass-adapter tests included. The existing Tailwind content warning is non-fatal.

The local Edge browser smoke flow uses a fresh browser profile and the isolated worktree's generated pilot database with explicitly synthetic tasks. It verifies focus re-entry, persisted Hint and completion, refresh suppression, offline input preservation/recovery, and 390px mobile layout/reduced-motion. Its P1/P2/P3-labelled input scenarios are engineering coverage only, not three distinct student identities, not proof of their actual learning modes, and not three 15-minute UAT sessions.

## Remaining acceptance gates

1. Obtain original 成鳞42动画样机_V1.1 HTML/ZIP/approved artwork and implement/verify the actual visuals.
2. Obtain the completed Academy/ASKWISE candidate and confirm the intended student panel and stable identity scope; the old pilot is not a substitute.
3. Bind real growth and pause events; maintain explicit blocked source status until then. Hint 4–5 keep normal task behavior but have no invented Gate 1 HINT mapping.
4. Run three existing controlled students for about 15 minutes each; record subjective distraction/copy feedback and failures. No real customer data without consent.
5. Founder reviews the dependency/runtime repairs, evidence, remaining gaps and rollback before any merge/deploy.

Rollback: no production change exists. Stop the local preview and keep using the original checkout. Reject this candidate branch or reverse its commit in a separate branch; never reset the original dirty main. No schema migration or customer-data rollback is involved.
