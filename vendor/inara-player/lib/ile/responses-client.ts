// Copied from inara-next lib/ile/responses-client.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Client helpers for the learner's written answers (`free_response` blocks).
 * Answers for a lesson are fetched once and shared by every block in it.
 */

import { ILE_FETCH_TIMEOUT_MS } from "@/vendor/inara-player/lib/ile/points-client";

const cache = new Map<string, Promise<Record<string, string>>>();

async function fetchJson(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ILE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Saved answers by block id. Resolves to {} on any failure so the block stays usable. */
export function loadLessonResponses(lessonId: string): Promise<Record<string, string>> {
  let pending = cache.get(lessonId);
  if (!pending) {
    pending = fetchJson(`/api/ile/responses?lessonId=${encodeURIComponent(lessonId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { responses?: Record<string, string> };
        return body.responses ?? {};
      })
      .catch(() => {
        cache.delete(lessonId); // let a later mount retry
        return {};
      });
    cache.set(lessonId, pending);
  }
  return pending;
}

/** Save one answer. Returns false when the server refused or could not be reached. */
export async function saveLessonResponse(lessonId: string, blockId: string, response: string): Promise<boolean> {
  try {
    const res = await fetchJson("/api/ile/responses", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId, blockId, response }),
    });
    if (!res.ok) return false;
    const saved = cache.get(lessonId);
    if (saved) cache.set(lessonId, saved.then((all) => ({ ...all, [blockId]: response })));
    return true;
  } catch {
    return false;
  }
}
