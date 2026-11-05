import { skillDocuments } from './documents.generated';

export function skillDocument(path: string) {
  const document = skillDocuments[path];
  if (!document) throw new Error(`Unknown bundled skill document: ${path}`);
  return document;
}

/** Substitute once so code examples and inserted runtime values stay literal. */
export function skillText(path: string, values: readonly (string | number)[] = []) {
  return skillDocument(path).body.replace(/\{\{revline:(\d+)\}\}/g, (_match, index: string) => {
    const value = values[Number(index)];
    if (value === undefined) throw new Error(`Missing skill expansion ${index}: ${path}`);
    return String(value);
  });
}
