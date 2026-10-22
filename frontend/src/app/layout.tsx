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
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export const metadata: Metadata = {
  title: "ER-GreenWave",
  description:
    "Proof-of-concept dispatcher dashboard for emergency-vehicle green corridors in Kraków (simulated).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <SimulationProvider>
            <SimulationRuntime>
              <ScenarioProvider>
                <ComparisonProvider>{children}</ComparisonProvider>
              </ScenarioProvider>
            </SimulationRuntime>
          </SimulationProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
