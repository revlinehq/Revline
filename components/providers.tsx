"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceThemeProvider } from '@/components/workspace/theme-provider';
import { UserSync } from '@/components/user-sync';

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is required. Configure a Convex development deployment.");
}
const convex = new ConvexReactClient(convexUrl);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <UserSync />
      <WorkspaceThemeProvider><TooltipProvider>{children}</TooltipProvider></WorkspaceThemeProvider>
    </ConvexProviderWithClerk>
  );
}
