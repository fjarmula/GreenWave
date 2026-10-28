import { cookies } from "next/headers";
import { LanguageMetadata } from "@/components/language-metadata";
import { LanguageProvider } from "@/components/language-provider";
import { LANGUAGE_COOKIE, resolveLanguage } from "@/lib/localization";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { ComparisonProvider } from "@/components/comparison/ComparisonProvider";
import { SimulationRuntime } from "@/components/simulation-runtime";
import { ScenarioProvider } from "@/components/scenario-provider";
import { SimulationProvider } from "@/components/simulation-provider";

import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f4f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f11" },
  ],
};

export const metadata: Metadata = {
  title: { default: "ER-GreenWave", template: "%s · ER-GreenWave" },
  description:
    "Symulacyjny panel dyspozytorski zielonych korytarzy dla pojazdów ratunkowych w Krakowie.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const language = resolveLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value);
  return (
    <html
      lang={language}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <LanguageProvider initialLanguage={language}>
            <LanguageMetadata />
            <SimulationProvider>
              <SimulationRuntime>
                <ScenarioProvider>
                  <ComparisonProvider>{children}</ComparisonProvider>
                </ScenarioProvider>
              </SimulationRuntime>
            </SimulationProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
