# 成鳞 42% V1.1 资产登记

Status: **BLOCKED_ASSET** — no approved V1.1 artwork or animation package is bundled.

The source task is “设计鳌鱼五阶段头像” (ChatGPT task `6a9a69e7-88e0-83ea-9f2b-83481f96694c`). Its V1.1 response is turn `ddc6a53b-8871-43fb-8dcc-d8b92ea21d95`, message `9efadd6b-6d6e-4f8a-826f-15177a07b486`. The available cloud read exposes four content-reference placeholders, not downloadable HTML / MP4 / PNG / ZIP attachments. No source file or artwork checksum can therefore be claimed.

The original 244 × 165 reference image (`9e227718-0383-4e88-90dc-01c1cdbb1d22.png`, SHA256 `B70DC9F86FD99A79D06CBD7691F42ACEC841554CFDD804C3F0B061109D549708`) is an early reference, not a verified V1.1 master. It has not been copied here or used as a substitute. Existing hero / poses / expressions assets are not relabeled as V1.1.

The component intentionally renders a text-only companion until approved assets are supplied. The student interface does not display engineering blocker codes. Inspect `data-asset-status`, `data-blink-status`, and `data-progress-status` for audit evidence.

## Required handoff before visual acceptance

1. Recover the original V1.1 HTML, preview MP4, PNG master and ZIP source package.
2. Record each original filename, exact source, version, SHA256, approver and approval reference.
3. Place the approved master under this directory and pass `approvedAsset={version:"1.1",approvalRef,src,alt}`. Use a repository asset path under `/assets/aoyu/chenglin-v1.1/`.
4. Natural blinking additionally requires an approved, transparent closed-eye layer aligned to the same full canvas, passed as `closedEyesSrc`. Without it, the component shows the approved static artwork but reports `data-blink-status="UNAVAILABLE"`; it never draws guessed eyelids on the character.
5. Validate the aligned eye layer, subtle motion and completion feedback against the recovered prototype, then capture actual screenshots and video. The current code must not be described as a visually verified reproduction of V1.1.

## Frozen motion parameters

- Natural interval: 5.8–11 seconds.
- Single blink: 360ms.
- Double-blink probability: 6%; gap: 540ms.
- Reduced-motion mode: static feedback and only low-frequency blinking if an approved eye layer exists.
- Hidden tab, offscreen component, or pause: discard animation timers; resume starts a fresh interval and never replays learning events.
- Sound defaults to off. `soundEnabled` is an interface only: no audio, browser speech or microphone is implemented.

This gate does not add the other four stages' artwork, Rive production rigging, generated replacement characters, or learning decisions.
