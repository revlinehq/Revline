import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { Geist, Inter, Outfit, Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import { DARK_PRE_PAINT_SCRIPT, SIDEBAR_PRE_PAINT_SCRIPT, SIGNED_IN_HOME_PATH } from '@/lib/workspace-routes';
import "./globals.css";
import '@/components/workspace/shared.css';
import '@/components/workspace/workspace-pages.css';

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
// The blog and use-case heading font lives here so its variable exists after any client navigation.
const outfit = Outfit({ subsets: ["latin"], variable: "--landing-font-head" });

const shareTitle = "Revline: get paid to clip";
const shareDescription = "Revline finds campaigns that pay per view, cuts the clips with AI, and posts them to your accounts.";
export const metadata: Metadata = {
  metadataBase: new URL("https://tryrevline.com"),
  title: "Revline: the AI video editor for clippers",
  description: shareDescription,
  // Version the image URL when changing the artwork so preview caches fetch the new card.
  openGraph: { type: "website", url: "/", siteName: "Revline", title: shareTitle, description: shareDescription, images: [{ url: "/og-revline-v4.png", width: 1200, height: 630, alt: "Revline: get paid to clip" }] },
  twitter: { card: "summary_large_image", title: shareTitle, description: shareDescription, images: ["/og-revline-v4.png"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={`${spaceGrotesk.variable} ${inter.variable} ${geist.variable} ${outfit.variable}`}>
      <body className="antialiased" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: DARK_PRE_PAINT_SCRIPT + ';' + SIDEBAR_PRE_PAINT_SCRIPT }} />
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl={SIGNED_IN_HOME_PATH} signUpFallbackRedirectUrl={SIGNED_IN_HOME_PATH} appearance={{ theme: shadcn, captcha: { theme: 'dark', size: 'flexible' } }}>
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
