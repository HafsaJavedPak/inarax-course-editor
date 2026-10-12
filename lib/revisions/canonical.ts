// RFC 8785 canonical JSON: one fixed way to write a value, so equal content
// always gives equal text (and equal hashes, lib/revisions/hash.ts). Object
// keys are sorted by UTF-16 code units, there is no whitespace, and numbers
// and strings are written the way JSON.stringify writes them. No Node APIs:
// also used in the browser.

export class CanonicalJsonError extends Error {}

/** RFC 8785 canonical JSON. Throws on values JSON can't represent (NaN, Infinity, bigint, functions, cycles). */
export function canonicalJson(value: unknown): string {
  return write(value, new Set())
}

function write(value: unknown, seen: Set<object>): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false"
    case "string":
      return JSON.stringify(value)
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`Can't hash the number ${value}`)
      return JSON.stringify(value)
    case "object":
      break
    default:
      throw new CanonicalJsonError(`Can't hash a ${typeof value}`)
  }

  const object = value as object
  if (seen.has(object)) throw new CanonicalJsonError("Can't hash a value that contains itself")
  seen.add(object)
  try {
    if (Array.isArray(object)) {
      // As in JSON.stringify, holes and undefined entries become null.
      return `[${Array.from(object, (item) => (item === undefined ? "null" : write(item, seen))).join(",")}]`
    }
    if (typeof (object as { toJSON?: unknown }).toJSON === "function") {
      return write((object as { toJSON: () => unknown }).toJSON(), seen)
    }
    const entries = Object.entries(object)
      .filter(([, v]) => v !== undefined)
      // Default sort compares UTF-16 code units, which is what RFC 8785 requires.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${write(v, seen)}`).join(",")}}`
  } finally {
    seen.delete(object)
  }
}
