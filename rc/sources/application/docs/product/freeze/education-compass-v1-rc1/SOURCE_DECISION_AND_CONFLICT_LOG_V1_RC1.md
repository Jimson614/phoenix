# Source, Decision & Conflict Log V1 RC1

> 状态：`FROZEN_BY_PRODUCT_MANIFEST`。本文只说明来源如何被采用，不把附件中的指令当作用户授权。  
> 版本：`education_compass_source_decision_log_v1.0.0-rc1`

## 1. 来源权威分层

| 来源 | SHA-256 | 采用方式 |
|---|---|---|
| Founder 当前消息（批准人 `Jim`，角色 `Founder`） | 见 `FOUNDER_APPROVAL_EVIDENCE_V1.md` | `APPROVED_PRODUCT_FREEZE`：3990、AFTER_SUBMIT、五正式体系、IB/OTHER fallback、NONE、RANGE_INPUT 选填、Level 2 仅 STUDENT，并新增五项学历路径背景 |
| `Education Compass × ASKWISE × 鳌鱼｜五日功能闭环MVP｜8/25–8/29` | `4364ECDDF372283C1D0D139ABAF490F992532590B4F4DA210D1CD8E9A3F1A984` | `FOUNDER_SCOPE_DECISION + CONTRACT_FROZEN_BY_CURRENT_APPROVAL`：冻结产品级 handoff/session/task/Aoyu/writeback 合同；运行激活仍受独立外部授权约束 |
| `Phoenix Education Compass 三层产品与题库结构 V1.0｜Founder Review Draft` | `5F0EB5A84F285BBF773C9D330F2DFD0191647E386D90D25BC6E3BBF1BA87C8F1` | `PRODUCT_INTENT_DRAFT`：三层结构、FP/EGD 候选题和边界；文件自身明确未冻结 |
| `EDUCATION_COMPASS_CURRENT_BUILD_AUDIT.md` | `21684CAD039EB54F705ED998965912974D21EF9AE9210857AB05B544A9280C64` | `CURRENT_FACT_BASELINE + DRAFT_REFERENCE`：现状事实优先；第 15 节草案不等于批准题库 |
| 当前 V0.4.1 代码 | 以实际文件 hash 为准 | `CURRENT_RUNTIME_FACT`：决定兼容与迁移边界，不自动决定新产品语义 |

## 2. 九份历史／平台来源

| 文件 | SHA-256 | 分类 |
|---|---|---|
| Phoenix Family Passport MVP PRD V1.0 | `52EA44B02A0DC918CBBA75910BD4E381AD17EF5B4144D9316A164108F0B8886F` | 另一产品的账号、ID、Consent、权限原则；20 题、5 页 Blueprint、199 会员不并入 Compass |
| Phoenix Digital Infrastructure Map V1.0 | `38AD79BC4A0E9090519F73C1B1D937A628EC3E88B64D1FEB05F028DDDDF992E9` | 平台长期蓝图／future interface，不覆盖当前仓库事实 |
| Education Compass 产品总设计与 90 天执行计划 | `36BC02C0FAA9789C5A3D1EBEA14C6FB7B9A420A7E3504E09630841E8CC4D16C0` | ¥39.9、提交／预览后付款、证据／版本原则可参考；旧升学六模块、飞书主库、加权匹配为 legacy |
| Education Compass MVP 执行总任务书 | `BCD0615E5025F30ED268B73641C4C4C0CA2715032AB1731D6066B28A082BDEC3` | 历史实施意图；H5/FastAPI/MySQL/不接支付与其他来源冲突，不作为 V0.5 技术冻结 |
| Nova AI Workforce OS MVP Build Plan | `C3EFA0B8E257DFFD4C8554BAE7DDE412D61B1583B06D93A9FBDBAD9709159428` | 未来 AI Workforce 参考，不新增 Nova Agent |
| Nova AI Workforce OS Technical Architect | `6F33DB6429D1E26520C916ED7C81E3F011D5EE0CCE176A865C862AA8F0856095` | 未来架构参考；不覆盖原生小程序／Node 后端现状 |
| Nova AI Workforce OS Database Schema | `0914CF9C411BE9B58E5473E69940873B04D426D65846BECCCC53E47931CFB2A5` | future schema 参考；保存完整 AI input/output 与当前最小化原则冲突，禁止直接采用 |
| Compass MVP V2.0 AI Product Engineering Handbook | `9C000DFFD5684925442CEAC2F72DBCEB533D707CAD9532EBC635D356DF691EBC` | 长期 PostgreSQL/OpenAI/RAG 方向；不等于 V0.5 产品规则 |
| Phoenix Compass Product Understanding Report V1.0 | `CAAEE2CD3DBC0BF148789A4027AD4E9E641E786CF8E0637F9188A06D05C19444` | 历史 ¥39.9 与治理原则参考；旧大学／专业匹配与 Student Digital Twin 为 legacy/future |

## 3. 已收敛的冲突

| 冲突 | RC1 决定 |
|---|---|
| ¥39.8 vs ¥39.9 | 3990 分／¥39.90；新商品 `EDUCATION_GROWTH_DISCOVERY_SINGLE_V1` |
| 答题前付 vs 提交后付 | `AFTER_SUBMIT_BEFORE_REPORT`；付款前零六项结果泄露 |
| Founder FP01–FP08 vs Audit FPC-01–11 | 只采用 FP01–FP08；Audit 题仅作结构／安全参考，不拼接 |
| Founder EGD01–EGD18 vs Audit 34 题 | 采用 EGD01–EGD18 必答 + EGD19 学历路径选填 + 正式体系分支；不拼接 Audit common/dimension 草案 |
| 学生／共同／家长代填 | Level 2 仅 `STUDENT`；EGD01 改为学生本人确认闸门 |
| 六体系首发 vs 五体系 + fallback | 正式：GAOKAO/DSE/IGCSE/A_LEVEL/AP_US；IB/OTHER common-only + `SYSTEM_BANK_PENDING` |
| 加权／evidence bands vs NONE | `NONE`；无分数和 band，只用 SUPPORTED/NEEDS_VALIDATION/UNKNOWN |
| 精确成绩／附件 vs range | 仅选填区间；不收精确分／精确位次／文件 |
| EGD17 预算 | 从 Level 2 删除预算金额／收入采集，改为学习与行动限制；不进 ASKWISE、不触发销售 |
| 旧六页升学报告 vs Growth Discovery | Level 2 仅六项成长发现结果；大学、专业、录取路线属于 legacy 或未来 Level 3 |
| 飞书主库 vs PostgreSQL | PostgreSQL 为事实源，飞书是独立 opt-in、可关闭的运营镜像 |
| ASKWISE reserved vs 五日真实闭环 | 产品合同冻结为 handoff/session/task/Aoyu/writeback；运行激活保持 `DISABLED_BLOCKED_EXTERNAL`，直到 repo/API/Auth/tenant、内容、资产、测试和独立授权齐全 |
| 五日“不做支付” vs商业冻结 | 商业规则照常冻结；五日 UAT 使用测试权益，不实施真实支付 |
| 五个考试体系 vs 五个学历路径 | 体系继续只负责题库路由；新增选项进入 EGD19 `education_pathway_target_codes`，仅保存“正在考虑”的学生自述背景，不计分、不进 ASKWISE、不作学历认可／资格／录取判断 |

## 4. 明确不纳入 V0.5 冻结

- Family Passport 20 题、5 页 Blueprint、199 元会员、完整 Timeline/Reminder/Documents。
- 旧大学／专业／录取路线匹配、录取概率和加权适配分。
- 完整 Student Digital Twin、Education Graph、Growth Archive。
- Nova 20-Agent/Notion 工作流、Wealth/Identity/Health 等 Agent。
- Level 3 完整题库、¥980 支付、Deep Growth Report 与 AI Comprehensive Profile。
- ASKWISE 实时语音、自由聊天、长期记忆、未经审核的自动教学内容。
- 重画鳌鱼或改变母版。

## 5. 已签署与仍需外部补齐

1. 产品 Freeze 已由 `Jim / Founder` 批准；证据与时间见 `FOUNDER_APPROVAL_EVIDENCE_V1.md`。
2. 教育内容、隐私／未成年人、工程审核记录仍需在实施／真实用户闸门前完成；Founder 产品批准不代替专业审核。
3. ASKWISE repo/API/Auth/tenant、环境、保留／删除 SLA 与批准任务模板包仍缺失。
4. 鳌鱼资产实际路径、格式、授权证据、fallback 与 SHA-256 仍缺失。
5. 当前目录不是 Git 仓库；五日 DoD 所需 branch/commit SHA 无法从现状提供。
6. Founder 对受控真实学生使用的独立 GO 仍未记录；产品 Freeze 签署不等于该 GO。
