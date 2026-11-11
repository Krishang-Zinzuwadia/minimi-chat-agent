import type { Metadata } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import { ThemeProvider, type Theme } from "../components/theme-provider";
import "./globals.css";
export const dynamic = "force-dynamic";
const plex = localFont({
  src: [
    {
      path: "./fonts/ibm-plex-sans-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-plex",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});
export const metadata: Metadata = {
  title: "Recall — Research, with a memory",
  description:
    "Research with sources and dated context from your conversations.",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = (await cookies()).get("recall-theme")?.value;
  const theme: Theme = value === "light" || value === "dark" ? value : "system";
  return (
    <html lang="en" data-theme={theme} className={plex.variable}>
      <body>
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
