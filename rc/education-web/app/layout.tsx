import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Phoenix Compass™｜30秒成长探索",
    template: "%s｜Phoenix Compass™",
  },
  robots: { index: false, follow: false },
  description: "用30秒回答7个问题，获得一份不贴标签、能指向下一步的 AI Growth Snapshot。",
  icons: {
    icon: "/education/assets/brand/phoenix-nova-icon-primary.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <nav className="rc-return" aria-label="RC navigation"><a href="/zh">← Phoenix Nova 门户</a><span>RC 演示 · 本标签页 · 规则结果</span><a href="/zh/family-center">家庭中心 →</a></nav>
        {children}
      </body>
    </html>
  );
}
