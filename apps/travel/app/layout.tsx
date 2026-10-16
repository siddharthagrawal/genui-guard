import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "genui-guard · travel demo",
  description: "A fictional travel search where an agent composes the results page.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
