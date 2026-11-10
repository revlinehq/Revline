export const NEW_PROJECT_PATH = '/dashboard/new-project';

// Sign-in and sign-up keep their own light design; every other page, the landing page included, is dark.
const LIGHT_ROUTE_PREFIXES = ['/sign-in', '/sign-up'];

export function isDarkRoute(pathname: string) {
  return !LIGHT_ROUTE_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

/** Runs before first paint with the same rule as isDarkRoute, so dark pages never flash light. */
export const DARK_ROUTE_PRE_PAINT_SCRIPT = `try{var p=location.pathname;if(!${JSON.stringify(LIGHT_ROUTE_PREFIXES)}.some(function(x){return p.indexOf(x)===0})){document.documentElement.dataset.workspaceTheme='dark';document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}}catch(e){}`;
