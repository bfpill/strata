/** Recently-viewed experiments, persisted in localStorage.
 *
 *  Stored as a most-recent-first list of {slug, title, ts}. Capped so the
 *  list stays scannable. ExperimentDetail.tsx pushes on mount; Feed.tsx
 *  renders. Single-browser, single-user — that's the point.
 */

const KEY = "strata_recently_viewed";
const MAX_ITEMS = 5;

export interface RecentItem {
  slug: string;
  title: string;
  ts: number;
}

function read(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: drop malformed entries. Cap to MAX_ITEMS so a reduced
    // cap takes effect even on entries written under a previous limit.
    return parsed
      .filter(
        (x): x is RecentItem =>
          x &&
          typeof x.slug === "string" &&
          typeof x.title === "string" &&
          typeof x.ts === "number",
      )
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function recordView(slug: string, title: string): void {
  const now = Date.now();
  const existing = read().filter((r) => r.slug !== slug);
  const next = [{ slug, title, ts: now }, ...existing].slice(0, MAX_ITEMS);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage full or disabled — nothing actionable.
  }
}

export function getRecentlyViewed(): RecentItem[] {
  return read();
}

export function clearRecentlyViewed(): void {
  localStorage.removeItem(KEY);
}
