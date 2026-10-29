import { ClaudeLogo, McpLogo, OpenAILogo } from './ai-app-logos';

// Claude and ChatGPT only add custom MCP servers from their own settings, so each needs the link pasted once;
// sign-in then runs through Revline's OAuth consent page automatically. Any other MCP client takes the same link.
export type McpAppId = 'claude' | 'chatgpt' | 'agent';
export type McpApp = { name: string; owner: string; Logo: typeof ClaudeLogo; match?: RegExp; settingsUrl?: string; settingsLabel?: string; steps: string };
export const MCP_APPS: Record<McpAppId, McpApp> = {
  claude: { name: 'Claude', owner: 'Claude', Logo: ClaudeLogo, match: /claude/i, settingsUrl: 'https://claude.ai/settings/connectors', settingsLabel: 'Open Claude connectors',
    steps: 'Choose Add custom connector, paste the link, then sign in to Revline when asked.' },
  chatgpt: { name: 'ChatGPT', owner: 'ChatGPT', Logo: OpenAILogo, match: /chatgpt|openai/i, settingsUrl: 'https://chatgpt.com/#settings/Connectors', settingsLabel: 'Open ChatGPT settings',
    steps: 'Turn on Developer mode under Advanced, choose Create, paste the link and pick OAuth. Then sign in to Revline when asked. Needs a ChatGPT plan with Developer mode.' },
  agent: { name: 'any agent', owner: 'your agent', Logo: McpLogo,
    steps: 'Open your agent\'s MCP or connector settings, add a remote (HTTP) MCP server and paste the link. Then sign in to Revline when asked.' },
};

export const claudeCodeCommand = (mcpUrl: string) => `claude mcp add --transport http revline ${mcpUrl}`;

/** Revline's public MCP endpoint (MCP_PUBLIC_ORIGIN on production), for pages shown before sign-in. */
export const PUBLIC_MCP_URL = 'https://tryrevline.com/mcp';
