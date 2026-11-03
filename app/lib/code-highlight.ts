import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { createLowlight } from "lowlight";

/**
 * Syntax highlighting for the Document's code blocks, shared by the editor
 * (through lowlight, which wraps the same grammars) and the rendered page.
 * The writer never picks a language: it is detected from the code, among a
 * short list so a few lines are not mistaken for a language nobody uses here.
 * PL/SQL is highlighted with the SQL grammar.
 */
const GRAMMARS = { sql, typescript, javascript, java, json, xml, css, bash, python };
for (const [name, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(name, grammar);

export const lowlight = createLowlight(GRAMMARS);
const NAMES = Object.keys(GRAMMARS);

/** What a writer might have typed after the fence, mapped to a grammar. */
const ALIASES: Record<string, string> = { plsql: "sql", oracle: "sql", ts: "typescript", js: "javascript", html: "xml", sh: "bash", shell: "bash", py: "python" };

const isJson = (code: string) => {
  if (!/^\s*[[{]/.test(code)) return false;
  try { JSON.parse(code); return true; } catch { return false; }
};

/**
 * Signs that settle a language on their own, tried in order. highlight.js
 * guesses poorly on a few lines (a one-line `select` reads as shell to it), and
 * this app's code is mostly Oracle, so the clear cases are decided here.
 */
const RULES: [string, (code: string) => boolean][] = [
  ["json", isJson],
  ["xml", (code) => /^\s*</.test(code) && /<\/\w|\/>/.test(code)],
  ["sql", (code) =>
    /^\s*(select\b[\s\S]*\bfrom\b|insert\s+into\b|update\s+\w+\s+set\b|delete\s+from\b|merge\s+into\b|with\s+\w+\s+as\s*\(|create\s+(or\s+replace\s+)?(table|view|index|unique\s+index|sequence|package|procedure|function|trigger|type|synonym)\b|alter\s+(table|index|sequence)\b|drop\s+(table|view|index|sequence|package|procedure|function|trigger)\b|comment\s+on\b|grant\b|truncate\s+table\b|declare\b|begin\b)/im.test(code)
    || /\bvarchar2\b|\bnumber\s*\(|\bend\s+\w*\s*;|\bdbms_\w+|:=/i.test(code) && !/[{}]/.test(code)],
  ["java", (code) => /\b(public|private|protected)\s+(static\s+|final\s+)*(class|interface|enum|void|[A-Z]\w*(<[^>]*>)?)\s+\w+|System\.out\.|@Override\b/.test(code)],
  ["python", (code) => /^\s*(def|class)\s+\w+[^\n{;]*:\s*$|^\s*(from\s+\w+(\.\w+)*\s+)?import\s+\w+[^\n;]*$|^\s*if\s+__name__\s*==/m.test(code) && !/[{};]\s*$/m.test(code)],
  ["bash", (code) => /^\s*(\$\s+)?(pnpm|npm|npx|yarn|node|git|cd|ls|mkdir|rm|cp|mv|curl|wget|sudo|docker|apt|brew|echo|export)\b/m.test(code) && !/[{}]|=>/.test(code)],
  ["typescript", (code) => /\b(interface|type)\s+\w+(<[^>]*>)?\s*[={]|\bimport\s+type\b|\w\)?\s*:\s*(string|number|boolean|void|unknown|any|\w+\[\])\b|\bas\s+const\b|<\w+>\(/.test(code)],
  ["javascript", (code) => /\b(function\s*\w*\s*\(|const\s+\w+\s*=|let\s+\w+|var\s+\w+|=>|console\.\w+\(|document\.|require\()/.test(code)],
  ["css", (code) => /^[^{}\n]+\{[^{}]*\b[\w-]+\s*:[^{}]+\}/m.test(code)],
];

/** The language the code reads as, or `""` for no code or plain text. */
export function detectLanguage(code: string): string {
  if (!code.trim()) return "";
  const rule = RULES.find(([, test]) => test(code));
  if (rule) return rule[0];
  const { language, relevance } = hljs.highlightAuto(code, NAMES);
  return language && relevance >= 5 ? language : "";
}

const known = (name: string) => {
  const grammar = ALIASES[name] ?? name;
  return NAMES.includes(grammar) ? grammar : "";
};

/** The code as highlighted HTML, and the language it was read as. `hint` (a fence's language) counts only when nothing is detected. */
export function highlightCode(code: string, hint = ""): { html: string; language: string } {
  const language = detectLanguage(code) || known(hint.toLowerCase());
  if (!language) return { html: escapeHtml(code), language: "" };
  return { html: hljs.highlight(code, { language, ignoreIllegals: true }).value, language };
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The name shown on a block. */
export const LANGUAGE_LABELS: Record<string, string> = {
  sql: "SQL", typescript: "TypeScript", javascript: "JavaScript", java: "Java", json: "JSON", xml: "HTML/XML", css: "CSS", bash: "Shell", python: "Python",
};
