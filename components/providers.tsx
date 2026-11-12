"use client";

import { api } from "@/convex/_generated/api";
import { configureIncidentClient, installUncaughtIncidentHandlers, reportClientFailure } from "@/lib/incident-client";
import { getFunctionName } from "convex/server";
import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceThemeProvider } from '@/components/workspace/theme-provider';
import { usePathname } from 'next/navigation';
import { UserSync } from '@/components/user-sync';
import { PlanLimitDialog } from '@/components/workspace/plan-limit-dialog';
import { notifyPlanLimit, planLimitOf } from '@/lib/billing/limit-events';

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is required. Configure a Convex development deployment.");
}
const convex = new ConvexReactClient(convexUrl);
const originalMutation = convex.mutation.bind(convex);
const originalAction = convex.action.bind(convex);
configureIncidentClient(incident => originalMutation(api.incidents.reportClient, incident));
convex.mutation = async (ref, ...args) => {
  try { return await originalMutation(ref, ...args); }
  catch (error) { if (planLimitOf(error)) notifyPlanLimit(error); else if (getFunctionName(ref) !== 'incidents:reportClient') reportClientFailure(error, getFunctionName(ref)); throw error; }
};
convex.action = async (ref, ...args) => {
  try { return await originalAction(ref, ...args); }
  // A plan limit (storage full, AI usage used up) is not a failure: it opens the upgrade dialog instead.
  catch (error) { if (planLimitOf(error)) notifyPlanLimit(error); else reportClientFailure(error, getFunctionName(ref)); throw error; }
};
if (typeof window !== 'undefined') installUncaughtIncidentHandlers();

export function Providers({ children }: { children: React.ReactNode }) {
  const prototype = usePathname() === '/prototype';
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {!prototype && <UserSync />}
      {!prototype && <PlanLimitDialog />}
      <WorkspaceThemeProvider><TooltipProvider>{children}</TooltipProvider></WorkspaceThemeProvider>
    </ConvexProviderWithClerk>
  );
}
