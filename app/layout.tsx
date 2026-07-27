import type { Metadata } from "next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const ppMori = localFont({
  src: "../public/PPMori-Regular.otf",
  variable: "--font-pp-mori",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "flower guitar",
  description: "write songs with neon flowers in my music garden",
  openGraph: {
    title: "flower guitar",
    description: "write songs with neon flowers in my music garden",
    images: [
      {
        url: "/OpenGraph.png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "flower guitar",
    description: "write songs with neon flowers in my music garden",
    images: ["/OpenGraph.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ppMori.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
