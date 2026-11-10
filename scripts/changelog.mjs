// Changelog fragments: every pull request adds its own file under docs/changelog.d/, so two pull requests never
// edit the same lines of docs/changelog.md (GitHub does not honour `merge=union` when it decides mergeability).
//   node scripts/changelog.mjs check   validates the fragment names and entries (CI)
//   node scripts/changelog.mjs build   moves every fragment into docs/changelog.md under its date, newest first,
//                                      and removes the fragment files (release:prod runs and commits this)
// A fragment is docs/changelog.d/<YYYY-MM-DD>-<slug>.md holding one or more entries:
//   - <System>: <what changed>. Why: <reason>.
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const DIRECTORY = 'docs/changelog.d', CHANGELOG = 'docs/changelog.md';
const NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]*\.md$/;

async function fragments() {
  const names = (await readdir(DIRECTORY).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(name => name !== 'README.md').sort();
  const found = [], problems = [];
  for (const name of names) {
    const date = NAME.exec(name)?.[1];
    if (!date || Number.isNaN(Date.parse(date))) { problems.push(`${DIRECTORY}/${name}: name it <YYYY-MM-DD>-<slug>.md (lowercase letters, digits and dashes).`); continue; }
    const entries = (await readFile(join(DIRECTORY, name), 'utf8')).split('\n').map(line => line.trimEnd()).filter(Boolean);
    if (!entries.length) problems.push(`${DIRECTORY}/${name}: empty; add "- <System>: <what changed>. Why: <reason>."`);
    for (const entry of entries) if (!/^- \S.*: .+/.test(entry)) problems.push(`${DIRECTORY}/${name}: every line is one entry, "- <System>: <what changed>. Why: <reason>." Got: ${entry.slice(0, 80)}`);
    found.push({ name, date, entries });
  }
  return { found, problems };
}

/** Puts the entries under their `## date` heading, creating it in newest-first order; new entries go first under a date. */
export function assemble(changelog, found) {
  const lines = changelog.split('\n');
  const dates = [...new Set(found.map(fragment => fragment.date))].sort().reverse();
  for (const date of dates) {
    const entries = found.filter(fragment => fragment.date === date).flatMap(fragment => fragment.entries);
    const heading = lines.indexOf(`## ${date}`);
    if (heading >= 0) { lines.splice(heading + 1, 0, ...entries); continue; }
    // Before the first older date; after everything when none is older.
    let at = lines.findIndex(line => /^## \d{4}-\d{2}-\d{2}$/.test(line) && line.slice(3) < date);
    if (at < 0) { while (lines.length && !lines.at(-1)) lines.pop(); lines.push(''); at = lines.length; }
    lines.splice(at, 0, `## ${date}`, ...entries, '');
  }
  return lines.join('\n').replace(/\n*$/, '\n');
}

const operation = process.argv[2];
if (operation !== 'check' && operation !== 'build') { console.error('Usage: node scripts/changelog.mjs check|build'); process.exit(2); }
const { found, problems } = await fragments();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
if (operation === 'check') console.log(`Changelog fragments: ${found.length} valid.`);
else if (!found.length) console.log('Changelog: no fragments to assemble; nothing to commit.');
else {
  await writeFile(CHANGELOG, assemble(await readFile(CHANGELOG, 'utf8'), found));
  for (const fragment of found) await rm(join(DIRECTORY, fragment.name));
  console.log(`Changelog: moved ${found.reduce((sum, fragment) => sum + fragment.entries.length, 0)} entries from ${found.length} fragments into ${CHANGELOG}.`);
}
