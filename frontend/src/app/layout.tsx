import type { Metadata } from "next";
import { Courier_Prime, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Courier Prime is the default (Bauhaus) theme's face, so it stays preloaded.
const courierPrime = Courier_Prime({
  variable: "--font-courier-prime",
  weight: ["400", "700"],
  subsets: ["latin"],
});

// JetBrains Mono belongs to the terminal theme only, and the theme is a client
// preference the server cannot know — so preloading it meant every visitor on
// the default theme fetched and preloaded a face they would never render
// (finding F5). `preload: false` keeps it fully available: the CSS variable is
// still declared and the browser fetches the file the moment a terminal-theme
// rule actually uses it. The cost lands on the people who chose that theme.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Scatter Lab",
  description:
    "See the shape of your data — plot any variables in 2D or 3D, project through PCA components, cluster, compare, and export.",
};

import { ThemeProvider } from "@/components/theme-provider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${courierPrime.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="data-theme" defaultTheme="primary" themes={["primary", "terminal"]}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
