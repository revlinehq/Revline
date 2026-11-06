import { skillText, skillDocument } from '../documents';
// GSAP API reference adapted for Revline from GreenSock's agent skills, originally copied from https://github.com/greensock/gsap-skills
// at commit aed9cfd3277740755f6bfc1155c7aa645403b760 (skills/<name>/SKILL.md; frontmatter description as the page
// description, the rest as the body). To re-sync, fetch the same files at a newer commit and replace the
// strings. gsap-scrolltrigger, gsap-frameworks and gsap-react are left out. Revline's own rules are in ./index.ts.
/*
 * MIT License
 *
 * Copyright (c) 2026 GreenSock
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { EditorSkillPage } from '../types';

export const gsapTimelinePage: EditorSkillPage = {
  name: skillDocument("gsap/references/gsap-timeline.md").name,
  description: skillDocument("gsap/references/gsap-timeline.md").description,
  body: skillText("gsap/references/gsap-timeline.md"),
};

export const gsapCorePage: EditorSkillPage = {
  name: skillDocument("gsap/references/gsap-core.md").name,
  description: skillDocument("gsap/references/gsap-core.md").description,
  body: skillText("gsap/references/gsap-core.md"),
};

export const gsapPluginsPage: EditorSkillPage = {
  name: skillDocument("gsap/references/gsap-plugins.md").name,
  description: skillDocument("gsap/references/gsap-plugins.md").description,
  body: skillText("gsap/references/gsap-plugins.md"),
};

export const gsapPerformancePage: EditorSkillPage = {
  name: skillDocument("gsap/references/gsap-performance.md").name,
  description: skillDocument("gsap/references/gsap-performance.md").description,
  body: skillText("gsap/references/gsap-performance.md"),
};

export const gsapUtilsPage: EditorSkillPage = {
  name: skillDocument("gsap/references/gsap-utils.md").name,
  description: skillDocument("gsap/references/gsap-utils.md").description,
  body: skillText("gsap/references/gsap-utils.md"),
};

export const GREENSOCK_PAGES = [gsapTimelinePage, gsapCorePage, gsapPluginsPage, gsapPerformancePage, gsapUtilsPage];
