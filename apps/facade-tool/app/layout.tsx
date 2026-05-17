import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Maalausliike — Mittaa & hae tarjous",
  description:
    "Mittaa julkisivun pinta-ala kameralla ja hae tarjous muutamassa minuutissa.",
};

/**
 * Mobile-first viewport: no pinch-zoom on the chrome, no horizontal
 * overflow, and dynamic viewport height so the layout matches the
 * actual visible area on iOS Safari / Chrome Android (where the
 * URL bar shows/hides).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fi" className={`${geist.variable} antialiased`}>
      <body className="bg-slate-100 text-slate-900 overflow-hidden">
        {/* Mobile-sized frame, centred on desktop. Inside this frame the
            page controls its own scroll behaviour per step. */}
        <div className="app-frame">{children}</div>
      </body>
    </html>
  );
}
