import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { Geist, Geist_Mono, Inter, Outfit, Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import "./globals.css";
import '@/components/workspace/shared.css';
import '@/components/workspace/workspace-pages.css';

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
// Landing fonts live here so their variables exist after any client navigation (sign-out lands on /).
const outfit = Outfit({ subsets: ["latin"], variable: "--landing-font-head" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--landing-font-mono" });

const shareTitle = "Revline: the AI video editor that actually does the editing";
const shareDescription = "From podcasts and YouTube videos to product demos, ads, and social clips. Revline cuts, captions, reframes, and polishes every video for you.";
export const metadata: Metadata = {
  metadataBase: new URL("https://tryrevline.com"),
  title: "Revline AI video editor",
  description: "Edit your videos in conversation. Make every cut your own.",
  // Version the image URL when changing the artwork so preview caches fetch the new card.
  openGraph: { type: "website", url: "/", siteName: "Revline", title: shareTitle, description: shareDescription, images: [{ url: "/og-revline-v2.png", width: 1200, height: 630, alt: "Revline AI video editor" }] },
  twitter: { card: "summary_large_image", title: shareTitle, description: shareDescription, images: ["/og-revline-v2.png"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={`${spaceGrotesk.variable} ${inter.variable} ${geist.variable} ${outfit.variable} ${geistMono.variable}`}>
      <body className="antialiased" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: `try{if(['dashboard','chat','chats','profile','editor','projects','billing','storage','prototype'].includes(location.pathname.split('/')[1])){document.documentElement.dataset.workspaceTheme='dark';document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}}catch(e){}` }} />
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl={NEW_PROJECT_PATH} signUpFallbackRedirectUrl={NEW_PROJECT_PATH} appearance={{ theme: shadcn }}>
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
