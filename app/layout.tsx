import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "./lib/i18n";
import { getServerLang, getSeoCopy } from "./lib/server-lang";
import SideDrawer from "./components/SideDrawer";
import PrototypeBanner from "./components/PrototypeBanner";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://metastats.gg";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getServerLang();
  const { title, description } = getSeoCopy(lang);
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    openGraph: {
      title,
      description,
      url: SITE_URL,
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
    alternates: {
      canonical: SITE_URL,
      languages: {
        de: SITE_URL,
        en: SITE_URL,
        ko: SITE_URL,
        "zh-CN": SITE_URL,
        es: SITE_URL,
        fr: SITE_URL,
      },
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
    <html
      lang={initialLang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Preload hero splash so it paints quickly on the homepage */}
        <link
          rel="preload"
          as="image"
          href="https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Kaisa_0.jpg"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <I18nProvider initialLang={initialLang}>
          <PrototypeBanner />
          <SideDrawer />
          {children}
          <Analytics />
        </I18nProvider>
      </body>
    </html>
  );
}
