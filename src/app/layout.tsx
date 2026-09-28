import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const grotesk = Inter({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "BAS Lab", template: "%s · BAS Lab" },
  description: "Small interactive building-automation modules: real HVAC equipment, BAS-style controls, one idea each.",
};

export const viewport: Viewport = {
  themeColor: "#0d0d0e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark is the house theme. The light tokens still exist behind data-theme="light".
    <html lang="en" data-theme="dark" className={`${grotesk.variable} ${mono.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
