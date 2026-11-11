'use client';

import { createContext, useContext } from 'react';

// Lives in its own module so the shell (loaded by the server layout) and the pages share one context instance.
export const DashboardShellContext = createContext(false);

/** True under the signed-in shell; pages use it to swap their own top bar for the shell's navbar. */
export const useInDashboardShell = () => useContext(DashboardShellContext);
