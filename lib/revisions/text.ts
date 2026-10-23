// Text helpers for showing changes, safe to use in the browser (no Node APIs):
// the history page renders word-level differences with them.

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  summary: "summary",
  learning_objectives: "learning objectives",
  audience: "audience",
  cover_image_url: "cover image",
  length_hours: "length",
  lesson_size: "lesson size",
  pricing: "pricing",
  limits: "limits",
  metadata: "learner choices",
  placement_size: "placement questions per level",
}
export const fieldLabel = (key: string) => FIELD_LABELS[key] ?? key.replaceAll("_", " ")

export type WordPart = { op: "same" | "add" | "del"; text: string }

/** Above this many token pairs the comparison falls back to "all replaced" (keeps time and memory bounded). */
const MAX_WORD_CELLS = 4_000_000

/** Word-level difference between two texts (whitespace is kept with the words). */
export function wordDiff(before: string, after: string): WordPart[] {
  const a = before.split(/(\s+)/).filter(Boolean)
  const b = after.split(/(\s+)/).filter(Boolean)
  // Trim the common start and end, which is most of the text for small edits.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const midA = a.slice(start, a.length - end)
  const midB = b.slice(start, b.length - end)

  const parts: WordPart[] = []
  const push = (op: WordPart["op"], text: string) => {
    if (!text) return
    const last = parts.at(-1)
    if (last?.op === op) last.text += text
    else parts.push({ op, text })
  }
  push("same", a.slice(0, start).join(""))
  if (midA.length * midB.length > MAX_WORD_CELLS) {
    push("del", midA.join(""))
    push("add", midB.join(""))
  } else {
    const common = new Set<number>()
    const keepB = new Set<number>()
    // LCS on the middle part, by index.
    const dp = Array.from({ length: midA.length + 1 }, () => new Int32Array(midB.length + 1))
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
    for (let i = 0, j = 0; i < midA.length && j < midB.length; ) {
      if (midA[i] === midB[j]) {
        common.add(i)
        keepB.add(j)
        i++
        j++
      }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++
      else j++
    }
    let i = 0
    let j = 0
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && !common.has(i)) push("del", midA[i++])
      else if (j < midB.length && !keepB.has(j)) push("add", midB[j++])
      else {
        push("same", midA[i])
        i++
        j++
      }
    }
  }
  push("same", a.slice(a.length - end).join(""))
  return parts
}
