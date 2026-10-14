import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "./lib/i18n";
import { AuthProvider } from "./lib/auth-context";
import { getServerLang } from "./lib/server-lang";
import { siteText } from "./lib/seo/copy";
import { SITE_URL } from "./lib/site";
import SideDrawer from "./components/SideDrawer";
import PrototypeBanner from "./components/PrototypeBanner";
import GameStrip from "./components/GameStrip";
import CookieBanner from "./components/CookieBanner";
import { Analytics } from "@vercel/analytics/next";
import { STATS_PENDING_SCRIPT } from "./lib/seo/stats-pending";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});


export async function generateMetadata(): Promise<Metadata> {
  const lang = await getServerLang();
  const { title, description } = siteText(lang);
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "metastats.gg",
      locale: lang,
      type: "website",
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: "metastats.gg",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialLang = await getServerLang();
  return (
    // suppressHydrationWarning: das Skript unten setzt vor der Hydration
    // Merkmale an <html> (data-tft-pending / data-tft-ub), die React nicht
    // kennt. Gilt nur fuer die Attribute dieses einen Elements.
    <html
      lang={initialLang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Verbindung zu ddragon vorwaermen: Kopfzonen-Splashes stehen auf der
            Startseite UND auf allen TFT-Routen, und ddragon spricht HTTP/1.1 --
            Verbindungsaufbau plus TLS kosten dort messbar Zeit.
            Der frueher hier stehende Preload auf Kaisa_0.jpg galt auf JEDER
            Route, obwohl nur die Startseite das Bild zeigt; er liegt jetzt in
            app/page.tsx. */}
        <link rel="preconnect" href="https://ddragon.leagueoflegends.com" />
        {/* Gespeicherte Filter auf den TFT-Statistik-Listen: entscheidet vor dem
            ersten Zeichnen, ob die Server-Zahlen (Standardansicht) ausgeblendet
            werden muessen. Steht hier, weil es nur beim ersten Dokument laufen
            soll — siehe app/lib/seo/stats-pending.ts. */}
        <script dangerouslySetInnerHTML={{ __html: STATS_PENDING_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* JSON-LD: WebSite + SearchAction for sitelinks-style results */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            url: SITE_URL,
            name: 'metastats.gg',
            description: 'League of Legends & Teamfight Tactics meta analytics, market values, pro player tracking and patch-driven data depth.',
            inLanguage: ['de', 'en', 'ko', 'zh-CN', 'es', 'fr'],
            potentialAction: {
              '@type': 'SearchAction',
              target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/multi-search?q={search_term_string}` },
              'query-input': 'required name=search_term_string',
            },
            publisher: {
              '@type': 'Organization',
              name: 'metastats.gg',
              url: SITE_URL,
            },
          }) }}
        />
        <I18nProvider initialLang={initialLang}>
          <AuthProvider>
            <PrototypeBanner />
            <GameStrip />
            <SideDrawer />
            {children}
            <CookieBanner />
            <Analytics />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
