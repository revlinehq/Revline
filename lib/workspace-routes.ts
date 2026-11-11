export const NEW_PROJECT_PATH = '/dashboard/new-project';
/** Where a person lands after signing in or signing up, unless they were sent to sign in from a specific page. */
export const SIGNED_IN_HOME_PATH = '/campaigns';

/** Every page is dark. Runs before first paint so none flashes light. */
export const DARK_PRE_PAINT_SCRIPT = `try{document.documentElement.dataset.workspaceTheme='dark';document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}catch(e){}`;

/** The sidebar remembers collapsed or expanded in this cookie ("true" or "false"). */
export const SIDEBAR_COOKIE_NAME = 'sidebar_state';
/** True when the sidebar's cookie says collapsed. */
export const sidebarCookieCollapsed = (cookies: string) => new RegExp(`(?:^|; )${SIDEBAR_COOKIE_NAME}=false`).test(cookies);
/** Runs before first paint, so a collapsed sidebar is drawn collapsed (dashboard.css) without the server reading the cookie, which would make every signed-in page render per request. */
export const SIDEBAR_PRE_PAINT_SCRIPT = `try{if(/(?:^|; )${SIDEBAR_COOKIE_NAME}=false/.test(document.cookie))document.documentElement.dataset.sidebarCollapsed=''}catch(e){}`;
