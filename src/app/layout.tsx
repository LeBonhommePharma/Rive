import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const outfit = localFont({
  src: [
    { path: "../../public/Transit/fonts/Outfit-Regular.ttf", weight: "400" },
    { path: "../../public/Transit/fonts/Outfit-Bold.ttf", weight: "700" },
  ],
  variable: "--font-outfit",
  display: "swap",
});
const plex = localFont({
  src: "../../public/Transit/fonts/IBMPlexMono-Regular.ttf",
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rive, atlas RTC, STLévis, STM et STL",
  description:
    "Carte, trajectoires et horaires officiels à Québec, Lévis, Montréal et Laval. Gratuit, sans abonnement.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="fr"
      className={`${outfit.variable} ${outfit.className} ${plex.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-paper font-sans text-ink">{children}</body>
    </html>
  );
}
