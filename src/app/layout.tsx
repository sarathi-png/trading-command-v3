import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import AppShell from "@/components/AppShell";
import "./globals.css";


export const metadata: Metadata = {
  title: "Trading Command — Personal Trading Intelligence",
  description:
    "A private trading workspace: market data, charting, strategy analysis, risk, journal and paper execution in one terminal.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
