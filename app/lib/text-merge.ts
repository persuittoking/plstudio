/**
 * Text edits as one splice each, for the written document (`Schema.documentation`),
 * which collaborators edit as text rather than as records. Pure.
 */

/** Replace `remove` characters at `at` with `insert`. */
export type Splice = { at: number; remove: number; insert: string };

/** The one splice that turns `before` into `after`: everything between their common prefix and suffix. */
export function spliceOf(before: string, after: string): Splice {
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) start++;
  let end = 0;
  while (end < limit - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { at: start, remove: before.length - start - end, insert: after.slice(start, after.length - end) };
}

export const applySplice = (text: string, { at, remove, insert }: Splice) => text.slice(0, at) + insert + text.slice(at + remove);

/**
 * Three-way merge of two edits made from the same `base`: `mine` (typed here,
 * not yet sent) and `theirs` (what the document holds now). Edits to separate
 * stretches both land; when they touch the same stretch `mine` wins there and
 * `conflict` says so, so the caller can tell the person rather than lose a
 * collaborator's words in silence.
 */
export function rebaseText(base: string, mine: string, theirs: string): { text: string; conflict: boolean } {
  if (mine === base || mine === theirs) return { text: theirs, conflict: false };
  if (theirs === base) return { text: mine, conflict: false };
  const local = spliceOf(base, mine);
  const remote = spliceOf(base, theirs);
  // Mine wholly before theirs (two inserts at one point put mine first), or wholly after it, shifted by what theirs changed in length.
  if (local.at + local.remove <= remote.at) return { text: applySplice(theirs, local), conflict: false };
  if (remote.at + remote.remove <= local.at) return { text: applySplice(theirs, { ...local, at: local.at + remote.insert.length - remote.remove }), conflict: false };
  return { text: mine, conflict: true };
}
