import { parse, type AnyNode, type Node } from 'acorn';
import globals from 'globals';
import { transform } from 'sucrase';
import { isReactScene, REACT_SCENE_MODULES, SCENE_MODULES, sceneTransformOptions, splitExportDeclarations } from './scene-modules';

/** Catch syntax and import mistakes before a scene is saved; build and render errors surface in the preview. */
export function checkSceneCode(code: string) {
  let compiled: string;
  const react = isReactScene(code);
  try {
    compiled = transform(splitExportDeclarations(code), sceneTransformOptions(code)).code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Scene code does not compile: ${message}${near(code, message)}${!react && /<[A-Za-z]/.test(code) ? ' GSAP scenes are plain TypeScript, not JSX: build HTML with innerHTML or document.createElement, or import from "revline" to write a React scene.' : ''}`);
  }
  for (const match of compiled.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!SCENE_MODULES.has(match[1]) && !(react && (REACT_SCENE_MODULES.has(match[1]) || match[1].startsWith('blueprint:')))) throw new Error(react ? `React scenes can import only revline, react, gsap and blueprint:<name>, not "${match[1]}".` : `Scenes can import only gsap and its plugins, not "${match[1]}".`);
  }
  if (!/exports\.default\s*=|exports,\s*["']default["']/.test(compiled)) throw new Error(react ? 'A React scene must export default its component.' : 'A scene must export default a function that builds it.');
  if (react) {
    const missing = undefinedComponents(code);
    if (missing.length) throw new Error(`${missing.map(name => `<${name}>`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} used but never defined or imported in this scene, so the preview would crash. Define ${missing.length === 1 ? 'it' : 'them'} in the same call, or remove the tag.`);
  }
  const unknown = undefinedNames(compiled);
  if (unknown.length) throw new Error(`${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} used but never defined or imported in this scene, so the preview would crash with "${unknown[0]} is not defined". Define ${unknown.length === 1 ? 'it' : 'them'} in the same call, or stop using ${unknown.length === 1 ? 'it' : 'them'}.`);
}

// What a scene module can reach without declaring it: the runtime's own arguments, the language and the browser.
const SCENE_GLOBALS = new Set(['require', 'module', 'exports', 'arguments', ...Object.keys(globals.builtin), ...Object.keys(globals.browser)]);

/** Every name the compiled module reads but never declares anywhere and the browser does not provide: a ReferenceError once that code runs.
 *  Declarations are gathered for the whole module, not per scope, so this can miss a name used outside its scope but never flags a defined one. */
function undefinedNames(compiled: string) {
  let program: Node;
  try { program = parse(compiled, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); } catch { return []; }
  const declared = new Set<string>(), used = new Set<string>();
  const bind = (pattern: AnyNode | null | undefined) => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') declared.add(pattern.name);
    else if (pattern.type === 'ObjectPattern') for (const property of pattern.properties) bind(property.type === 'RestElement' ? property.argument : property.value);
    else if (pattern.type === 'ArrayPattern') for (const element of pattern.elements) bind(element);
    else if (pattern.type === 'RestElement') bind(pattern.argument);
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left);
  };
  const visit = (node: AnyNode, parent?: AnyNode) => {
    switch (node.type) {
      case 'VariableDeclarator': bind(node.id); break;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': if ('id' in node && node.id) declared.add(node.id.name); node.params.forEach(bind); break;
      case 'ClassDeclaration': case 'ClassExpression': if (node.id) declared.add(node.id.name); break;
      case 'CatchClause': bind(node.param); break;
      case 'Identifier':
        if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) break;
        if ((parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') && parent.key === node && !parent.computed && !(parent.type === 'Property' && parent.shorthand)) break;
        if (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') break;
        if ((parent?.type === 'LabeledStatement' || parent?.type === 'BreakStatement' || parent?.type === 'ContinueStatement') && parent.label === node) break;
        used.add(node.name);
        break;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === 'string') visit(child, node); }
      else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value, node);
    }
  };
  visit(program as AnyNode);
  return [...used].filter(name => !declared.has(name) && !SCENE_GLOBALS.has(name));
}

/** A component used only as a JSX tag (not a type argument like useState<Clip>) and never named anywhere else (declared, imported, passed in) is a ReferenceError at render. */
function undefinedComponents(code: string) {
  const tags = new Set([...code.matchAll(/(?<![A-Za-z0-9_$)\]])<\/?([A-Z][A-Za-z0-9_$]*)/g)].map(match => match[1]));
  return [...tags].filter(name => ![...code.matchAll(new RegExp(`(?<![A-Za-z0-9_$.])${name.replace(/\$/g, '\\$')}(?![A-Za-z0-9_$])`, 'g'))].some(match => !/<\/?\s*$/.test(code.slice(Math.max(0, match.index! - 2), match.index))));
}

/** Scenes are often written as a few very long lines, so a line and column alone do not find the mistake: quote the code around it. */
function near(code: string, message: string) {
  const at = message.match(/\((\d+):(\d+)\)/);
  if (!at) return '';
  const line = code.split('\n')[Number(at[1]) - 1];
  if (line === undefined) return '';
  const column = Number(at[2]), from = Math.max(0, column - 40), excerpt = line.slice(from, column + 30);
  return ` Near: ${from ? '…' : ''}${excerpt}${column + 30 < line.length ? '…' : ''} (just before or at ${line.slice(Math.max(0, column - 8), column)}⟨here⟩${line.slice(column, column + 8)}).`;
}
