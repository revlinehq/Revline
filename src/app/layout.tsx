import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Frame — Motion Studio",
  description: "Turn your product story into motion. Chat, compose, preview, and export polished demo videos.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
