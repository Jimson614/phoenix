# Phoenix UI Asset Manifest V1

> 文档状态：资产来源与完整性记录  
> 基线日期：2026-08-26  
> 资产目录：`assets/ui/`  
> 关联规范：[UI Design System](./PHOENIX_UI_DESIGN_SYSTEM_V1.md)

## 1. 范围

本清单记录本轮 UI 升级新增的两张 ImageGen 透明 PNG，以及从生成原图到小程序项目资产的规范化过程。两张外部 UI 图片只作为风格参考，不作为被复制、嵌入或发布的资产。

项目内 UI 位图总量：

- 文件数：2
- 总字节：875,790 bytes（约 855.26 KiB）
- 单文件上限：750 KiB
- `assets/ui` 总预算：1.5 MiB
- 当前自动预算检查：PASS
- 两张项目资产均为本地 32-bit ARGB PNG；未使用远程 URL 或 base64 内联

## 2. 项目资产总表

| Asset | 项目路径 | 尺寸 | 字节 | SHA256 |
|---|---|---:|---:|---|
| Champagne feather | `assets/ui/feather-champagne.png` | 640 × 960 | 523,396 | `c75bb6061c0e4219917508ea6d39e1cddca2b1b459ce67895d4d1f8f7737e2ca` |
| Champagne compass | `assets/ui/compass-champagne.png` | 640 × 640 | 352,394 | `79b211ffb94a4ed911cfe6675a771344724a1d6f80ca69d1beca4c0515c277ac` |

项目绝对路径基线：

- `C:\Users\1\Documents\Codex\2026-08-20\new-chat\work\phoenix_v030_feishu_backend\phoenix-family-os-mvp\assets\ui\feather-champagne.png`
- `C:\Users\1\Documents\Codex\2026-08-20\new-chat\work\phoenix_v030_feishu_backend\phoenix-family-os-mvp\assets\ui\compass-champagne.png`

绝对路径仅记录本次工作环境；代码和文档引用 MUST 使用仓库相对路径或小程序根路径。

## 3. ImageGen 原图来源

### 3.1 Feather source

| 字段 | 记录 |
|---|---|
| ImageGen 原图路径 | `C:\Users\1\.codex\generated_images\01a01e0f-62bd-78f3-a25f-d59177bdccda\exec-49017ab8-79ab-45b2-9ab5-76c7bbcfdb46.png` |
| 原图尺寸 | 1024 × 1536 |
| 原图像素格式 | 32-bit ARGB / RGBA |
| 原图字节 | 1,938,388 |
| 原图 SHA256 | `42a20a42762186ee6ef4d4884f13f43e1de4e9bf33a90eda5be7796577fa81af` |
| 生成提示摘要 | 参考两张 UI 仅作风格，生成单支香槟金极细线凤凰羽毛；透明背景；无文字、Logo、水印、UI 或罗盘；适合低透明度边缘装饰。 |
| 最终项目文件 | `assets/ui/feather-champagne.png` |
| 最终尺寸 / 字节 | 640 × 960 / 523,396 |
| 最终 SHA256 | `c75bb6061c0e4219917508ea6d39e1cddca2b1b459ce67895d4d1f8f7737e2ca` |

### 3.2 Compass source

| 字段 | 记录 |
|---|---|
| ImageGen 原图路径 | `C:\Users\1\.codex\generated_images\01a01e0f-62bd-78f3-a25f-d59177bdccda\exec-05bcfa6a-96e7-45c3-bebb-d767f080258e.png` |
| 原图尺寸 | 1254 × 1254 |
| 原图像素格式 | 32-bit ARGB / RGBA |
| 原图字节 | 1,205,206 |
| 原图 SHA256 | `a1d33ffe7aea61677e5a7d299ee1c687987c7b32e9014ea521709ae9231e9972` |
| 生成提示摘要 | 参考两张 UI 仅作风格，生成对称香槟金教育罗盘，包含细圆环、星点与指针；透明背景；无文字、Logo、水印或完整 UI。 |
| 最终项目文件 | `assets/ui/compass-champagne.png` |
| 最终尺寸 / 字节 | 640 × 640 / 352,394 |
| 最终 SHA256 | `79b211ffb94a4ed911cfe6675a771344724a1d6f80ca69d1beca4c0515c277ac` |

提示摘要是本次生成意图的简要记录，不声称为工具内部提示的逐字副本。

## 4. 规范化过程

两张 ImageGen 原图均经过以下本地处理后写入项目：

1. 使用 Pillow 读取 RGBA 原图。
2. 保持原纵横比：
   - Feather：1024×1536 → 640×960。
   - Compass：1254×1254 → 640×640。
3. 使用 LANCZOS 重采样。
4. 保留 alpha 通道。
5. PNG 保存使用 optimize 与 compression level 9。
6. 最终文件写入 `assets/ui/`。

注意：

- Pillow 版本、zlib 版本或编码器差异可能改变压缩后的字节与 SHA256，即使像素相同。
- 若要求位级复现，应保留本清单记录的最终项目文件，不应只依赖重新运行压缩步骤。
- 更换资产必须同时更新尺寸、字节、SHA256、引用页面、预算结果和视觉验收记录。

## 5. 透明度验证

本次读取结果：

| Asset | Pixel format | 采样 alpha 最小值 | 采样 alpha 最大值 | 结论 |
|---|---|---:|---:|---|
| `feather-champagne.png` | Format32bppArgb | 0 | 255 | 包含全透明至不透明 alpha |
| `compass-champagne.png` | Format32bppArgb | 0 | 255 | 包含全透明至不透明 alpha |

采样按固定步长读取像素，用于确认透明通道存在；它不是逐像素视觉验收。边缘光晕、抠图质量和不同背景上的表现仍属于手工视觉检查。

## 6. 使用范围

### 6.1 Feather

当前在全部 16 个源码页面中使用，包括两个 demo admin 页面。典型用途：

- 页面右上或左下低透明边缘装饰。
- 问卷、报告、支付、家庭档案、时间线和 AI 页面背景。
- 不承担点击、状态或业务含义。

### 6.2 Compass

当前在 12 个源码页面使用：

- `welcome`
- `home`
- `family-edit`
- `student-edit`
- `compass`
- `compass-questionnaire`
- `compass-preview`
- `payment-result`
- `report`
- `assessment-analysis`
- `agent-chat`
- `advisor-request`

典型用途：

- Education Compass 品牌识别。
- 页面 hero、结果封面、空态或 loading 的非文字视觉焦点。
- 不单独表达“支付成功”“AI 已完成”或任何诊断结论。

## 7. 运行时规则

- WXML 使用小程序根路径：`/assets/ui/feather-champagne.png`、`/assets/ui/compass-champagne.png`。
- 装饰图 SHOULD 使用 `aria-hidden="true"` 和 `pointer-events: none`。
- 羽毛显示透明度通常为 0.12–0.30。
- 不得把原始 1024/1254px ImageGen 文件直接复制进 release。
- 不得改为远程 URL、data URI 或运行时下载。
- 不得为每个页面复制同一位图。
- 若 release 包体预算收紧，应优先评估无损/有损 WebP 兼容方案，但更换格式前必须完成 DevTools 与 iOS/Android 手工验收。

## 8. 完整性复核命令

PowerShell：

```powershell
Get-ChildItem .\assets\ui -File |
  ForEach-Object {
    [PSCustomObject]@{
      Name = $_.Name
      Bytes = $_.Length
      SHA256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
```

尺寸和 alpha 必须通过支持 PNG alpha 的图像库读取。仅看文件扩展名不能证明透明背景。

