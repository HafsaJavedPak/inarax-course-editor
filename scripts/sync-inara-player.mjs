#!/usr/bin/env node
// Copies inara-next's learner lesson player into vendor/inara-player/, so the
// editor's preview renders lessons exactly as learners see them.
//
//   node scripts/sync-inara-player.mjs [--from <inara-next dir>] [--ref <git ref>]
//
//   --from  inara-next checkout (default: $INARA_NEXT_DIR or ../../../inara-next)
//   --ref   copy from this git ref (e.g. origin/dev) instead of the working
//           tree; the checkout's current branch and files are left alone
//
// What it does:
//   1. Starts from the player's entry files and follows every import inside
//      inara-next to collect the files it needs.
//   2. Copies them to vendor/inara-player/<same path>, rewriting `@/…` imports
//      to `@/vendor/inara-player/…` and `zod` to `zod/v3` (inara-next uses zod 3,
//      the editor zod 4, which ships the v3 API).
//   3. Builds vendor/inara-player/player.css with inara-next's own Tailwind 3
//      and theme, scoped to `.inara-player` so it can't touch the editor's UI,
//      plus the lesson styles and CSS variables from inara-next's globals.css.
//   4. Writes vendor/inara-player/SOURCE.json (commit, files, packages) and
//      warns about npm packages the editor is missing or has at another version.
//
// Never edit files under vendor/inara-player/ by hand; re-run this script.

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const ENTRY_FILES = [
  "components/ile/InteractiveLessonRunner.tsx",
  "components/ile/LessonProgressProvider.tsx",
  "lib/lesson-content/schema.ts",
  "lib/ile/session-storage.ts",
]
const OUT_DIR = path.resolve("vendor/inara-player")
const SCOPE = ".inara-player"
// Rules from inara-next's globals.css the player relies on (matched against selectors).
const GLOBAL_CSS_SELECTORS = /\.(ile-|learning-content|md-paragraph|lesson-|table-scroll|callout)/

// --- Arguments --------------------------------------------------------------
const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const from = path.resolve(arg("--from") ?? process.env.INARA_NEXT_DIR ?? "../../../inara-next")
const ref = arg("--ref")
if (!fs.existsSync(path.join(from, "components/ile"))) {
  console.error(`No inara-next checkout at ${from}. Pass --from <dir> or set INARA_NEXT_DIR.`)
  process.exit(1)
}

const git = (...a) => execFileSync("git", ["-C", from, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const commit = git("rev-parse", ref ?? "HEAD").trim()
const dirty = !ref && git("status", "--porcelain", "--", "components", "lib", "app/globals.css", "tailwind.config.ts").trim() !== ""

// Reads from the git ref when given, otherwise from the working tree.
const read = (p) => (ref ? git("show", `${ref}:${p}`) : fs.readFileSync(path.join(from, p), "utf8"))
const exists = (p) => {
  if (!ref) return fs.existsSync(path.join(from, p)) && fs.statSync(path.join(from, p)).isFile()
  try {
    git("cat-file", "-e", `${ref}:${p}`)
    return true
  } catch {
    return false
  }
}
const resolveFile = (p) => ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((e) => p + e).find(exists) ?? null

// --- 1. Collect the files -----------------------------------------------------
const IMPORT_RE = /(?:import|export)[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^import\s+["']([^"']+)["']/gm
const files = new Map() // path → source
const packages = new Set()
const queue = [...ENTRY_FILES]
while (queue.length) {
  const file = queue.shift()
  if (files.has(file)) continue
  const source = read(file)
  files.set(file, source)
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3]
    if (spec.startsWith("@/") || spec.startsWith(".")) {
      const target = spec.startsWith("@/") ? spec.slice(2) : path.posix.join(path.posix.dirname(file), spec)
      const resolved = resolveFile(target)
      if (!resolved) throw new Error(`Can't resolve ${spec} in ${file}`)
      queue.push(resolved)
    } else if (!spec.endsWith(".css")) {
      packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0])
    }
  }
}

// --- 2. Copy, rewriting imports ----------------------------------------------
fs.rmSync(OUT_DIR, { recursive: true, force: true })
const header = (file) =>
  `// Copied from inara-next ${file} @ ${commit.slice(0, 12)} by scripts/sync-inara-player.mjs.\n` +
  `// Don't edit: re-run the script to update.\n` +
  `// @ts-nocheck\n`
for (const [file, source] of files) {
  let out = source
    .replace(/(from\s*["']|import\(\s*["']|^import\s+["'])@\//gm, "$1@/vendor/inara-player/")
    .replace(/(from\s*["'])zod(["'])/g, "$1zod/v3$2")
  // Keep "use client" first: it must be the file's first statement.
  const directive = out.match(/^\s*["']use client["'];?\s*\n/)
  out = directive ? directive[0] + header(file) + out.slice(directive[0].length) : header(file) + out
  const dest = path.join(OUT_DIR, file)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, out)
}

// --- 3. CSS -------------------------------------------------------------------
const inaraRequire = createRequire(path.join(from, "package.json"))
const postcss = inaraRequire("postcss")
const globals = postcss.parse(read("app/globals.css"))
const kept = postcss.root()
const keyframesUsed = new Set()
const scopeSelector = (selector) =>
  selector
    .split(",")
    .map((s) => s.trim())
    .map((s) => (s === ":root" ? SCOPE : s.startsWith(SCOPE) ? s : `${SCOPE} ${s}`))
    .join(", ")

globals.walkRules((rule) => {
  const isRootVars = rule.selector.trim() === ":root"
  if (!isRootVars && !GLOBAL_CSS_SELECTORS.test(rule.selector)) return
  if (rule.parent?.type === "atrule" && rule.parent.name === "keyframes") return
  const copy = rule.clone({ selector: scopeSelector(rule.selector) })
  copy.walkDecls(/^animation(-name)?$/, (decl) => decl.value.split(/[\s,]+/).forEach((w) => keyframesUsed.add(w)))
  // Keep the @media / @supports wrappers, drop @layer (Tailwind re-layers on build).
  let node = copy
  for (let p = rule.parent; p && p.type === "atrule"; p = p.parent) {
    if (p.name === "layer") continue
    const wrapper = p.clone({ nodes: [] })
    wrapper.append(node)
    node = wrapper
  }
  kept.append(node)
})
globals.walkAtRules("keyframes", (at) => {
  if (keyframesUsed.has(at.params)) kept.append(at.clone())
})

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inara-player-"))
const baseConfigSource = ref ? read("tailwind.config.ts") : null
const baseConfigPath = ref ? path.join(tmp, "base.config.ts") : path.join(from, "tailwind.config.ts")
if (baseConfigSource) fs.writeFileSync(baseConfigPath, baseConfigSource)
fs.writeFileSync(
  path.join(tmp, "tailwind.config.ts"),
  `import base from ${JSON.stringify(baseConfigPath.replace(/\.ts$/, ""))}\n` +
    `export default {\n` +
    `  ...base,\n` +
    `  content: [${JSON.stringify(path.join(OUT_DIR, "**/*.{ts,tsx}"))}],\n` +
    `  important: ${JSON.stringify(SCOPE)},\n` +
    `  corePlugins: { ...(base.corePlugins ?? {}), preflight: false },\n` +
    `}\n`,
)
fs.writeFileSync(path.join(tmp, "input.css"), `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${kept.toString()}\n`)
execFileSync(
  path.join(from, "node_modules/.bin/tailwindcss"),
  ["-c", path.join(tmp, "tailwind.config.ts"), "-i", path.join(tmp, "input.css"), "-o", path.join(OUT_DIR, "player.css"), "--minify"],
  { cwd: from, stdio: ["ignore", "ignore", "inherit"] },
)
fs.rmSync(tmp, { recursive: true, force: true })

// Tailwind leaves its base rules (the *,::before,::after variable reset) and
// component classes unscoped; scope every remaining rule so nothing reaches
// the editor's own UI.
const cssFile = path.join(OUT_DIR, "player.css")
const css = postcss.parse(fs.readFileSync(cssFile, "utf8"))
css.walkRules((rule) => {
  if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return
  rule.selectors = rule.selectors.map((s) => (s.startsWith(SCOPE) ? s : `${SCOPE} ${s}`))
})
fs.writeFileSync(cssFile, css.toString())

// --- 4. Record the source and check packages ------------------------------------
const inaraPkg = JSON.parse(read("package.json"))
const editorPkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
const wanted = Object.fromEntries(
  [...packages]
    .filter((p) => !["react", "next", "zod"].includes(p))
    .sort()
    .map((p) => [p, inaraPkg.dependencies?.[p] ?? inaraPkg.devDependencies?.[p] ?? "*"]),
)
fs.writeFileSync(
  path.join(OUT_DIR, "SOURCE.json"),
  JSON.stringify(
    { from: "inara-next", ref: ref ?? "working tree", commit, uncommittedChanges: dirty, copiedAt: new Date().toISOString(), entryFiles: ENTRY_FILES, files: [...files.keys()].sort(), packages: wanted },
    null,
    2,
  ) + "\n",
)

const editorDeps = { ...editorPkg.dependencies, ...editorPkg.devDependencies }
// Same major version (minor for 0.x) counts as compatible.
const line = (range) => {
  const [major, minor] = String(range).replace(/^[^\d]*/, "").split(".")
  return major === "0" ? `0.${minor}` : major
}
const problems = Object.entries(wanted).filter(
  ([p, v]) => p !== "unist" && (!editorDeps[p] || line(editorDeps[p]) !== line(v)),
)
console.log(`Copied ${files.size} files from inara-next ${ref ?? "working tree"} @ ${commit.slice(0, 12)}${dirty ? " (with uncommitted changes)" : ""} → vendor/inara-player/`)
console.log(`Built vendor/inara-player/player.css (${(fs.statSync(path.join(OUT_DIR, "player.css")).size / 1024).toFixed(0)} KB)`)
for (const [p, v] of problems) {
  console.warn(editorDeps[p] ? `! ${p}: editor has ${editorDeps[p]}, inara-next uses ${v}` : `! ${p} is missing: npm install ${p}@${v}`)
}
