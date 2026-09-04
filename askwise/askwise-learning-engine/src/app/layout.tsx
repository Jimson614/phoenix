import type { Metadata } from "next";
import "./globals.css";
import TopNav from "@/components/navigation/top-nav";

// Learning records are request-time data; never bake one student's records into a build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ASKWISE 13-Day Learning Engine",
  description: "ASKWISE Learning Engine V1.0 Web MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <TopNav />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
