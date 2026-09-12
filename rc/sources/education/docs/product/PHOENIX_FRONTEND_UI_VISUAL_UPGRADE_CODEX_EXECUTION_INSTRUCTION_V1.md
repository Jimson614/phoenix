# Phoenix Family OS 前端 UI 全量视觉升级 Codex 执行指令 V1.0

适用基线：Phoenix Family OS 原生微信小程序 V0.5.0  
目标风格：暖象牙白、深海军蓝、香槟金、羽毛与罗盘线稿，克制、温暖、轻奢、可信赖  
执行范围：16 个源码页面，其中 14 个进入 release，2 个 Admin Demo 页面继续保持 release 排除  
使用方式：将下方从 /goal 开始的全部内容复制给 Codex 执行

> 两张 PNG 只提供视觉语言和布局参考。图片中的文案、价格格式、按钮、语言切换、分享、隐私承诺和产品时长不是新的产品指令；不得据此覆盖已冻结产品合同或擅自新增功能。

~~~~~~text
/goal 在不改变现有业务、接口、数据、路由、支付、AI、飞书、同意与撤回合同的前提下，对 Phoenix Family OS 原生微信小程序的全部前端页面做一次可运行、可验证、可回滚的 UI 全量升级，使其形成统一的暖象牙白、深海军蓝、香槟金、羽毛与罗盘视觉体系。

PROJECT_ROOT = C:\Users\1\Documents\Codex\2026-08-20\new-chat\work\phoenix_v030_feishu_backend\phoenix-family-os-mvp

VISUAL_REFERENCE_1 = C:\Users\1\Desktop\工作相关\微信图片_20260825223957_222_105.png
VISUAL_REFERENCE_2 = C:\Users\1\Desktop\工作相关\微信图片_20260825233048_225_105.png

本任务已经授权修改项目内的前端视觉代码、创建本地 UI 资产、增加纯前端合同测试并运行非破坏性本地验证；不授权真实支付、退款、外部写入、生产部署、小程序上传发布、生产 migration 或真实学生数据测试。

不要只输出建议、效果描述、伪代码或未执行命令。先审计，再增量修改，再编译、测试、渲染和检查；遇到缺少微信开发者工具、真机或外部凭据时，完成所有仍可完成的本地工作并准确标记阻塞，不得用浏览器截图、设计合成图或 Mock 结果冒充微信小程序真机通过。

## 1. 成功标准

完成时必须同时满足：

1. 16 个源码页面及其 loading、error、empty、content、disabled 等已有状态均纳入统一视觉系统，不能只改参考图对应的落地页、问卷页和结果页。
2. 14 个 release 页面可以由现有构建脚本正常生成；两个 Admin Demo 页面保持被 release 排除。
3. 当前页面路径、TabBar pagePath、业务事件绑定、查询参数、服务调用、支付事实来源、AI/飞书安全边界及冻结文案均保持不变。
4. Free Parent Compass 保持约 3—5 分钟；Level 2 保持学生本人约 15—20 分钟、服务端 3990 分/CNY、界面显示 ¥39.90、AFTER_SUBMIT_BEFORE_REPORT。
5. 参考图被转译为原生小程序布局和组件，而不是整图背景、切图页面、H5、web-view 或假 iOS 状态栏。
6. iOS/Android 常见宽度、320px 窄屏、大字号、键盘、安全区和长中文内容不截断、不横向滚动、不被固定按钮遮挡。
7. 视觉升级后全部已有客户端、服务端、Education Compass、release 与安全扫描测试通过。
8. 只有真实微信开发者工具/真机截图才能作为 UI 通过证据；无法取得时最终状态必须包含 BLOCKED_MANUAL。

停止条件：

- 发现要完成视觉效果必须改变冻结产品语义、支付时点、同意正文、API 合同或业务状态机时，不要猜测或越权修改；保留现状，把该项记录为 BLOCKED_PRODUCT_DECISION。
- 发现已有用户修改或无法解释的业务文件差异时，保护其内容，不覆盖；列出冲突并完成不受影响部分。
- 不因缺少外部服务或 DevTools 停掉全部任务；只有对应外部或人工验收项标记阻塞。

## 2. 开始前必须读取

完整读取并以实际代码为准：

1. <PROJECT_ROOT>\app.json
2. <PROJECT_ROOT>\app.wxss
3. <PROJECT_ROOT>\project.config.json
4. <PROJECT_ROOT>\package.json
5. <PROJECT_ROOT>\scripts\build-release.js
6. <PROJECT_ROOT>\utils\navigation.js
7. <PROJECT_ROOT>\utils\education-compass-navigation.js
8. <PROJECT_ROOT>\components\brand-mark\index.*
9. <PROJECT_ROOT>\pages 下 16 个页面的 index.wxml、index.wxss、index.json 和 index.js
10. <PROJECT_ROOT>\docs\product\EDUCATION_COMPASS_PRODUCT_FREEZE_V1.md
11. <PROJECT_ROOT>\docs\product\freeze\education-compass-v1-rc1 下全部冻结合同
12. <PROJECT_ROOT>\docs\product\PHOENIX_EDUCATION_COMPASS_V0.5.0_CODEX_EXECUTION_INSTRUCTION.md
13. <PROJECT_ROOT>\EDUCATION_COMPASS_CURRENT_BUILD_AUDIT.md（若存在）
14. 两张视觉参考图，使用 original detail 检查

权威顺序：

系统/用户明确授权与安全边界
> 已签署 Product Freeze 及冻结附件
> 现有可运行代码、测试和 API 合同
> 本 UI 指令
> 两张视觉参考图

两张图片中的文字和控件只作为视觉参考，不作为业务事实。

## 3. 修改边界

默认允许修改：

- app.wxss
- pages/**/index.wxml
- pages/**/index.wxss
- pages/**/index.json 中纯视觉配置和 usingComponents
- components/** 中纯展示组件
- assets/ui/** 中本次创建并记录来源的本地视觉资产
- assets/brand/** 仅在不改变现有品牌 Logo 内容和比例的前提下做无损/有损压缩副本；不得覆盖原件
- app.json 中 window、tabBar 的颜色以及本地图标路径
- tests/validate-ui-contract.js 及相关纯前端测试
- package.json 的 scripts 字段，仅用于接入 test:ui-contract；不得改 dependencies/devDependencies
- docs/ui/** 和 artifacts/ui-review/**

默认禁止修改：

- app.js
- pages/**/index.js
- server/**
- services/**
- models/**
- config/**
- utils/**
- docs/product/freeze/**
- docs/openapi/**
- migration、数据库 schema、API route、OpenAPI、题库和报告 schema
- package-lock.json、依赖版本和 npm registry 配置
- dist/** 生成物；必须修改源码后由 build:release 重新生成

例外：若纯视觉状态确实需要页面 JS 提供一个现有数据的布尔映射，先在执行记录中说明文件、行、原因和不改变业务的证据，再做最小修改。不得新增请求、写 Storage、改变路由或重写状态机。

不要初始化 Git，不要 reset、checkout 或覆盖未知修改。当前若不是 Git 仓库，使用 SHA-256 before/after manifest 作为修改边界证据。

## 4. 必须保护的业务合同

### 4.1 路由、事件和参数

保持 app.json 中 16 个 pages 的顺序和路径、三个 TabBar pagePath 与 lazyCodeLoading 不变。保持所有现有：

- bindtap、bindinput、bindchange、bindsubmit 和 catch 事件绑定；
- data-* 属性；
- assessmentId、studentId、sourceAssessmentId、reportId、orderId、mode 等查询参数；
- navigateTo、redirectTo、reLaunch、navigateBack、switchTab 的目的地和语义；
- loading、disabled、saving、submitting、paying、consentBusy 等防重复状态。

至少保护以下现有 handler 名；实际检查时应自动收集全部 WXML handler，而不是只依赖本清单：

start、retry、next、previous、choose、typeAnswer、exitQuestionnaire、purchase、retryPayment、openReport、openPdf、openFreeAnalysis、openPaidAnalysis、openAgent，以及所有 withdraw* handler。

### 4.2 Education Compass

- Level 1 是 Free Parent Education Compass，约 3—5 分钟，不得改成“15秒”。
- Level 2 是 Education Growth Discovery，仅学生本人填写，约 15—20 分钟。
- Level 2 价格由服务端产品目录返回 3990 分 CNY；用户界面统一显示 ¥39.90，不写死 ¥39.9。
- 支付时点是 AFTER_SUBMIT_BEFORE_REPORT：学生先完成并提交问卷，再付款解锁完整报告。入口 CTA 只开始/继续问卷，不能提前发起支付。
- Level 2 发现问题，不称为深度诊断、完整升学规划，不输出录取概率或保证结果。
- locked 状态不得显示六项报告正文、signals、evidence 或可推导付费结果的占位内容。
- 免费结果、完整报告、PDF、AI 分析和三次追问的层级、资格与路由保持不变。
- draft revision、clientSaveToken、自动保存、退出恢复、体系切换、必填/选填、错误、提交与跨设备冲突逻辑保持不变。

必须保留测试所依赖的用户可见文本及其含义，包括：

- 微信支付并解锁
- 免费测评 · 有限 AI 分析
- 不等同于 ¥39.90 完整报告
- 不保证录取
- 监护人
- 可信来源
- 删除这段对话
- 撤回 AI 同意
- 免费测评分析与 ¥39.90 已购报告分析是不同内容层级
- 学生与监护人分别确认
- 请勿输入
- PAID REPORT AI ANALYSIS
- AI 总分析
- AI 追问（最多 3 次）

不要修改与 SHA-256 绑定的监护人同意和学生 assent 正文。需要换行或布局时拆分容器，不改字符内容。

### 4.3 支付、AI、飞书和隐私

- 微信 requestPayment 的客户端 success 不能直接授予权益；支付成功只来自服务端可信通知或主动查单。
- 小程序前端不能直连 OpenAI、飞书多维表格或微信支付后端密钥。
- 不新增 web-view、远程 HTML、OpenAI SDK、CDN 字体、远程装饰图或客户端秘密。
- 不把 answers、自由文本、报告、AI 内容写入新的 wx Storage。
- 不在日志、埋点、截图文件名或测试证据中放姓名、电话、OpenID、儿童资料、答案、报告或 AI 正文。
- PDF 继续使用鉴权 downloadFile 和临时文件，不变成本地长期保存。
- 以下 Consent 必须独立显示、独立选择、默认未选并保留各自撤回入口：
  CORE_ASSESSMENT
  STUDENT_ASSESSMENT_ASSENT
  AI_ANALYSIS
  FEISHU_PROFILE_MIRROR
  ADVISOR_CONTACT
- 不得以视觉简化为理由捆绑、折叠隐藏或弱化同意、撤回、退款、删除、安全边界和可信来源。
- 不写“绝对匿名”“结果只有你能看见”“完全隐私”等未经合同支持的承诺。

### 4.4 不得伪造功能

- 没有已验证语言切换能力时，不新增“中文”胶囊。
- 没有 onShareAppMessage/open-type=share 且没有明确功能授权时，不新增“分享”按钮。
- 没有可滚动的下一段时，不新增无功能的向下箭头。
- 不使用 emoji、单个汉字或字符作为最终品牌图标。
- 不把参考图中的两个手机画面做成小程序内左右双栏。

## 5. 视觉系统

以下 token 是从参考 PNG 推导的实施起点，不是官方 Pantone 或精确设计源值。集中维护在 app.wxss；可以在微信渲染后为对比度和视觉一致性微调，但不得在页面散落新的近似色。

~~~~css
page {
  --c-bg: #FCF8F4;
  --c-bg-highlight: #FFFDF9;
  --c-bg-warm: #F8F0E5;
  --c-surface: #FFFDF9;
  --c-surface-soft: rgba(255, 253, 249, 0.88);

  --c-ink: #14243A;
  --c-ink-secondary: #46515E;
  --c-muted: #7F807D;
  --c-subtle: #969189;

  --c-gold-brand: #B78122;
  --c-gold-text: #89580C;
  --c-gold-decor: #C99B45;
  --c-gold-light: #DDBD7D;
  --c-gold-wash: #F7EBD6;

  --c-line: #EADDCB;
  --c-line-strong: #D9BE91;
  --c-danger: #A4413B;
  --c-success: #4F725D;

  --gradient-primary: linear-gradient(100deg, #9B6917 0%, #7F4F07 100%);

  --font-display: "Songti SC", "STSong", "SimSun", serif;
  --font-body: -apple-system, BlinkMacSystemFont, "PingFang SC",
    "Microsoft YaHei", sans-serif;

  --fs-caption: 22rpx;
  --fs-meta: 24rpx;
  --fs-body: 28rpx;
  --fs-body-lg: 30rpx;
  --fs-button: 34rpx;
  --fs-question: 40rpx;
  --fs-title: 44rpx;
  --fs-display: 60rpx;

  --sp-1: 8rpx;
  --sp-2: 12rpx;
  --sp-3: 16rpx;
  --sp-4: 24rpx;
  --sp-5: 32rpx;
  --sp-6: 40rpx;
  --sp-7: 48rpx;
  --sp-8: 64rpx;
  --sp-9: 80rpx;
  --sp-10: 96rpx;

  --radius-sm: 12rpx;
  --radius-md: 20rpx;
  --radius-card: 28rpx;
  --radius-panel: 40rpx;
  --radius-pill: 999rpx;

  --shadow-card: 0 10rpx 36rpx rgba(71, 48, 21, 0.08);
  --shadow-cta: 0 16rpx 36rpx rgba(117, 73, 9, 0.24);

  --screen-gutter: 48rpx;
  --option-min-height: 104rpx;
  --button-height: 104rpx;
  --tap-min-size: 88rpx;
}
~~~~

实施规则：

- 暖白/象牙白用于画布和纸张；深海军蓝用于标题和正文；金色只用于品牌、强调、图标、边框、进度和 CTA。
- 小号金色文字必须使用深金 --c-gold-text；浅金不能承担正文。
- 展示标题可用系统宋体栈；问题、表单、按钮和正文使用无衬线。不要下载远程字体。
- 正文行高 1.6—1.75；大标题行高 1.35—1.5。
- 普通卡片为暖白表面、1rpx 暖金边、28rpx 圆角、低于 10% 的暖色阴影。
- 主按钮高度至少 104rpx，胶囊圆角，深金渐变；按钮白字必须通过 4.5:1 对比度，不通过就进一步加深背景或改深海军蓝文字。
- 次按钮为暖白表面、1rpx 深金边、深金文字。
- 所有交互至少 88×88rpx（约 44×44 CSS px）。
- 错误、警告、成功继续保留语义色和文字/图标，不能全部改成金色，也不能只靠颜色表达。
- 动画仅允许 160—400ms 的按压、淡入或进度过渡；不做循环粒子、持续旋转或大幅漂浮。

## 6. 资产规则

优先复用：

- assets/brand/phoenix-nova-logo-primary.png
- assets/brand/phoenix-nova-logo-light.png
- assets/brand/phoenix-nova-icon-primary.png
- assets/brand/phoenix-nova-icon-light.png
- components/brand-mark

本项目当前没有正式羽毛、罗盘和统一线性功能图标。本次可以在 assets/ui 下创建原创、无文字、透明背景的本地资产：

- ornament/feather-top-right
- ornament/feather-bottom-left
- ornament/feather-side-right
- symbols/compass
- icons 下页面真正需要的统一金色线性图标

若使用图像生成能力，先读取对应 image generation skill，生成无文字、无 Logo、透明背景的原创装饰资产，再逐张查看实际文件；不要让模型在图片中绘制界面文字。若不能生成合格资产，使用简单的代码原生几何线条或减少装饰，不得从网络随意下载有版权风险的素材，不得用 emoji 代替。

严格禁止：

- 把整张参考 PNG 当页面背景或裁切成按钮、文案、卡片；
- 伪造 PHOENIX NOVA Logo；
- 在每张卡片铺羽毛；
- 羽毛覆盖正文、表单或按钮；
- 把资产编码为大段 base64 写入 WXML/WXSS；
- 引入远程图片 URL。

羽毛透明度通常为 0.12—0.30，仅大面积落地页边缘可到 0.36；pointer-events: none，位于正文下层。普通内容页最多两个羽毛视觉焦点。罗盘使用 1—2rpx 香槟金线，不持续旋转。

新增 docs/ui/PHOENIX_UI_ASSET_MANIFEST_V1.md，记录每个资产的路径、用途、来源方式、尺寸、字节数和 SHA-256。控制体积并验证首屏性能；同一资产不要复制多个近似版本。

## 7. 公共组件与布局

先扩展现有 brand-mark，使其在深浅背景上比例和清晰度统一。以共享 app.wxss 原子类为主；只有同一结构在至少三个页面重复时才抽成组件，避免为视觉改造制造大量业务耦合。

候选纯展示组件：

- phoenix-page-shell
- phoenix-header
- phoenix-state-view
- phoenix-gold-button
- phoenix-fixed-action-bar
- phoenix-question-card
- phoenix-result-card
- phoenix-privacy-note
- phoenix-trusted-sources

组件不得自行请求接口、导航、写 Storage 或持有支付/Consent 状态。事件由页面透传并保持原 handler 名。

页头：

- welcome 和 home 继续使用现有 custom navigation 与 utils/navigation.js 的真实状态栏/胶囊尺寸，不写死顶部高度。
- 其他页面继续使用原生导航栏，除非其当前 page.json 已是 custom；不要在原生导航栏下再画一套假系统导航。
- Logo 左对齐并使用现有透明图片；没有真实功能时不显示语言或分享胶囊。

固定操作栏：

- 使用 env(safe-area-inset-bottom)；
- 页面正文必须保留等高占位；
- 软键盘弹起时不遮挡最后一个输入项或按钮；
- 双按钮默认约 36%/64%，320px、大字体或长文案时改为上下排列。

## 8. 全页面改造映射

### 8.1 核心用户漏斗

1. pages/welcome
   - 将当前深蓝首屏升级为参考图式暖象牙白品牌首屏。
   - 保留真实 Logo、custom navigation 安全区、登录/开始状态、错误 Toast 和现有 Demo 顾问入口语义。
   - 使用低对比羽毛边缘装饰、深蓝主标题、金色关键词和单一主 CTA。
   - 登录中保持按钮宽度不跳动，失败时提供可见错误/重试状态。

2. pages/home
   - 做成温暖、可信的家庭工作台，不复制商业落地页。
   - 家庭、学生、测评、报告、支付和下一步使用统一纸张卡片、状态徽标和金色引导线。
   - 完整覆盖 loading、error、无家庭、无学生、无报告、L1/L2 草稿、锁定、支付查询和已解锁状态。
   - nextAction 只消费现有服务端/导航合同，不改变任何去向。

3. pages/compass
   - Free 和 Level 2 在手机中按现有业务状态纵向呈现，不做参考图的左右双栏。
   - Free 使用更纯净象牙白；Level 2 可增加浅金光晕和罗盘，但 CTA 仍是开始/继续学生问卷，不是提前支付。
   - 保留 L1、L2、Legacy、历史报告、有/无 Consent、creating、loading 和 error 状态。
   - 同意正文保持字符不变，使用清晰卡片、独立 checkbox 和 disabled/loading CTA。

4. pages/compass-questionnaire
   - 最接近参考图问卷屏：品牌区域、测试类型与题号、金色进度条、深蓝问题、辅助说明、全宽选项卡、保存/隐私提示和安全区按钮。
   - 选项卡最小高度 104rpx，间距 16rpx，圆角 20—24rpx，整行可点击；选中态同时使用浅金底、深金边、实心选择标记和文字状态。
   - 必须覆盖 single、multi、year、dynamic、matrix、long text、必填错误、上一题、下一题、自动保存、保存失败、跨设备冲突、体系切换、退出恢复和提交。
   - 长问题和长选项自然换行，不能固定文字高度或用 overflow:hidden 截断。
   - sticky/fixed CTA 不能遮挡最后一题，键盘状态必须检查。

5. pages/compass-preview
   - Free Snapshot 采用参考图结果页的信息层级：罗盘、结果标题、主信号卡、维度卡、下一步 CTA 和免责声明。
   - 四维卡在宽屏可四列，在窄屏/大字体下自动 2×2；评级同时显示文字和视觉点。
   - Level 2 locked 状态使用价值说明、真实价格和服务端支付可用状态，但绝不渲染付费正文。
   - 覆盖 loading、error、empty、Family Snapshot 建议/暂不建议、locked、支付开放/关闭、paying、growth-full 和 Legacy。

6. pages/payment-result
   - 做成可信的订单状态卡，不做电商大红促销风格。
   - 覆盖 checking、query error、CREATED、PENDING、PAYING、PAID、FAILED、CANCELLED、EXPIRED、REFUNDING、REFUNDED。
   - 每个状态使用图标、标题和文字，不只靠颜色；支付确认中不得显示已解锁。
   - 退款和失败操作清晰但不误导，不改变 retryPayment/openReport 行为。

7. pages/report
   - 使用罗盘结果 Hero、清晰的六模块报告卡、可信来源、限制/免责声明、PDF、AI 分析、反馈和管理入口。
   - 长正文以可读性优先，羽毛只放边缘，不在每个 section 重复装饰。
   - 覆盖 loading、error、not ready、ready、六模块空/有内容、Legacy 多状态、locked、PDF loading、反馈前后、家庭/顾问角色。
   - 不弱化“不保证录取”、可信来源、限制、AI 层级和管理入口。

### 8.2 AI 与顾问

8. pages/assessment-analysis
   - Free 与 Paid 分析使用同一品牌框架、不同清晰层级标签。
   - 罗盘/金色细环只做轻量 loading，不做持续复杂动画。
   - 覆盖 CONSENT、LOADING、RUNNING、PENDING、轮询到限、RESULT、BLOCKED、ERROR。
   - 双重同意、安全边界、可信来源、免费与付费层级差异保持可见。

9. pages/agent-chat
   - 使用暖白纸张背景、深蓝/浅金的两类对话气泡、可信来源卡和安全区 composer。
   - 长回复、来源、错误和系统状态不溢出；不渲染不可信 HTML。
   - 覆盖无资格、双重同意、历史 loading、空会话、消息、sending、任务轮询、失败/取消/阻断、次数用尽、授权撤回和数据管理。
   - “撤回 AI 同意”“删除这段对话”应始终可发现，危险操作与主 CTA 视觉分级。

10. pages/advisor-request
    - 暖白画布、单一主表单卡、明确字段层级和金色 CTA。
    - 报告关联、Consent、saving、校验、成功和错误状态均可见。
    - 不默认勾选、不捆绑 Advisor Consent。

### 8.3 家庭资料、时间线和我的

11. pages/family-edit
12. pages/student-edit
    - 统一表单标题、标签、input、picker、textarea、必填、选填、帮助、错误和 saving 视觉。
    - 键盘弹起、长选项、空资料、编辑/创建模式和返回行为可用。
    - 不改变字段、校验、保存接口或无家庭重定向。

13. pages/timeline
    - 使用细金时间轴、暖白事件卡和明确年月/状态层级。
    - loading、error、empty、列表、长内容和下拉刷新都要有视觉反馈。
    - TabBar 与安全区不遮挡最后一项。

14. pages/mine
    - 使用个人/家庭摘要卡、订单与学生列表、Consent 管理和数据管理分区。
    - loading 不得继续空白；无家庭/有家庭、无订单/有订单、无学生/有学生及 consentBusy 都有状态。
    - 五类独立 Consent 的撤回入口不能合并；退款、撤回、删除等高影响操作使用清晰危险层级，不用金色主 CTA 伪装。

### 8.4 Admin Demo

15. pages/admin-families
16. pages/admin-family
    - 统一品牌 token、表格/列表、搜索、空态、详情、备注编辑和子列表层级。
    - 保持演示数据和现有 repository/auth 行为不变。
    - 不把两个页面加入 release，不引入生产远程能力。

## 9. 无障碍、响应式和微信原生约束

- 文本对比度至少 4.5:1，大字与必要图标至少 3:1。
- 所有按钮、option、checkbox、icon button 至少 44×44 CSS px。
- 选择、错误、支付、评级和进度必须同时有文字/形状，不能只用颜色。
- 有意义图片提供可理解的替代语义；纯装饰图片不进入读屏顺序且不能拦截点击。
- 使用 radio/checkbox/button 的原生语义；基础库支持时补充 aria-label、aria-role、aria-checked。
- 支持文本换行、系统字体放大和长中文，不写死行数，不裁切重要文字。
- 使用 rpx 布局；1rpx 只用于边框。
- 不依赖 backdrop-filter 等兼容性不稳定效果。
- 不绘制假 iOS 状态栏或微信胶囊。
- welcome/home 顶部使用 wx.getWindowInfo() 与 wx.getMenuButtonBoundingClientRect() 的现有计算结果，不硬编码。
- 所有固定底栏加 safe-area，检查 iOS Home Indicator、Android 导航栏和软键盘。

最小检查矩阵：

- 320×568
- Android 360×800
- iPhone 375×812
- iPhone 390×844
- 430×932
- 一个平板宽度
- 默认字体和系统大字体
- iOS 与 Android

## 10. 状态矩阵与视觉验收文件

实施前创建：

<PROJECT_ROOT>\docs\ui\PHOENIX_UI_ROUTE_STATE_MATRIX_V1.md

矩阵至少列出：

- 16 个页面；
- 是否进入 release；
- 导航类型；
- loading/error/empty/content/disabled；
- 页面特有状态；
- 主要 CTA 与 handler；
- 查询参数；
- sticky/fixed 区域；
- 隐私/Consent/支付/AI 风险；
- 320/360/375/390/430 宽度验收结果；
- DevTools iOS、DevTools Android、iOS 真机、Android 真机状态。

重要页面状态不能省略：

- questionnaire：所有题型、校验、前后题、保存、冲突、退出恢复、提交；
- preview/report：Free、locked、支付、完整六模块、长来源、PDF；
- payment-result：所有十类订单状态；
- assessment-analysis/agent-chat：无授权、同意、排队、轮询、成功、安全阻断、失败、撤回、删除；
- mine：五类独立 Consent 和 consentBusy。

## 11. 修改前保护证据

在 artifacts/ui-review/<UTC>/ 中创建：

- before-protected-sha256.json
- required-handler-baseline.json
- route-tabbar-baseline.json
- source-ui-manifest.before.json

before-protected-sha256.json 至少覆盖：

- app.js
- server/**
- services/**
- models/**
- config/**
- utils/**
- docs/product/freeze/**
- docs/openapi/**
- migrations
- 所有 pages/**/index.js
- package-lock.json

route-tabbar-baseline.json 记录 app.json 的 pages 顺序、window navigationStyle、TabBar pagePath/text 和 lazyCodeLoading。

required-handler-baseline.json 从全部 WXML 自动收集事件 handler 与 data-*；改造完成后逐项比较，业务绑定不得缺失或改名。

因为当前可能不是 Git 仓库，不能用“git diff 为空”代替这些 manifest。

## 12. 实施阶段

Phase 0｜只读审计

- 读取权威文件、参考图和实际代码；
- 生成页面/状态/handler/资产清单；
- 运行现有 baseline；
- 记录已有失败，不把它误归因于本次 UI。

Phase 1｜设计系统与资产

- 集中整理 app.wxss token；
- 扩展 brand-mark；
- 创建最少且可复用的纯展示组件；
- 创建、检查、压缩并登记原创 UI 资产；
- 建立 UI 合同测试。

Phase 2｜关键漏斗

- welcome、home、compass、compass-questionnaire、compass-preview、payment-result、report；
- 每完成一个纵向页面组，立即运行 test:ui-contract 和 test:client；
- 先验证全部状态，再进入下一组。

Phase 3｜其余 release 页面

- assessment-analysis、agent-chat、advisor-request、family-edit、student-edit、timeline、mine；
- 验证长文本、Consent、键盘、安全区和 TabBar。

Phase 4｜Admin Demo

- admin-families、admin-family；
- 统一样式但保持 release 排除。

Phase 5｜全量验证

- 生成 after manifest；
- 比较保护文件、路由、handler、data-*；
- 构建 release；
- 在微信开发者工具逐页逐状态截图；
- 修复 clipping、spacing、对比度、状态缺失和 Android/iOS 差异；
- 输出验收报告。

不要为了减少步骤牺牲证据；独立文件读取和独立页面检查可以并行，但业务合同确认、资产选择和最终验收必须在综合后进行。

## 13. 自动化 UI 合同测试

新增 tests/validate-ui-contract.js 和 package script：

test:ui-contract = node tests/validate-ui-contract.js

并把 test:ui-contract 接入 test:client。测试至少自动断言：

1. app.json 仍有相同的 16 个 pages，顺序和三个 TabBar pagePath 不变。
2. 16 个页面的 WXML/WXSS 都存在；14 个 release 页面仍由 build-release 生成，两个 Admin Demo 仍排除。
3. before/after 中所有 WXML handler 和 data-* 均保留。
4. 关键安全/价格/AI/Consent 文案仍存在。
5. 不存在 web-view、远程图片 URL、外部字体、客户端 OpenAI/飞书密钥或大段 base64 UI。
6. 没有无 handler 的“中文”“分享”或向下箭头假控件。
7. 触控组件的公共样式最小尺寸达到 88rpx；固定栏使用 safe-area。
8. welcome/home 没有新增硬编码状态栏高度或假胶囊。
9. 新 UI 资产全部位于允许目录、存在 manifest、大小在预算内且没有整张参考图。
10. package.json 只增加 script，不新增依赖；package-lock.json 未改变。

静态测试不能替代人工可视验收，但任何合同测试失败都必须先修复。

## 14. 截图与人工视觉 QA

只接受微信开发者工具或真机的真实页面截图，保存到：

artifacts/ui-review/<UTC>/screenshots/devtools-ios/
artifacts/ui-review/<UTC>/screenshots/devtools-android/
artifacts/ui-review/<UTC>/screenshots/device-ios/
artifacts/ui-review/<UTC>/screenshots/device-android/

使用相同 fixture、相同视口和相同业务状态生成 before/after；截图命名不得包含个人资料。逐张检查：

- Logo 比例和清晰度；
- 页头与胶囊是否冲突；
- 左右留白、字体、圆角、金色和阴影是否一致；
- 羽毛是否停留在边缘且不压正文；
- CTA 是否位于安全区上方；
- fixed/sticky 是否遮挡内容；
- 长问题、长报告、长来源、价格、大字体是否溢出；
- 四维卡窄屏是否转为 2×2；
- loading、empty、error、disabled、selected、saving、paying、submitting 是否可辨；
- 键盘弹起后输入和操作是否仍可用；
- 支付/Consent/撤回/删除是否没有被装饰弱化。

若无法控制微信开发者工具或真机：

- 完成源码、构建、静态检查和可执行手工清单；
- 状态标记 LOCAL_UI_CODE_VERIFIED + BLOCKED_MANUAL；
- 不使用浏览器/H5、参考图拼接、Figma 或合成图片冒充小程序截图。

## 15. 必跑命令

Windows 只使用 npm.cmd，不修改 PowerShell ExecutionPolicy。

~~~~powershell
Set-Location -LiteralPath 'C:\Users\1\Documents\Codex\2026-08-20\new-chat\work\phoenix_v030_feishu_backend\phoenix-family-os-mvp'

node --version
npm.cmd --version

npm.cmd run scan:release-secrets
npm.cmd run test:ui-contract
npm.cmd run test:client
npm.cmd run typecheck:server
npm.cmd run test:server
npm.cmd run test:education-contracts
npm.cmd run test:education-http
npm.cmd run test:education-integrations
npm.cmd run smoke:education
npm.cmd run validate:education-docs
npm.cmd run test:all
npm.cmd run build:release
npm.cmd run test:release
npm.cmd run verify:education-evidence
~~~~

说明：

- 每条命令记录开始时间、结束时间、exit code、真实测试数和失败原因。
- 不重复安装依赖，除非缺失且 lockfile 允许；需要安装时使用 npm.cmd ci 和项目本地 cache，不修改系统策略。
- test:education-postgres 只有在提供专用测试数据库并通过身份哨兵时运行；否则 BLOCKED_EXTERNAL。
- build:release 在 touristappid、离线 API 或未批准环境下只算 OFFLINE_TEST_ONLY，不得称 production candidate。
- 不因 UI 任务修改服务端来让测试变绿；若 baseline 原已失败，提供证据并区分 PRE_EXISTING_FAILURE。

## 16. 完成后保护检查

生成：

- after-protected-sha256.json
- route-tabbar-after.json
- required-handler-after.json
- source-ui-manifest.after.json
- ui-contract-results.json
- commands.ndjson

验收要求：

- 禁止修改的业务文件 before/after SHA-256 完全一致；
- app.json 路由、页面顺序、TabBar pagePath 和 lazyCodeLoading 完全一致；
- 所有 handler 和 data-* 零丢失；
- package-lock.json 零变化；
- 001—现有 migrations 零变化；
- dist 只由 build:release 生成；
- 参考图未被复制进 release；
- 新资产和源码可追溯到 manifest；
- 所有执行过的测试真实报告 PASS/FAIL/BLOCKED，不补写不存在的成功证据。

## 17. 交付物

必须提交：

1. 完整前端源码修改。
2. docs/ui/PHOENIX_UI_DESIGN_SYSTEM_V1.md
3. docs/ui/PHOENIX_UI_ROUTE_STATE_MATRIX_V1.md
4. docs/ui/PHOENIX_UI_ASSET_MANIFEST_V1.md
5. docs/ui/PHOENIX_UI_VISUAL_ACCEPTANCE_REPORT_V1.md
6. tests/validate-ui-contract.js 和 test:ui-contract。
7. artifacts/ui-review/<UTC>/ 的 before/after manifest、命令、测试和截图证据。
8. 重新生成并验证的 dist/release；保持 Admin Demo 排除。

除非用户另行要求，不自动生成 ZIP；未经 DevTools/真机验收不得生成带 verified、production 或 release-approved 含义的包名。

## 18. 最终状态与回复格式

最终只使用符合证据的状态：

- UI_IMPLEMENTATION_IN_PROGRESS
- LOCAL_UI_VERIFICATION_FAILED
- LOCAL_UI_CODE_VERIFIED
- LOCAL_UI_CODE_VERIFIED + BLOCKED_MANUAL
- DEVTOOLS_UI_VERIFIED
- DEVICE_UI_VERIFIED

DEVTOOLS_UI_VERIFIED 要求 iOS/Android DevTools 页面矩阵有真实截图并通过；DEVICE_UI_VERIFIED 还要求 iOS/Android 真机矩阵通过。UI 状态不提升后端、支付、OpenAI、飞书、staging 或生产状态。

最终回复必须包含：

- 实际状态；
- 完成的视觉变化；
- 所有修改文件绝对路径；
- 16 页覆盖情况及 14/2 release 边界；
- protected/hash/handler/route 对比结果；
- 每条命令和 exit code；
- 自动测试数与结果；
- DevTools/真机视口与状态矩阵；
- 屏幕截图和验收文档绝对路径；
- BLOCKED、PRE_EXISTING_FAILURE 和剩余风险；
- 明确说明未执行的真实支付、外部写入、部署和发布。

先输出一个不超过 12 项的执行计划，然后立即从 Phase 0 开始。不要在无实质阻塞时要求再次确认。
~~~~~~

## 使用前说明

- 本指令只授权一次本地前端视觉改造和非破坏性验证。
- 参考图中的 Free 15 秒、¥39.9、语言与分享等不是已批准的新功能。
- 若执行时发现 Product Freeze、实际代码或测试与本指令不一致，以更高权威来源为准并报告差异。
- 本指令的完成不代表可上线；微信开发者工具、真机、真实支付和生产发布仍有各自验收与授权门槛。
