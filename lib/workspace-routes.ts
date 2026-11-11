export const NEW_PROJECT_PATH = '/dashboard/new-project';
/** Where a person lands after signing in or signing up, unless they were sent to sign in from a specific page. */
export const SIGNED_IN_HOME_PATH = '/campaigns';

/** Every page is dark. Runs before first paint so none flashes light. */
export const DARK_PRE_PAINT_SCRIPT = `try{document.documentElement.dataset.workspaceTheme='dark';document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}catch(e){}`;
