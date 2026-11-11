import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Recall — Research, with a memory",
  description:
    "A thoughtful research workspace that connects what you knew then with what is true now.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
