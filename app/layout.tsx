import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "./lib/i18n";
import SideDrawer from "./components/SideDrawer";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "metastats.gg - League of Legends Statistiken & Marktwerte",
  description: "Echtzeit League of Legends Statistiken, Match History, Champion-Daten und KI-gestützte Marktwertberechnung für alle Spieler.",
  openGraph: {
    title: "metastats.gg - League of Legends Statistiken & Marktwerte",
    description: "Echtzeit League of Legends Statistiken, Match History, Champion-Daten und KI-gestützte Marktwertberechnung für alle Spieler.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider>
          <SideDrawer />
          {children}
          <Analytics />
        </I18nProvider>
      </body>
    </html>
  );
}
