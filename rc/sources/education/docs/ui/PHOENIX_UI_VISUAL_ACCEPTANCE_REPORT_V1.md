# Phoenix UI Visual Acceptance Report V1

> 报告状态：**NOT_READY_FOR_VISUAL_SIGNOFF**  
> 基线日期：2026-08-26  
> 自动化代码契约：PASS  
> 微信开发者工具视觉验收：**BLOCKED_MANUAL**  
> iOS 微信真机视觉验收：**BLOCKED_MANUAL**  
> Android 微信真机视觉验收：**BLOCKED_MANUAL**  
> 本报告生成的页面截图数量：**0**

## 1. 结论

当前代码已通过客户端自动化契约和本地结构性检查，但本执行环境没有完成交互式微信开发者工具预览、iOS 真机或 Android 真机检查，也没有生成任何可以作为视觉通过证据的截图。

因此：

- 可以确认路由、事件绑定、安全文案、本地资产预算和 14/2 release 边界的自动化契约通过。
- 不能确认 WXML/WXSS 已在目标微信基础库完成编译和渲染。
- 不能确认不同设备的字体、胶囊安全区、图片 alpha、滚动、键盘、支付原生层或系统字体放大表现。
- 不得将本报告表述为“截图验收通过”“iOS/Android 适配完成”或“可直接发布”。

## 2. 本次实际执行证据

### 2.1 自动化客户端测试

执行命令：

```powershell
npm run test:client
```

结果：**PASS_AUTOMATED**

实际覆盖包括：

- 家庭 → 学生 → Compass → 报告 → 时间线 → 顾问的领域流程。
- 16 个源码页面的文件、JSON/JS、注册和模块解析。
- 3 个 tab 路径和 lazy loading 契约。
- 必需 WXML handler 与 `data-*` 绑定。
- 冻结产品/安全文案、原生页面、本地资源与 UI 位图预算。
- 双分析、已购追问、同意、可信来源和不持久化对话正文边界。
- 16 页源码 / 14 页 release / 2 页 demo admin 排除。
- Release 不包含本地数据库、demo 生成器、server、OpenAI SDK/Prompt/Key 或 admin 页面。

上述检查是静态和 Node 侧契约验证，**不是微信渲染截图验证**。

### 2.2 本地结构性检查

对 `app.json` 注册的 16 页执行启发式检查：

- 常见 WXML 标签开闭平衡：PASS_HEURISTIC
- WXSS 大括号平衡：PASS_HEURISTIC

限制：

- 此检查不是微信官方 WXML/WXSS 编译器。
- 它不能验证基础库 CSS 支持、组件属性、层叠结果、字体排版或真机渲染。

### 2.3 资产完整性

- 两张项目 UI PNG 均存在。
- 尺寸、字节、SHA256 和 alpha 通道已读取。
- `assets/ui` 总计 875,790 bytes，自动预算检查通过。
- 详细证据见[视觉资产清单](./PHOENIX_UI_ASSET_MANIFEST_V1.md)。

## 3. 环境状态

| 环境 | 状态 | 已执行 | 未完成原因 / 所需条件 |
|---|---|---|---|
| Node 客户端契约 | PASS_AUTOMATED | `npm run test:client` | 不适用 |
| 本地 WXML/WXSS 结构启发式检查 | PASS_HEURISTIC | 16 页标签/大括号平衡 | 非官方编译器 |
| WeChat DevTools | **BLOCKED_MANUAL** | 未启动、未导入、未截图 | 需要交互式 DevTools、登录/AppID 或批准的测试构建、目标基础库和测试数据 |
| DevTools 320 宽 | **BLOCKED_MANUAL** | 未渲染 | 同上 |
| DevTools 360 宽 | **BLOCKED_MANUAL** | 未渲染 | 同上 |
| DevTools 375 宽 | **BLOCKED_MANUAL** | 未渲染 | 同上 |
| DevTools 390 宽 | **BLOCKED_MANUAL** | 未渲染 | 同上 |
| DevTools 430 宽 | **BLOCKED_MANUAL** | 未渲染 | 同上 |
| iOS WeChat 真机 | **BLOCKED_MANUAL** | 未安装、未预览、未截图 | 需要实际 iPhone、目标 iOS/WeChat 版本、体验版或真机调试权限 |
| Android WeChat 真机 | **BLOCKED_MANUAL** | 未安装、未预览、未截图 | 需要实际 Android 设备、目标系统/WeChat 版本、体验版或真机调试权限 |
| 原生支付层视觉 | **BLOCKED_MANUAL** | 未触发 | 需要微信支付测试商户、订单和服务端回调环境 |
| 系统字体放大 / 辅助功能 | **BLOCKED_MANUAL** | 未检查 | 需要 DevTools/真机辅助功能设置 |
| 截图对比 | **BLOCKED_MANUAL** | 0 张 | 需要同一状态的实际截图及批准基线 |

## 4. 手工验收准备

1. 从当前代码运行 `npm run test:client`，必须保持通过。
2. 选择构建：
   - 纯 UI/静态状态检查可使用批准的测试构建。
   - 支付、权益、报告和 AI 权限检查必须使用受控测试服务端；不得用前端假数据宣称正式流程通过。
3. 在 WeChat DevTools 中记录：
   - DevTools 版本。
   - 调试基础库版本。
   - AppID / 测试构建类别。
   - Windows/macOS 主机信息。
4. 关闭浏览器式自动缩放，确保模拟器按目标 CSS viewport 宽度显示。
5. 对每个 viewport 清除缓存后冷启动一次，再执行热重载和返回栈检查。
6. 准备可重复的服务端或测试账号状态，覆盖[路由状态矩阵](./PHOENIX_UI_ROUTE_STATE_MATRIX_V1.md)中的 loading、error、empty、content、disabled 和特有状态。
7. 截图命名建议：

```text
{platform}_{viewport}_{route}_{state}_{yyyyMMdd-HHmmss}.png
```

8. 每张截图记录数据前提；支付与 AI 权限状态不得仅凭截图推断。

## 5. 五个 viewport 的手工步骤

### 5.1 320 × 568

状态：**BLOCKED_MANUAL**

1. DevTools 选择自定义设备，viewport 设置为 320×568。
2. 冷启动 `welcome`，确认 Logo、标题、罗盘、羽毛和两个操作不横向溢出。
3. 依次进入 14 个 release 页面，检查全局 gutter 已收紧、H1/H2 缩小、按钮文字仍完整。
4. 在 `student-edit` 检查两列表单降为单列。
5. 在 `compass-questionnaire` 检查长题目、多选项、成绩矩阵和底部操作区；最后一项不得被按钮遮挡。
6. 在 `assessment-analysis` 和 `agent-chat` 检查双重同意长文、可信来源、危险按钮和输入区无横向滚动。
7. 在 `report` 检查长标题、来源、免责声明、AI 入口和反馈卡自然换行。
8. 滚动到每页底部，确认安全区、tabBar 和固定操作不重叠。
9. 分别捕获 content、error/blocked、empty 和 disabled/busy 截图；不存在独立状态的页面按矩阵标记 N/A，不能伪造。

通过标准：无水平滚动、无正文裁切、无按钮文字截断、无装饰遮挡、点击区仍不小于 44 CSS px。

### 5.2 360 × 800

状态：**BLOCKED_MANUAL**

1. viewport 设置为 360×800。
2. 重复冷启动，确认 `@media (max-width: 360px)` 规则在 360 边界生效。
3. 对比 320 宽，检查 gutter、标题和卡片内边距没有异常跳变。
4. 重点检查 `family-edit`、`student-edit`、`advisor-request` 的输入、picker、textarea 和键盘弹起后的可滚动区域。
5. 检查问卷保存退出、上一步、继续按钮在 saving/submitting/routeReloading 时的禁用和 spinner。
6. 检查 preview 的锁定商品卡、价格、支付按钮和免责说明是否处于同一视觉层级。
7. 检查 mine 的五类撤回按钮在 consentBusy 时全部有清晰禁用状态。
8. 捕获每个关键状态截图，并与 320 宽结果并排检查。

通过标准：360 断点无闪跳、表单不挤压、授权文字不被截断、禁用态仍可读。

### 5.3 375 × 812

状态：**BLOCKED_MANUAL**

1. viewport 设置为 375×812，作为主要手机基线。
2. 从 welcome 完成家庭 → 学生 → Compass 的可达流程。
3. 对问卷至少覆盖单选、多选、文本、成绩矩阵、草稿恢复和末题提交。
4. 对 preview/report 覆盖 family 免费结果、growth locked、growth full、legacy、generating/not-ready。
5. 对 payment result 覆盖无订单、checking、PAID、PENDING/PAYING、FAILED/CANCELLED/EXPIRED/CREATED 和 error。
6. 对 assessment analysis 覆盖 CONSENT、RUNNING、PENDING、RESULT、BLOCKED、ERROR。
7. 对 agent chat 覆盖首次同意、空会话、用户/AI 消息、可信来源、poll limit、同意撤回和删除管理。
8. 检查 timeline 的 skeleton、error、empty、content；advisor 的未同意、submitting、success；mine 的 loading、订单空态、consentBusy。
9. 捕获完整状态基线；图片必须包含 viewport、route 和 state 记录。

通过标准：视觉层级最接近参考方向，且所有安全、支付、来源和权限文案完整可读。

### 5.4 390 × 844

状态：**BLOCKED_MANUAL**

1. viewport 设置为 390×844。
2. 选择带刘海/圆角的 iPhone 类模拟器，记录状态栏和胶囊尺寸。
3. 检查 welcome/home 自定义导航使用真实安全区，不出现假状态栏或与微信胶囊重叠。
4. 检查羽毛在右上和左下仍只停留于边缘，不随宽度扩大进入正文。
5. 检查报告、AI 和支付页的主卡片宽度、标题行数和 CTA 仍保持紧凑，不出现不必要的大空白。
6. 检查 tabBar 三路径 home/timeline/mine 的选中色、底色和底部安全区。
7. 进行一次页面前进/返回和横竖屏锁定检查；本规范只接受竖屏主布局。
8. 捕获与 375 基线相同状态，以便人工对比。

通过标准：安全区正确、宽度增长只改善留白，不改变业务层级或产生装饰遮挡。

### 5.5 430 × 932

状态：**BLOCKED_MANUAL**

1. viewport 设置为 430×932。
2. 冷启动所有 14 个 release 页面。
3. 检查页面没有因宽屏而把内容拉成参考图中的左右双手机布局。
4. 检查卡片、表单和聊天气泡保持合理阅读行长；正文不应贴边或无限拉宽。
5. 检查四列/双列信息在宽屏仍对齐，窄屏降级规则未错误触发。
6. 检查大面积羽毛、罗盘和光晕没有变成主体，也没有出现位图锯齿、白边或不透明底。
7. 检查底部安全区、tabBar、长报告、长对话和 textarea 滚动。
8. 捕获与 375 基线相同状态，并记录任何仅在 430 出现的留白或比例问题。

通过标准：布局未过度拉伸，装饰清晰但克制，卡片、CTA 和文本层级与 375 基线一致。

## 6. 全路由手工状态清单

以下每项在至少 375 viewport 检查；高风险项还应在 320 和 430 重复。

| 组 | 必测状态 |
|---|---|
| Welcome / Home | welcome busy；home loading、error、onboarding、family content |
| Profile forms | family/student initial disabled、saving、长字段、键盘、picker |
| Compass | loading、error、L1 guardian consent、L2 student Assent、legacy、creating、history |
| Questionnaire | loading、error、empty、草稿、所有题型、saving、submitting、routeReloading |
| Preview | family、growth-locked、growth-full、legacy、empty、paying disabled |
| Payment | checking、error、全部订单状态、无 order |
| Report | loading、error、locked、generating、not-ready、growth ready、full、legacy、局部空项、PDF/反馈 busy |
| Assessment AI | CONSENT、LOADING/RUNNING/PENDING、RESULT、BLOCKED、ERROR、poll limit、可信来源 |
| Agent chat | loading、error、ineligible、consent、history loading、empty、messages、run、poll limit、withdraw/delete |
| Timeline | loading skeleton、error、empty、content |
| Advisor | 未同意 disabled、submitting、success |
| Mine | loading、无订单、content、consentBusy、危险撤回 |
| Demo admin | 仅源码测试：列表有/无/搜索空；详情 loading/局部空；release 中必须不存在 |

## 7. 通用视觉验收标准

### 7.1 视觉

- 背景为暖象牙白，标题为海军蓝，品牌强调为香槟金。
- 小号金色文字有足够对比度。
- 宋体仅用于叙事标题；正文、表单、按钮使用系统无衬线。
- 卡片为暖色细边和柔和阴影，不出现冷灰、纯黑重阴影或玻璃堆叠。
- 羽毛与罗盘透明背景干净，无白色矩形边、锯齿或明显压缩伪影。
- 装饰不覆盖正文、输入、按钮和状态。

### 7.2 布局与交互

- 无水平滚动、正文裁切或不可达按钮。
- 点击目标至少 88rpx；整行选项可点击。
- disabled、loading、error、empty、content 可明显区分。
- CTA 按下反馈不导致布局跳动。
- textarea、picker、checkbox 和 scroll-view 在 DevTools 与真机均可操作。
- 固定/粘性区域避让 safe area 和 tabBar。

### 7.3 业务和安全

- 价格来自现有数据，不被视觉层硬编码替换。
- 支付成功只来自服务端核验。
- 付款前不出现完整报告正文。
- 免费分析、已购总分析和追问入口保持独立。
- 双重同意、可信来源、限制、监护人警示、撤回和删除入口完整。
- 两个 admin demo 页面不在 release 包。
- 不出现参考图中的假语言、分享或状态栏功能。

## 8. iOS 真机步骤

状态：**BLOCKED_MANUAL**

1. 使用至少一台小屏和一台现代刘海/灵动岛 iPhone。
2. 记录设备型号、iOS、WeChat、体验版版本和网络环境。
3. 执行 375/390 对应流程；额外检查导航胶囊、safe area、宋体 fallback、按钮 spinner、textarea 键盘和滚动回弹。
4. 检查 PNG alpha 在 P3/高亮屏上的边缘和金色偏色。
5. 使用系统较大字体重跑 consent、report、agent chat 和 mine。
6. 原生支付只使用测试订单，并确认返回页面仍以服务端状态为准。
7. 保存带设备信息的截图和问题记录。

## 9. Android 真机步骤

状态：**BLOCKED_MANUAL**

1. 至少选择一台 360 宽常见设备和一台 430 宽大屏设备。
2. 记录设备、Android、WeChat、厂商字体缩放和体验版版本。
3. 重点检查宋体 fallback、行高、checkbox/picker、textarea 键盘、scroll-view、tabBar 和 fixed/sticky 区域。
4. 检查低端设备上羽毛/罗盘滚动性能和按钮按压反馈。
5. 使用系统字体放大重跑长授权、来源、报告和危险操作。
6. 使用测试订单检查原生支付返回；不得用客户端成功回调代替服务端核验。
7. 保存带设备信息的截图和问题记录。

## 10. 待补验收记录模板

手工完成后填写，不得提前把状态改为 PASS：

| 字段 | 待填写 |
|---|---|
| DevTools 版本 | 2.01.2510260（已识别；CLI 自动编译 BLOCKED_MANUAL） |
| 调试基础库 | TBD |
| 测试构建 / AppID 类别 | TBD |
| 320 截图目录 | TBD |
| 360 截图目录 | TBD |
| 375 截图目录 | TBD |
| 390 截图目录 | TBD |
| 430 截图目录 | TBD |
| iOS 设备 / 系统 / WeChat | TBD |
| Android 设备 / 系统 / WeChat | TBD |
| 测试账号与数据状态说明 | TBD |
| 发现问题 | TBD |
| 修复提交 | TBD |
| 复测结果 | TBD |
| 设计签字 | TBD |
| 产品签字 | TBD |
| QA 签字 | TBD |

## 11. 当前开放风险

1. 微信官方编译与渲染尚未执行。
2. 五个 viewport 均无实际截图。
3. iOS/Android 字体 fallback 和图片 alpha 尚未确认。
4. 键盘、scroll-view、safe area、tabBar 与自定义导航需要真机复核。
5. 原生支付层、服务端订单回调和 AI 状态需要受控外部环境。
6. 自动契约通过不证明视觉与参考图达到像素级一致。
7. 在以上项目完成前，视觉验收总状态保持 **NOT_READY_FOR_VISUAL_SIGNOFF**。

## 12. 本机 DevTools 自动化尝试记录

- 已调用 `D:\微信web开发者工具\cli.bat` 并确认 CLI 可用。
- 尝试使用源码项目路径和 `--port 9420` 打开项目；开发者工具进程成功启动。
- `127.0.0.1:9420` 始终未进入监听状态，CLI 等待后超时。
- 对应日志出现 `WeappLocalData` 的 `readFileSync/writeFileSync fail to get lock`，因此没有取得官方编译结果或模拟器截图。
- 为避免损坏微信开发者工具账号、缓存或其他项目，本次没有删除其用户数据或锁文件；当前状态保持 **BLOCKED_MANUAL**。
