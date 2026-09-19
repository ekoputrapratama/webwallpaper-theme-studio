import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebWallpaper Theme Studio",
  description: "Create HTML5/WebGL and video wallpapers for WebWallpaper",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}