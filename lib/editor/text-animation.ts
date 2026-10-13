export type TextAnimationVars = Record<string, string | number | boolean>;
export type TextAnimationStep = { method: 'set' | 'to' | 'fromTo'; selector: string; at: number; vars: TextAnimationVars; from?: TextAnimationVars };

export function serializeTextAnimation(step: TextAnimationStep, variable = 'timeline'): string {
  return `${variable}.${step.method}('${step.selector}',${step.from ? `${JSON.stringify(step.from)},` : ''}${JSON.stringify(step.vars)},${step.at});`;
}
