import type { Metadata } from "next";
import "./globals.css";
import "../components/rc-experiences.css";

export const metadata: Metadata = {
  title: {
    default: "Phoenix Nova RC",
    template: "%s｜Phoenix Nova™",
  },
  description: "Phoenix Nova™ Global Family Growth Platform — 一个入口，走进凤启世界。",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
  other: {
    "candidate-status": "private-review",
  },
  icons: {
    icon: "/brand/phoenix-nova-mark-official.png",
    shortcut: "/brand/phoenix-nova-mark-official.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hans">
      <body className="antialiased">{children}</body>
    </html>
  );
}
