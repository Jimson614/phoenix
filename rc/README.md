# Phoenix Nova RC — local demonstration

四个现有候选组装的前端 RC；backend/deployment deferred，工作站 HOLD 不阻塞前端演示。
根目录：D:\phoenix-rc；分支：codex/phoenix-nova-rc-20260912。

## 锁定环境

本次使用 Node 24.18.0、npm 11.16.0、pnpm 11.19.0。
Website：Next 16.2.6 / React 19.2.6 + package-lock.json；Education：Next 16.3.1 / React 19.2.8 + pnpm-lock.yaml。
两个 renderer 保留各自版本，无升级/版本统一；前端不需 Python/PostgreSQL/Docker/.env。

## 准备（本机已完成）

Website 目录：`npm ci --ignore-scripts --no-audit --no-fund`。
rc/education-web 目录：`pnpm install --frozen-lockfile --ignore-scripts`。
仅在独立 RC 目录运行，不在 dirty 来源目录整理。

## 构建启动

1. website/phoenix-nova-website-v5：`npm run rc:build`。
2. rc/education-web：`pnpm build`。
3. D:\phoenix-rc：`node rc/preview.cjs --production`。
4. 打开 `http://127.0.0.1:4300/zh`。

--production 表示使用已构建的本地 Next 页面，不是生产部署。不加参数使用 dev。
启动器占用 4300/4310/4311，端口已占则拒绝启动；Ctrl+C 关闭自己启动的进程。

## 验证

- 根目录：`node --test rc/tests/domain.test.cjs`。
- Education：`pnpm test:web`、`pnpm lint`。
- Portal：`node node_modules/eslint/bin/eslint.js components/rc-experiences.tsx components/rc-frontend-link.tsx components/v5-site.tsx app/layout.tsx next.config.ts`。
- 根目录：`node rc/verify-provenance.cjs`（入选文件须已在 Git index）。
- 浏览器：`node rc/tests/browser-flow.cjs`；PLAYWRIGHT_MODULE 可指定已有模块，RC_BROWSER_CHANNEL=msedge 使用现有 Edge，RC_TEST_OUTPUT 可指定证据目录，默认 rc/.runtime/browser。无需安装/升级浏览器。

详见 ROUTE_MAP.md、PROVENANCE_MAP.md、source-provenance.json、BACKEND_INTEGRATION_CONTRACT.md。
不要运行继承仓库其他目录的迁移/部署/release 命令来启动本 RC。
