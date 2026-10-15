import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { Inter, Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";
import '@/components/workspace/shared.css';
import '@/components/workspace/workspace-pages.css';

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Revline AI video editor",
  description: "Edit your videos in conversation. Make every cut your own.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body className="antialiased" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: `try{if(['chat','chats','profile','editor','projects','billing','storage'].includes(location.pathname.split('/')[1])){var t=localStorage.getItem('revline:workspace-theme')==='dark'?'dark':'light';document.documentElement.dataset.workspaceTheme=t;document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.style.colorScheme=t}}catch(e){}` }} />
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/dashboard/chat" signUpFallbackRedirectUrl="/dashboard/chat" appearance={{ theme: shadcn }}>
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
