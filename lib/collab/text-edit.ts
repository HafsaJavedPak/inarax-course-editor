// The single change between two versions of a text, and where a caret ends up
// after it. Shared by live editing (reconcile.ts) and the editor's text fields,
// so a caret stays in place when someone else's edit lands before it.

export type TextEdit = { start: number; remove: number; insert: string }

/** The single change that turns `a` into `b` (common start and end trimmed), or null if equal. */
export function minimalEdit(a: string, b: string): TextEdit | null {
  if (a === b) return null
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  return { start, remove: a.length - start - end, insert: b.slice(start, b.length - end) }
}

/** Where position `at` (in the old text) is after `edit`. */
export function shiftPosition(at: number, edit: TextEdit): number {
  if (at <= edit.start) return at
  if (at >= edit.start + edit.remove) return at + edit.insert.length - edit.remove
  return edit.start + edit.insert.length
}
