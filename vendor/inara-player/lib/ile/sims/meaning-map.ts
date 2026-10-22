// Copied from inara-next lib/ile/sims/meaning-map.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Layout and neighbour lookups for the `meaning_map` block, kept free of React so they can be
 * tested. Authors only list groups and words; the map is laid out here so that every word
 * sits nearer the rest of its group than any word of another group.
 */

export type MapGroup = { id: string; label: string };
export type MapWordInput = { id: string; label: string; group_id: string };
/** A word with its place on the map, in % of the map's width (x) and height (y). */
export type MapWord = MapWordInput & { x: number; y: number };
export type MapLabel = MapGroup & { x: number; y: number };

export const MAX_GROUPS = 4;
export const MAX_WORDS_PER_GROUP = 4;

/** Group centres: far apart, in the corners for four, a triangle for three, side by side for two. */
const CENTRES: Record<number, { x: number; y: number }[]> = {
  2: [
    { x: 24, y: 44 },
    { x: 76, y: 56 },
  ],
  3: [
    { x: 23, y: 25 },
    { x: 77, y: 28 },
    { x: 50, y: 78 },
  ],
  4: [
    { x: 24, y: 25 },
    { x: 76, y: 27 },
    { x: 25, y: 76 },
    { x: 76, y: 74 },
  ],
};

/**
 * Fixed fallback shapes for a group of 2, 3 or 4 words (offsets in %), used only if the random
 * scatter can't produce a clean layout. Any two words less than 17% apart across are at least
 * 7% apart down, so chips don't collide even on a narrow screen.
 */
const SHAPES: Record<number, { x: number; y: number }[]> = {
  2: [
    { x: -8, y: -4 },
    { x: 9, y: 6 },
  ],
  3: [
    { x: -9, y: -9 },
    { x: 9, y: -2 },
    { x: -2, y: 10 },
  ],
  4: [
    { x: -9, y: -10 },
    { x: 9, y: -3 },
    { x: -8, y: 5 },
    { x: 10, y: 12 },
  ],
};

/** A small, seeded random number generator (mulberry32), so a map always lays out the same way. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Chips this close across must be at least this far apart down, or they overlap on a phone. */
const MIN_ACROSS = 17;
const MIN_DOWN = 9;
const SPREAD_X = 10.5;
const SPREAD_Y = 11;

/**
 * A random scatter of `count` words around (0, 0), no two of them overlapping. Returns null
 * if the random draws couldn't fit them, so the caller can fall back to a fixed shape.
 */
function scatter(count: number, random: () => number): { x: number; y: number }[] | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      for (let tries = 0; tries < 40 && points.length === i; tries++) {
        const p = { x: (random() * 2 - 1) * SPREAD_X, y: (random() * 2 - 1) * SPREAD_Y };
        if (points.every((q) => Math.abs(p.x - q.x) >= MIN_ACROSS || Math.abs(p.y - q.y) >= MIN_DOWN)) points.push(p);
      }
    }
    if (points.length === count) return points;
  }
  return null;
}

function place(groups: MapGroup[], words: MapWordInput[], salt: number, random: boolean) {
  const centres = CENTRES[Math.min(Math.max(groups.length, 2), MAX_GROUPS)];
  const placed: MapWord[] = [];
  const labels: MapLabel[] = [];
  groups.forEach((group, gi) => {
    const base = centres[gi] ?? centres[centres.length - 1];
    const members = words.filter((w) => w.group_id === group.id).slice(0, MAX_WORDS_PER_GROUP);
    const rng = seededRandom(hash(`${group.id}|${members.map((m) => m.id).join(",")}|${salt}`));
    const shape =
      (random ? scatter(members.length, rng) : null) ??
      (SHAPES[Math.max(members.length, 2)] ?? SHAPES[4]).map((p) => ({ x: gi % 2 === 1 ? -p.x : p.x, y: p.y }));
    // Nudge each group's centre a little too, so the clusters don't sit on a perfect grid.
    const c = random ? { x: base.x + (rng() - 0.5) * 6, y: base.y + (rng() - 0.5) * 6 } : base;
    members.forEach((w, i) => placed.push({ ...w, x: c.x + shape[i].x, y: c.y + shape[i].y }));
    const top = Math.min(...members.map((_, i) => shape[i].y));
    labels.push({ ...group, x: c.x, y: c.y + top - 7 });
  });
  return { words: placed, labels };
}

/**
 * Lays the map out automatically: each group gets its own random scatter (seeded by its words,
 * so it is the same on every visit), redrawn until every group sits clearly apart. If that
 * somehow never happens, it falls back to fixed shapes, which are always apart.
 */
export function layoutMap(groups: MapGroup[], words: MapWordInput[]): { words: MapWord[]; labels: MapLabel[] } {
  for (let salt = 0; salt < 30; salt++) {
    const layout = place(groups, words, salt, true);
    if (groupsAreSeparated(layout.words) && layout.words.every((w) => w.x > 3 && w.x < 97 && w.y > 4 && w.y < 96)) {
      return layout;
    }
  }
  return place(groups, words, 0, false);
}

const distance = (a: MapWord, b: MapWord) => Math.hypot(a.x - b.x, a.y - b.y);

/** The other words in the same group, nearest first. */
export function nearestInGroup(words: MapWord[], word: MapWord): MapWord[] {
  return words
    .filter((w) => w.id !== word.id && w.group_id === word.group_id)
    .sort((a, b) => distance(word, a) - distance(word, b));
}

/** The word furthest away on the whole map. */
export function furthest(words: MapWord[], word: MapWord): MapWord | null {
  let best: MapWord | null = null;
  for (const w of words) {
    if (w.id === word.id) continue;
    if (!best || distance(word, w) > distance(word, best)) best = w;
  }
  return best;
}

/** True when every word's group mates are all nearer to it than any word of another group. */
export function groupsAreSeparated(words: MapWord[]): boolean {
  return words.every((w) => {
    const mates = words.filter((o) => o.id !== w.id && o.group_id === w.group_id);
    const others = words.filter((o) => o.group_id !== w.group_id);
    if (!mates.length || !others.length) return true;
    return Math.max(...mates.map((m) => distance(w, m))) < Math.min(...others.map((o) => distance(w, o)));
  });
}
