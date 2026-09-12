# Founder Approval Evidence V1

```yaml
evidence_version: founder_approval_evidence_v1
captured_from: CURRENT_CODEX_USER_MESSAGE
captured_at: 2026-08-25T15:57:29+08:00
approved_at_source: SYSTEM_CAPTURE_TIME_OF_APPROVAL_MESSAGE
approved_by: Jim
approved_role: Founder
decision: APPROVE_WITH_CHANGES
identity_assurance: USER_ASSERTED_IN_CURRENT_CODEX_SESSION
effective_scope: PRODUCT_SPECIFICATION_ONLY
```

## Captured approval message

The following is the rendered text captured from the approving user message. It is retained here so the evidence contains the actual approval statement, not only a derived summary:

```text
按推荐方案生成冻结包。

批准人姓名：Jim 
批准人角色：Founder
价格：3990分
支付时点：AFTER_SUBMIT_BEFORE_REPORT，学生先完成并提交问卷，然后付款解锁完整报告，
正式体系：GAOKAO、DSE、IGCSE、A_LEVEL、AP_US，内地大专，内地本科双证（兼读），内地本科（单证），海外学士（全日制），香港副学士等
IB：公共题 fallback
OTHER：公共题 fallback
评分：NONE，不计算分数，只分析
成绩资料：RANGE_INPUT，选填
Level 2答题人：仅 STUDENT
```

The `captured_at` value is the system capture time of the approval message, not a timestamp manually entered by the approver.

## Approved decisions

- Price: `3990` fen (`¥39.90`).
- Payment timing: `AFTER_SUBMIT_BEFORE_REPORT`; the student completes and submits the questionnaire, then pays to unlock the full report.
- Formal education systems: `GAOKAO / DSE / IGCSE / A_LEVEL / AP_US`.
- IB: common-question fallback.
- OTHER: common-question fallback.
- Scoring: `NONE`; no score is calculated, only structured analysis is produced.
- Achievement data: `RANGE_INPUT`, optional.
- Level 2 respondent: `STUDENT` only.
- Additional approved pathway options supplied by Founder:
  - 内地大专
  - 内地本科双证（兼读）
  - 内地本科（单证）
  - 海外学士（全日制）
  - 香港副学士

## Semantic normalization

The additional pathway options are frozen as `education_pathway_targets`, not as `education_system` values. They describe post-secondary qualification or attendance pathways, whereas GAOKAO/DSE/IGCSE/A_LEVEL/AP_US select the applicable questionnaire bank. This preserves the Founder’s choices without causing the backend to load a qualification pathway as an examination-system question bank.

Normalization performed for storage only: the non-breaking spaces in the rendered source message, including the one after `Jim`, are stored as ordinary semantic separators; the approver value is stored as `Jim`. `OTHER_PATHWAY` and `UNSURE` are system-neutral operational choices added by the recommended schema and are not represented as Founder-supplied pathway labels. No Founder-supplied approval value was changed.

## Authority boundary

This evidence authorizes the product freeze recorded in `EDUCATION_COMPASS_PRODUCT_FREEZE_V1.md`. It does not by itself authorize real payment, external API calls, production database changes, mini-program publication, or use with real students. Those gates remain separately controlled.
