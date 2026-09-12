# Phoenix Education Compass™ 新版 7 屏 UI Codex 执行指令 V1.0

适用项目：Phoenix Family OS 原生微信小程序 + Node.js/TypeScript 后端 V0.5.0  
用途：将下方从 `/goal` 开始的全部内容复制给 Codex 执行。  
本指令只授权在本地工作副本中进行增量代码修改、自动测试和本地构建；不授权真实扣款、退款、外部写入、生产迁移、小程序上传或发布。

参考图：

```text
C:\Users\1\Desktop\工作相关\f91327e8-5492-49f9-94d8-036b5088ca21 (2).png
尺寸：1536 × 1024
SHA-256：12E4EC2B7AFDAE9A2DAF7BA9DD7360FA02F314E073E385A620293D0E4AD14AAF
```

> 参考图是视觉和展示文案目标，不是业务状态、题库、评分、支付权益或外部服务已开通的证据。任何价格、题数、时长、进度、结果、权益、Askwise 或顾问状态都必须由真实合同和服务端数据决定。

~~~~text
/goal 在下列项目中完成 Phoenix Education Compass 新版 7 屏体验的前端视觉升级和必要的后端展示合同增量，并提供可复核的本地前后端测试证据：

PROJECT_ROOT = C:\Users\1\Documents\Codex\2026-08-20\new-chat\work\phoenix_v030_feishu_backend\phoenix-family-os-mvp
UI_REFERENCE = C:\Users\1\Desktop\工作相关\f91327e8-5492-49f9-94d8-036b5088ca21 (2).png
UI_REFERENCE_SHA256 = 12E4EC2B7AFDAE9A2DAF7BA9DD7360FA02F314E073E385A620293D0E4AD14AAF

不要只输出方案、伪代码或未执行命令。先完成只读基线与冲突检查，然后增量修改、测试、修复、复测并生成证据。保留用户已有修改，不使用 `git reset --hard`、`git checkout --` 或覆盖未知文件。

## 1. 权威来源与冲突顺序

开始前完整读取：

1. `<PROJECT_ROOT>\docs\product\EDUCATION_COMPASS_PRODUCT_FREEZE_V1.md`
2. `<PROJECT_ROOT>\docs\product\EDUCATION_COMPASS_PRODUCT_FREEZE_V1_RECEIPT.md`
3. `<PROJECT_ROOT>\docs\product\PHOENIX_EDUCATION_COMPASS_V0.5.0_CODEX_EXECUTION_INSTRUCTION.md`
4. `<PROJECT_ROOT>\EDUCATION_COMPASS_CURRENT_BUILD_AUDIT.md`
5. `<PROJECT_ROOT>\docs\openapi\education-compass-v0.5.0.openapi.yaml`
6. `<PROJECT_ROOT>\README.md`、`app.json`、前端相关页面、服务、模型和全部测试
7. `<PROJECT_ROOT>\server\src`、`server\test`、migration、`.env.example`、package/lockfile
8. `UI_REFERENCE`，先核验 SHA-256，再将其作为视觉参考

冲突顺序：

```text
安全、隐私、真实外部操作权限
> 已签署的 Product Freeze 与固定 hash 附件
> 服务端真实状态、商品、题库和权益
> 本指令的增量实施与验收边界
> 新 UI 参考图的样式与非事实性文案
> 旧页面历史假设
```

不得修改已签署 Freeze 文件、Receipt 或冻结附件来迁就 UI 图。若发现冻结 hash 漂移，停止业务代码修改并报告 `PRODUCT_FREEZE_INTEGRITY_FAILED`。

## 2. 本轮目标

在不推翻当前 Education Compass 业务闭环的前提下，把以下 7 个画面实现为统一的 Phoenix Nova 高端教育评估视觉：

1. Free Level 1 首页；
2. Free Level 1 答题页；
3. Free Family Education Snapshot 结果页；
4. ¥39.90 Level 2 首页；
5. Level 2 分段答题页；
6. 已支付并交付的完整报告页；
7. 下一步成长支持页／区域。

必须保持的真实漏斗：

```text
家庭档案与学生档案
→ Free Parent Compass Level 1
→ 保存 / 退出 / 恢复 / 提交
→ Family Education Snapshot
→ 仅当同一学生的服务端 nextAction=START_LEVEL_2 时显示 ¥39.90 入口
→ 学生本人 Level 2 答题
→ 提交后 LOCKED，零六项正文泄露
→ 创建订单并调用微信支付
→ 服务端可信通知或主动查单确认权益
→ 完整报告
→ AI / Askwise 预留 / 顾问支持
```

参考图未画出但绝对不能删除的桥接页面：

- `pages/compass-preview/index` 的 `growth-locked` 状态；
- `pages/payment-result/index` 的支付结果核验状态；
- 所有支付取消、失败、处理中、已支付报告生成中状态；
- Agent 独立同意、报告权益和 QA 门禁。

## 3. 参考图与冻结事实的强制校正

视觉布局尽量忠实；以下事实不得照图硬编码：

| 参考图展示 | 当前权威事实 | 实施规则 |
|---|---|---|
| Free `15秒`、`4个问题`、答题 `2 / 3` | Level 1 为 FP01–FP08，8 道必答，约 3–5 分钟 | 页面保留相同排版，但显示服务端/冻结事实；进度使用真实 `answered/total` |
| Level 2 `15分钟`、`8 / 40` | 约 15–20 分钟；题数由公共题和教育体系分库动态决定 | 显示动态总题数，不硬编码 40；时间显示 15–20 分钟或服务端 metadata |
| `¥39.9` | 3990 分/CNY，标准展示 `¥39.90` | 只读取商品接口；任何客户端常量只能用于拒绝不一致商品，不能作为显示事实源 |
| Level 2 首页按钮带价格 | 支付时点是 `AFTER_SUBMIT_BEFORE_REPORT` | 可展示“完整报告解锁价”，但点击只开始问卷，绝不能在入口页调用 `wx.requestPayment` |
| 报告“4 大维度”但参考雷达图为 5 轴 | 冻结为 4 个成长维度且 `scoring.mode=NONE`、无 dimension bands | 不伪造第五轴，不生成能力分、排名、百分位或“中等/良好”等能力等级；改为四维证据状态卡或明确标注为“证据覆盖度（非能力评分）”的可访问图形 |
| `匿名测试` | 当前流程关联 Family ID / Student ID / Assessment ID | 不宣称匿名；改成“资料按隐私说明处理｜结果仅授权家庭可见” |
| `真正卡在哪里`、`全面发现成长关键点` | Level 2 只发现支持信号，不构成诊断或完整规划 | 作为安全语气校正，显示“当前需要支持的地方”“发现成长关键点”，避免把自评结果写成确定性诊断 |
| `立即体验 Askwise` | Askwise 运行态为 reserved / blocked external | 默认隐藏或禁用并显示“即将开放”；只有服务端 capability 明确可用且另获外部写入授权时才允许真实跳转 |
| `了解顾问服务｜¥980起` | Level 3 当前只做入口与顾问意向，不启用 SKU 或支付 | 默认显示“了解深度评估 / 预约顾问”；未有服务端批准商品配置时不显示价格、不创建订单 |
| 分享报告 | 报告含未成年人和家庭数据 | 默认只分享通用小程序入口或无敏感摘要；不得把 reportId、答案、signals、evidence、姓名或订单信息放入分享路径/标题 |

除上表的事实校正外，所有清晰可辨的非事实性文案、视觉层级和信息顺序按参考图实现。模糊小字不得猜测，继续使用当前冻结文案或服务端返回内容。

## 4. 路由映射：优先复用，默认不新增页面

| 参考图画面 | 现有承载 | 处理 |
|---|---|---|
| Free 首页 | `pages/compass/index?level=1&studentId=…` | 保留 route/JS 状态机，重排 WXML/WXSS；Level 1 零价格、零支付 CTA |
| Free 答题 | `pages/compass-questionnaire/index?level=1&…` | 复用服务端题库、草稿 revision、保存退出、恢复和提交；重排 WXML/WXSS |
| Free 结果 | `pages/compass-preview/index?mode=family-snapshot&assessmentId=…` | 复用 `familySections`、readiness 和 `canStartLevel2`；重排 Family 状态 |
| ¥39.90 首页 | `pages/compass/index?level=2&…` | 只有同一学生服务端 `START_LEVEL_2` 才能进入；展示服务端价格但不付款 |
| 分段答题 | `pages/compass-questionnaire/index?level=2&…` | 复用统一 schema、教育体系路由、动态题型、成绩区间、保存恢复 |
| 报告 | `pages/report/index?id=reportId` | 只有服务端 FULL/READY + ACTIVE entitlement 才显示完整正文 |
| 下一步支持 | 优先用 `pages/report/index` 底部支持区 + `pages/advisor-request/index?reportId=…&studentId=…` | 不新建重复页面；报告底部先呈现支持选择，顾问表单继续独立授权 |

保持 `app.json` 16 页顺序、三个 TabBar pagePath 和 `lazyCodeLoading`。不要把 `/pages/home/index` 改成营销首页；它仍是家庭中心与服务端 nextAction 路由器。

## 5. 全局设计系统

在 `app.wxss` 使用现有变量体系增量补充以下近似 token；若已有同义 token，合并而不是重复定义：

```css
--pn-bg: #faf7f1;
--pn-surface: #fffdf9;
--pn-surface-warm: #fbf3e7;
--pn-surface-selected: #fff1d8;
--pn-ink: #102238;
--pn-ink-secondary: #465563;
--pn-muted: #85817a;
--pn-muted-light: #aaa49b;
--pn-gold: #b98426;
--pn-gold-deep: #966313;
--pn-gold-bright: #d7ad45;
--pn-gold-soft: #f3dfbd;
--pn-gold-wash: #fbedd2;
--pn-line: #eadfce;
--pn-line-strong: #d8b66d;
--pn-disabled-bg: #eee9e0;
--pn-disabled-text: #a49e94;
--pn-danger: #984b40;
```

视觉约束：

- 中文主标题：`"Songti SC", "STSong", "SimSun", serif`；正文和控件使用系统无衬线字体；禁止 CDN 字体。
- 营销主标题 58–64rpx、页面标题 44–50rpx、问题标题 32–36rpx、正文 24–26rpx、辅助文字不低于 20rpx。
- 基准横向页边距 32–36rpx，≤340px 时降为 24rpx。
- 间距阶梯只用 8/12/16/20/24/32/40/48/64/80rpx。
- 普通卡片圆角 24–28rpx，重点卡 30–36rpx，选项 18–22rpx，胶囊按钮 999rpx。
- 金色主按钮使用香槟金渐变，`min-height` 104rpx；所有交互控件同时设置 `min-height:44px`，图标按钮同时设置 `min-width:44px`，不能用 88rpx 冒充所有视口下的 44px。
- 选项未选为象牙白 + 空心圆；选中为淡金底 + 深金边 + 金色实心勾，不能只靠颜色表示。
- 羽毛透明度约 `.12–.22`，贴边裁切、`pointer-events:none`；罗盘透明度约 `.78–.95`。
- 不给共享 `.page` 恢复 `min-height:100vh`；嵌套内容区必须自然撑开。
- 不使用 `58vh/60vh/72vh` 等最小高度制造空白；loading/error/empty 使用内容驱动的紧凑状态卡。
- 底部固定栏必须使用 `env(safe-area-inset-bottom)`，正文预留等于真实栏高，不得多留一屏。
- 自定义顶栏通过 `wx.getMenuButtonBoundingClientRect()` 或现有安全实现避开微信胶囊；不要绘制参考图的 `9:41`、信号、电池和手机外壳。

主按钮参考：

```css
background: linear-gradient(105deg, #d9af48 0%, #c99217 56%, #b77a0b 100%);
color: #fffdf8;
border-radius: 999rpx;
min-height: 104rpx;
box-shadow: 0 14rpx 32rpx rgba(172, 113, 13, .24);
```

## 6. 逐屏实施规格

### 6.1 Free 首页

文件：`pages/compass/index.wxml|wxss|js`，只在必要时调整 JS 的展示字段，不改入口授权逻辑。

顺序：Logo/中文状态 → 产品标识 → 主标题 → 说明 → 三列利益点 → 主 CTA → 隐私说明 → 底部羽毛。三列利益点必须位于同一圆角暖白卡片中，以两条竖分隔线组织，不拆成三个漂浮卡片。

目标文案结构：

```text
PHOENIX NOVA™
中文
EDUCATION COMPASS™
3–5分钟，
看见孩子当前
最值得关注的信号
快速了解孩子的学习状态
生成一份家庭教育成长快照
免费 | 8题 | 手机完成
开始免费测试 →
我们严格保护您的隐私信息
```

要求：

- 首次进入不请求商品接口，不渲染价格、product card 或支付文字。
- 语言控件若只有中文，不做假下拉；显示静态“中文”胶囊或实现真实可用的语言选择。
- Logo 使用现有 `/assets/brand/phoenix-nova-logo-primary.png`，不以字体仿制。
- 保留监护人核心同意；可将完整文案放到 CTA 前的折叠/弹层，但不能删掉、预勾选或与营销授权捆绑。

### 6.2 Free 答题页

文件：`pages/compass-questionnaire/index.wxml|wxss|js`。

布局：返回 → `免费家长教育罗盘` + 动态题号 → 进度条 → 当前问题 → 提示 → 动态选项 → 隐私提示 → 下一题。

要求：

- 题目和选项完全读取服务端冻结题库；参考图问题只能用于视觉 fixture，不能替换 FP01–FP08。
- 进度展示 `{{answeredCount}} / {{totalQuestions}}` 或等价真实字段，不硬编码 `2 / 3`。
- 保留 `choose / next / previous / exitQuestionnaire / retry`、全部 `data-*`、revision、clientSaveToken、自动保存和冲突处理。
- 第一步的后退行为是保存退出，不丢草稿。
- 隐私提示使用“资料按隐私说明处理｜结果仅授权家庭可见”。
- 底部 CTA 不遮挡最后一个选项；点击后 disabled/loading 防重复。

### 6.3 Free 结果页

文件：`pages/compass-preview/index.wxml|wxss|js` 的 `viewKind === 'family'` 分支。

目标层级：Logo + 分享 → 罗盘 → `你的第一份成长信号来了` → 主观察信号卡 → 其他观察因素 → Level 2 价值承接 → CTA/稍后 → 免责声明。主观察信号与说明放在一个重点卡；“其他观察因素”在同一卡下半部使用三列等宽子卡，320px 允许标签换行但不改成横向滚动。

可用文案：

```text
你的第一份成长信号来了
这是孩子当前最值得关注的方向
其他可能的影响因素
想进一步了解具体表现与提升建议？
完成学生成长发现后，可选择解锁完整报告
开始学生成长发现 →
完整报告解锁价 ¥39.90（学生提交后自愿付款）
稍后再说
结果仅供教育支持参考，不替代专业诊断
```

要求：

- 主信号、说明和其他因素来自当前 `Family Education Snapshot` 与题库 label，不能硬编码参考图示例结论。
- 必须明确“来自家长观察”，不能把 Free 结果写成学生诊断、能力等级或确定性结论。
- `canStartLevel2=false` 时不得渲染 ¥39.90 CTA；`CONSIDER/NOT_RECOMMENDED/DEFERRED` 使用各自服务端文案。
- `canStartLevel2=true` 时，主 CTA 固定表达“开始学生成长发现”，不能写成“立即解锁”或“立即付款”；价格作为“学生完成并提交后的完整报告解锁价”单独说明。价格仍由商品接口读取；若商品合同不一致，隐藏价格并报错，不能降级到客户端价格。
- 分享使用真正的微信原生 `button open-type="share"` 与 Page `onShareAppMessage`，固定分享通用 `/pages/welcome/index`；标题不得含本次结果。若无法实现真实分享就隐藏控件，不得保留装饰性假按钮。

### 6.4 ¥39.90 Level 2 首页

仍使用 `pages/compass/index`，通过 `level===2 && level2EntryAuthorized` 渲染。

目标文案结构：

```text
EDUCATION COMPASS™
15–20分钟，
进一步看清孩子
当前需要支持的地方
从学习表现、学习过程、思维方式
到兴趣方向，发现成长关键点
个性化测评 / 动态题目，贴合学段
多维度分析 / 四大维度证据分析
专属成长报告 / 发现问题，给出建议
由学生本人开始成长发现 →
完整报告解锁价 ¥39.90
先完成并提交，付款后解锁完整报告
隐私保护说明
```

三项能力说明必须放在同一张轻量暖白卡片内，按“金色线性图标 + 标题 + 一行说明”纵向排列并以细线分隔；不要改成三个独立大卡。

要求：

- 直接拼接 `level=2`、伪造 `sourceAssessmentId` 或切换其他学生都不能进入。
- `start()` 前再次请求服务端 state 并验证同一 Student ID 的 `START_LEVEL_2` 与真实 Level 1 source assessment。
- 只允许 `STUDENT` 作答；保留 Guardian Consent 与 Student Assent，学生拒绝必须退出且不产生负面信号或购买。
- CTA 只能创建 Level 2 assessment；本页不得创建订单、prepay 或调用 `wx.requestPayment`。

### 6.5 Level 2 分段答题页

使用现有 `pages/compass-questionnaire` 的 Level 2 分支。

布局：返回 + 当前题组 → 题号/动态总数 → 进度条 → 问题/提示 → 选项 → 上一题/下一题 → 动态剩余时间提示。

要求：

- 题组按现有 schema/维度分段展示；只有真实存在切换能力时才显示可点击下拉，否则显示静态组名。
- 题数为服务端 `questions.length`；不同教育体系允许不同总数。
- 保留 `SINGLE_CHOICE`、`MULTI_CHOICE`、`MULTI_CHOICE_DYNAMIC`、年份、地区和 `SUBJECT_RANGE_MATRIX`。
- 成绩区间仍为选填，不采集精确分数/排名，不因空缺形成负面结论。
- 切换教育体系时清理不适用答案并保存新 revision；不允许旧体系答案混入提交。
- `scoring=NONE`；页面不显示能力总分、百分位、排名或分数动画。
- 320px 下双按钮保持同行，左约 44%、右约 56%；安全区正确。

### 6.6 完整报告页

文件：`pages/report/index.wxml|wxss|js` 的 Growth Report 分支。

目标层级：顶部右侧分享胶囊 → 居中 `你的专属成长报告` → 四维证据概览 → 核心发现 → 六项完整报告 → 个性化建议/30 日行动 → PDF/分享 → 下一步支持。不要为了沿用旧版报告品牌条而在参考图没有的位置塞入大型 Logo；品牌归属由统一配色、标题与现有合法的小型产品标识保持。

参考文案：

```text
你的专属成长报告
4大维度证据分析
核心发现
个性化建议
查看完整报告
分享报告给家人
```

要求：

- 只有服务端报告同时满足 `status=READY`、`deliveryStatus=DELIVERED`、`qaPassed=true`、`contentReady=true`，且正确 SKU entitlement 为 `ACTIVE` 时显示完整正文。
- Locked、退款、跨 owner、错误或生成中状态绝不出现 Student Snapshot、signals、bottlenecks、evidence 或六项正文。
- 报告继续完整呈现六项：Student Snapshot、Strength Signals、Learning Bottlenecks、Subject Focus、Growth Direction、30-Day Action Plan。
- 四维概览来自服务端 evidence signal 的维度与状态。不得把 `SUPPORTED/NEEDS_VALIDATION/UNKNOWN` 翻译成能力高低。
- 不实现参考图的五轴能力雷达。若使用 Canvas，只能绘制明确标注的“证据覆盖概览（非能力评分）”，同时提供完整文本摘要、空数据和极值处理。
- 分享使用真正的微信原生 `button open-type="share"` 与 Page `onShareAppMessage`，固定分享通用 `/pages/welcome/index`；不分享报告摘要、学生姓名、内部 ID 或结果详情。加入自动测试断言分享路径不含 `studentId/assessmentId/reportId/orderId`。
- 保留 PDF、AI 总分析、AI 追问、反馈、顾问联系和全部现有 Consent/权益/QA 约束。

### 6.7 下一步成长支持

优先在报告底部加入与参考图一致的支持选择区域，并复用 `pages/advisor-request` 承接顾问表单。支持区结构固定为“Askwise 产品卡 → 分隔线 → 专业顾问模块 → 返回首页”；Askwise 无正式吉祥物资产时，产品卡必须自动改成无图片的单列文字布局，CTA 占满卡片宽度，不保留右侧空洞。

参考文案：

```text
下一步成长支持
让 AI 陪伴孩子
把建议真正用起来
ASKWISE
学习伙伴
错题分析与薄弱点定位
个性化学习路径跟踪
学习计划与执行提醒
需要专业顾问协助？
一对一教育规划与升学建议
返回首页
```

能力驱动 CTA：

- 本版本 Askwise capability 只允许 `RESERVED/BLOCKED/DISABLED`：显示“Askwise 即将开放”禁用态或隐藏，绝不创建假会话；
- `AVAILABLE` 属于未来独立激活版本，必须另有 Askwise 端点、鉴权、幂等、专项同意、外部 UAT 和明确授权，不能靠环境开关在本轮启用；
- Level 3 `AVAILABLE/CONSIDER`：显示“了解深度评估 / 预约顾问”，跳转已有 advisor request；
- Level 3 `NOT_RECOMMENDED/DEFERRED`：不做商业施压，显示中性说明或暂不推荐；
- 未有服务端 Level 3 SKU 时不得显示 `¥980起`，不得创建 Level 3 订单。

顾问页继续要求独立 `ADVISOR_CONTACT` 同意，保留 reportId/studentId owner 校验、topic/time/note、撤回和飞书投影边界。

## 7. 素材规则

- Phoenix Logo：只使用仓库正式品牌图片，保持比例，不滤色、不加伪阴影、不重新排字。
- 羽毛：优先复用 `/assets/ui/feather-champagne.png`。
- 罗盘：优先复用 `/assets/ui/compass-champagne.png`。
- 功能图标：统一 2–3rpx 香槟金线性图标；优先代码原语或同一套本地合规 PNG/SVG，禁止 emoji 和彩色系统图标。
- 不把整张参考图当页面背景；所有文案保持 WXML 可访问文本。
- 参考图中的 Askwise 蓝色吉祥物不是仓库资产。禁止抠图、裁图、临摹或自动生成替代角色。未提供正式授权资产时，卡片改为无图单列布局，不留空白人物坑位。
- 禁止远程 UI 图片、CSS `url()`、WebView 或运行时 CDN 字体。
- 新增本地资产必须压缩、记录来源/许可/SHA-256，并纳入 release 预算和缺失资源测试。

## 8. 必要的后端增量：只补 UI 所需的权威展示合同

不要重写题库、支付、权益、报告生成、Agent、飞书或 Askwise。先检查现有接口；能从现有权威字段可靠计算的，不创建第二事实源。

### 8.1 Questionnaire presentation metadata

在不改变题库 `schemaDigest`、题目 ID、答案或评分语义的前提下，为问卷响应提供可选的 additive metadata（命名遵循现有风格）：

```ts
interface QuestionnairePresentationMetaV1 {
  version: 'education_compass_presentation_v1'
  estimatedMinutesMin: number
  estimatedMinutesMax: number
  totalQuestions: number
  requiredQuestions: number
  progressMode: 'QUESTION_COUNT'
  scoringMode: 'NONE'
}
```

- `totalQuestions` 和 `requiredQuestions` 只从 `/v1/assessments/:assessmentId/questionnaire` 已按该 assessment 教育体系解析后的 `questions/requiredQuestionIds` 计算，不手写 8/40，也不能把多体系分支合并计数。通用 `/questionnaires/:version` 未指定唯一体系时不返回具体总数，或只返回明确标注的范围。
- Level 1 时间取冻结的 3–5 分钟；Level 2 取 15–20 分钟。
- metadata 只用于展示，不进入 questionnaire schema digest，不改变验证和结果。
- 更新 TypeScript contract、服务返回、OpenAPI、example 和 client normalizer；旧客户端忽略新字段仍可工作。

### 8.2 Next-support capability projection

扩展 `GET /v1/reports/:reportId` 的 `capabilities`，加入服务端权威的 `nextSupport`，不新增真实外部调用：

```ts
interface NextSupportCapabilityV1 {
  askwise: {
    status: 'RESERVED' | 'BLOCKED' | 'DISABLED'
    enabled: boolean
    reasonCode: string
    requiresExplicitConsent: true
  }
  deepAssessment: {
    state: 'AVAILABLE' | 'CONSIDER' | 'NOT_RECOMMENDED' | 'DEFERRED'
    ctaMode: 'ADVISOR_INFORMATION_OR_APPOINTMENT_ONLY' | 'NONE'
    advisorIntent: 'DEEP_ASSESSMENT' | null
    displayPrice: string | null
  }
  advisor: {
    available: boolean
    requiresExplicitConsent: true
  }
}
```

- 当前版本 Askwise 必须反映现有 reserved/blocked/disabled 状态，合同和测试均不接受 AVAILABLE；未来激活需新版本合同与独立授权。
- `deepAssessment.displayPrice` 当前为 `null`；没有冻结 SKU/catalog 时禁止返回 `¥980`。
- Level 3 状态复用现有 `buildLevel3ReservationV1`，不创建问卷、报告、订单、自动预约或网络请求。
- Advisor 只表示可进入授权表单，不表示已创建请求。
- 新字段必须与当前 `capabilities.agentFollowup` 深合并：响应保持 `{ capabilities: { agentFollowup, nextSupport } }`，不得覆盖、改名或丢失现有 Agent capability。
- 扩展 `POST /v1/advisor-requests` 与 `ProfileService.createAdvisorRequest()` 的 exact DTO，使其明确接受 `intent: 'GENERAL_ADVISOR' | 'DEEP_ASSESSMENT'`；默认仍为 `GENERAL_ADVISOR`。`DEEP_ASSESSMENT` 只在同一 owner 的报告/学生、Level 3 state 为 `AVAILABLE/CONSIDER`、独立 `ADVISOR_CONTACT` 同意有效时写入，禁止由前端任意字符串透传。更新 Store 类型、OpenAPI/examples 及正负向测试；无需新增持久化字段时不做 migration。
- 更新 `server/src/http/app.ts`、相关 domain/service、OpenAPI/examples 和 HTTP 合同测试。

### 8.3 后端禁止事项

- 不把营销文案存入问卷结果或数据库。
- 不因 UI 增加数字评分、雷达分数、能力等级或预测。
- 不修改 3990 分、CNY、`AFTER_SUBMIT_BEFORE_REPORT`、SKU、refund/entitlement 语义。
- 不新增 migration，除非确有新的持久化字段；presentation/capability 投影应优先无持久化。若无需 migration，交付中明确写 `migration: none`。
- 不启用真实 Askwise、OpenAI、飞书、微信支付或生产数据库。

## 9. 前端文件级任务

至少审查并按需修改：

```text
app.wxss
components/brand-mark/*
pages/compass/index.wxml
pages/compass/index.wxss
pages/compass/index.js
pages/compass-questionnaire/index.wxml
pages/compass-questionnaire/index.wxss
pages/compass-questionnaire/index.js
pages/compass-preview/index.wxml
pages/compass-preview/index.wxss
pages/compass-preview/index.js
pages/report/index.wxml
pages/report/index.wxss
pages/report/index.js
pages/advisor-request/index.wxml
pages/advisor-request/index.wxss
pages/advisor-request/index.js
models/education-compass-questionnaire.js
models/education-compass-report.js
services/education-compass.js
```

业务 JS 只做展示字段映射和真实 capability 消费。不得删除或改名既有 handler、`data-*`、loading、disabled、saving、submitting、payment、Consent、owner 或 entitlement 逻辑。

`payment-result`、`assessment-analysis`、`agent-chat` 默认 Keep；只有共享视觉一致性确有需要时才改 WXML/WXSS，不改变业务 JS 与路由。

## 10. 响应式、无障碍与状态矩阵

基准宽度：320、360、375、390、430px。

- 所有页面无横向滚动；≥430px 主体保持手机阅读宽度，不无限拉伸。
- 三列因素卡在 320px 仍为三列，允许两行标签，子项 `min-width:0`。
- 深度问卷双按钮在 320px 同排，且 CSS 使用物理 `min-height:44px`；不能只依赖 rpx 换算。
- 长问题、长选项、价格、错误和动态题数不溢出。
- 系统字体放大后仍能滚动访问全部 CTA。
- 选择控件提供勾选图形和可访问状态；Canvas 图表必须有等价文本。
- `loading/error/empty/disabled/saving/submitting/conflict` 都有紧凑、可恢复的状态。
- 支付覆盖 `not-created/pending/cancelled/failed/paid/generating/full/refunded`。
- iOS/Android safe area 不遮挡 CTA；不依赖 hover。
- 按压态轻微 opacity/scale，兼容 reduced motion。

## 11. 自动化回归硬门槛

修改前记录：

- `app.json` pages 顺序、TabBar、lazyCodeLoading；
- 全部 WXML handler、`data-*`；
- `utils/education-compass-navigation.js`、支付/权益/题库/报告核心合同与旧 migration 的 SHA-256；
- `guardianCopy`、`studentAssentCopy`、对应 copy hash/version/scope、`checked=false` 初始状态，以及 `guardianChange/assentChange` handler 的逐字符保护记录；
- 参考图 SHA-256；
- source manifest。

至少新增或更新以下断言：

1. Level 1 首次入口不调用 product API，不出现 `¥39.90`、订单或支付 CTA。
2. `canStartLevel2=false` 时 Free 结果不渲染 Level 2 CTA。
3. 同一学生 `nextAction=START_LEVEL_2` 且有真实 source assessment 时才可进入 Level 2。
4. 直接 `level=2`、伪 source assessment、跨学生状态全部拒绝/重定向。
5. Level 2 入口 CTA 只创建 assessment，不调用 order/prepay/requestPayment。
6. 实际题数和进度来自服务端；没有硬编码 `3`、`4` 或 `40`。
7. Level 2 submit 后进入 locked；locked DTO/DOM/log/cache 不含六项正文、signals、bottlenecks 或 evidence。
8. `wx.requestPayment success` 不授予权益；只有服务端可信通知/查单后可查看报告。
9. 报告四维概览无 score/rank/percentile/band/录取预测。
10. 报告负向门禁逐项覆盖：status 非 READY、entitlement 非 ACTIVE/已退款、delivery 非 DELIVERED、`qaPassed=false`、`contentReady=false`、错误 SKU、cross-owner 时，六项正文、PDF、AI 和带报告上下文的顾问入口全部不可见/不可用。
11. Askwise 只允许 reserved/blocked/disabled，按钮不可用且无网络调用；本轮任何 AVAILABLE 都判 FAIL；无 Level 3 SKU 时不显示 `¥980`。
12. 顾问请求仍需独立 Consent，跨 owner report/student 拒绝。
13. 分享按钮必须真实可用，路径固定为通用 `/pages/welcome/index`，且标题/路径不含 `studentId/assessmentId/reportId/orderId` 或结果正文。
14. Guardian Consent 与 Student Assent 不删字、不改 copy hash/version/scope、不预勾选、不合并，学生拒绝规则保持不变。
15. WXML handler/data-* 无丢失；无 universal selector、远程图片、CSS URL、WebView、缺失资源。
16. 共享 `.page` 不含 `min-height:100vh`；`.page--screen` 可保留整屏语义，所有使用者完成回归；嵌套区块不再被撑成整屏。
17. 320/360/375/390/430px 视觉状态可人工复核；未截图前标 `BLOCKED_MANUAL`。

## 12. 必跑命令

使用 Windows 兼容的 `npm.cmd`，实际运行并记录 exit code：

```powershell
npm.cmd run validate
npm.cmd run test:ui-contract
npm.cmd run test:client
npm.cmd run typecheck:server
npm.cmd run test:server
npm.cmd run test:education-contracts
npm.cmd run test:education-http
npm.cmd run validate:education-docs
npm.cmd run test:all
npm.cmd run smoke:education
npm.cmd run build:release
npm.cmd run scan:release-secrets
```

只有提供并通过显式测试数据库身份哨兵时才运行：

```powershell
npm.cmd run test:education-postgres
```

没有测试 PostgreSQL 时标记 `BLOCKED_EXTERNAL`，不得连接或清空用户数据库。默认测试不得读取真实密钥、调用微信/OpenAI/飞书/Askwise 或创建真实 prepay。

## 13. 微信开发者工具人工验收

源码测试通过后，在当前工作副本中打开微信开发者工具，清空旧 Console 后重新编译。逐屏检查：

- 7 个参考画面的 normal 状态；
- loading/error/empty/disabled；
- Free 未完成、完成但不推荐继续、允许 Level 2；
- Level 2 草稿恢复、提交、locked；
- 支付取消/失败/处理中/成功生成中/报告完成；
- Askwise blocked 与顾问可用；
- iPhone/Android 常见视口及安全区。

必须截图记录实际模拟器，而不是引用设计图。无法自动控制 DevTools 或没有真机时准确标记 `BLOCKED_MANUAL`，不得声称视觉或真机支付通过。

## 14. 证据与交付

在 `artifacts/ui-review/<UTC>/` 生成：

```text
REFERENCE.md                 # 图路径、尺寸、SHA-256、解读边界
source-manifest.before.json
source-manifest.after.json
protected-files-diff.json
route-handler-contract.json
api-contract-results.json
ui-contract-results.json
commands.ndjson
screenshots/                 # 仅实际 DevTools/真机截图；没有就保持空并标明
UI_TEST_REPORT.md
SHA256SUMS.txt
```

最终回复必须列出：

1. 实际完成状态；
2. 前端和后端修改摘要；
3. 所有修改文件；
4. 7 屏与现有 route 的对应关系；
5. UI 参考图与冻结事实的所有校正；
6. migration 是否为 none；
7. 每条命令及 exit code；
8. PASS/FAIL/BLOCKED_MANUAL/BLOCKED_EXTERNAL；
9. 微信开发者工具和真机尚需人工完成的动作；
10. 证据目录绝对路径。

任何 P0 测试失败时，状态必须是 `LOCAL_VERIFICATION_FAILED`，不得称“完成”“可上线”。只有本地 L1/L2 通过时最多称 `LOCAL_HTTP_MOCK_VERIFIED`；不得把 mock、fixture、`/health`、热更新日志或配置存在描述成真实外部连通。
~~~~

## 使用说明

1. 将上方从 `/goal` 开始到代码块结束的全部内容复制给 Codex。
2. 本指令默认采用“视觉忠实、事实服从已签署 Freeze”的安全方案。
3. 如果确实要把产品改成 Free 4 题/15 秒、Level 2 固定 40 题、能力雷达等级、Askwise 立即可用或显示 ¥980 价格，必须先创建新的 Product Freeze 版本并由 Founder 重新批准，不能仅凭 UI 图直接改题库和商业合同。
