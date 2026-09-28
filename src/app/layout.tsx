import type { Metadata, Viewport } from "next";
import { Fragment_Mono, IBM_Plex_Mono, Inter } from "next/font/google";
import { SiteBar } from "./SiteBar";
import "./globals.css";

const grotesk = Inter({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });
// robboborben.xyz's mono, for its site bar only (not preloaded: plain builds never show the bar)
const siteMono = Fragment_Mono({ subsets: ["latin"], weight: "400", variable: "--font-fragment-mono", display: "swap", preload: false });

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
    <html lang="en" data-theme="dark" className={`${grotesk.variable} ${mono.variable} ${siteMono.variable}`}>
      <body className="min-h-dvh">
        <SiteBar />
        {children}
      </body>
    </html>
  );
}
