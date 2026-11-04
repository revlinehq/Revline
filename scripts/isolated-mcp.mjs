import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { assertIsolated, isolatedRuntime } from './isolated-common.mjs';

// A worktree-scoped revline-local transport. The global connector remains on main.
const state = assertIsolated();
const settings = await isolatedRuntime();
const client = new Client({ name: 'revline-local', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`https://${state.name}.convex.site/mcp`), { requestInit: { headers: { Authorization: `Bearer ${settings.REVLINE_MCP_TOKEN}` } } }));
const server = new Server({ name: 'revline-local', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
server.setRequestHandler(CallToolRequestSchema, request => client.callTool(request.params, undefined, { timeout: 600_000 }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void client.close(); void server.close(); });
await server.connect(new StdioServerTransport());
