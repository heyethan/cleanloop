import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
// MapLibre ships its own CSS; without it the canvas and controls render broken.
import "maplibre-gl/dist/maplibre-gl.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Report a garbage dump in Bengaluru. A cleanup only counts when an after photo, taken at the spot, proves it.";

// Icons, og:image and twitter:image are file conventions in this folder (icon.svg, apple-icon.png,
// opengraph-image.png, ...); Next adds their tags. metadataBase makes those URLs absolute for crawlers.
export const metadata: Metadata = {
  metadataBase: new URL("https://getcleanloop.vercel.app"),
  title: { default: "CleanLoop: proof the dump was actually cleared", template: "%s · CleanLoop" },
  description: DESCRIPTION,
  applicationName: "CleanLoop",
  openGraph: {
    type: "website",
    siteName: "CleanLoop",
    title: "CleanLoop: proof the dump was actually cleared",
    description: DESCRIPTION,
    locale: "en_IN",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "CleanLoop: proof the dump was actually cleared",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = { themeColor: "#070a0f", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ colorScheme: "dark" }}
    >
      <body className="min-h-full flex flex-col bg-[#070a0f]">{children}</body>
    </html>
  );
}
