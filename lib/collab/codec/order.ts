// Order keys for things that can be reordered in the live document (sections,
// blocks, list items). Items live in maps under their permanent id and carry a
// fractional key; moving an item changes only its key, so nobody's concurrent
// edits inside it are lost (in Yjs, moving an array element means deleting it).
//
// Keys are strings compared by code unit, never with localeCompare. Two people
// inserting at the same spot at the same moment can produce the same key; ties
// are broken by id, so every copy of the document sorts identically.

import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing"

/** `count` ascending keys, for laying out a list for the first time. */
export const initialKeys = (count: number): string[] => generateNKeysBetween(null, null, count)

/** A key that sorts between `before` and `after` (null = the start / the end). */
export const keyBetween = (before: string | null, after: string | null): string => generateKeyBetween(before, after)

export type Ordered = { id: string; order: string }

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Sorts by order key, then by id. */
export function sortByOrder<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compare(a.order, b.order) || compare(a.id, b.id))
}
