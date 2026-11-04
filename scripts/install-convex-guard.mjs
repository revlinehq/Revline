import { lstatSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './isolated-common.mjs';

const bin = join(root, 'node_modules/.bin/convex');
// Unlink first: writing through npm's symlink would replace the installed CLI itself.
try { lstatSync(bin); unlinkSync(bin); } catch (error) { if (error.code !== 'ENOENT') throw error; }
writeFileSync(bin, '#!/usr/bin/env node\nimport "../../scripts/convex-cli.mjs";\n', { mode: 0o755 });
