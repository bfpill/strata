/** Zarr loading helpers shared across custom tm_space panel components.
 *
 *  Uses zarrita's `withByteCaching` extension on a single shared FetchStore
 *  so chunk fetches across components dedupe (concurrent requests for the
 *  same chunk return the same promise) and stay warm across TM hovers
 *  (after the first load of a chunk, subsequent slices that cover the same
 *  chunk hit the in-memory cache instead of refetching).
 */
import { useEffect, useState } from "react";
import * as zarr from "zarrita";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://strata.timaeus-research-inc.workers.dev";

// Shared cached store. Built lazily on first use.
let SHARED_STORE: any = null;

async function getSharedStore(): Promise<any> {
  if (!SHARED_STORE) {
    const inner = new zarr.FetchStore(`${API_URL}/data/r2/`);
    // withByteCaching defaults to an unbounded Map; we want a bounded LRU so
    // a long browsing session doesn't accumulate hundreds of MB. The
    // structural permuted_sus is ~64MB total in 4 chunks of ~17MB each, so
    // capping at ~256 entries is plenty.
    SHARED_STORE = await zarr.extendStore(inner, (s: any) => zarr.withByteCaching(s));
  }
  return SHARED_STORE;
}

/** Open a zarr array given an absolute URI (relative to the R2 bucket root). */
export async function openArray(uri: string): Promise<any> {
  const store = await getSharedStore();
  const loc = zarr.root(store).resolve(uri);
  return zarr.open.v3(loc, { kind: "array" });
}

/** Open a zarr group given an absolute URI. */
export async function openGroup(uri: string): Promise<any> {
  const store = await getSharedStore();
  const loc = zarr.root(store).resolve(uri);
  return zarr.open.v3(loc, { kind: "group" });
}

/** Read arr[index, ...] for a 2D or 3D array. Returns a flat typed array. */
export async function getRow(zarrArr: any, index: number): Promise<any> {
  const ndim = zarrArr.shape.length;
  if (ndim === 2) return zarr.get(zarrArr, [index, null]);
  if (ndim === 3) return zarr.get(zarrArr, [index, null, null]);
  if (ndim === 1) return zarr.get(zarrArr, [index]);
  throw new Error(`Unsupported ndim=${ndim}`);
}

/** Read entire array. */
export async function getAll(zarrArr: any): Promise<any> {
  return zarr.get(zarrArr, null);
}

/** Hook that opens a zarr group at the given URI and returns it (or null + error). */
export function useZarrGroup(uri: string | undefined): {
  group: any | null;
  loading: boolean;
  error: string | null;
} {
  const [group, setGroup] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uri) {
      setGroup(null); setLoading(false); setError("No zarr group URI");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    openGroup(uri)
      .then((g) => { if (!cancelled) setGroup(g); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uri]);

  return { group, loading, error };
}

/** Hook: opens a single array within a zarr group, by name. The group is
 *  passed in (typically from useZarrGroup), so multiple arrays can share one
 *  group open. Returns the opened array (suitable for getRow). */
export function useGroupArray(group: any | null, name: string): any | null {
  const [arr, setArr] = useState<any | null>(null);

  useEffect(() => {
    if (!group) { setArr(null); return; }
    let cancelled = false;
    zarr.open.v3(group.resolve(name), { kind: "array" })
      .then((a) => { if (!cancelled) setArr(a); })
      .catch(() => { if (!cancelled) setArr(null); });
    return () => { cancelled = true; };
  }, [group, name]);

  return arr;
}

/** Hook: load a single row from a zarr array. Returns the typed-array data,
 *  loading flag, and error.
 *
 *  Important: `data` retains the previous value while a new fetch is in
 *  flight (only `loading` flips to true). Callers should render with stale
 *  data during a transition rather than unmounting the consumer (e.g. Plot)
 *  via an early-return on `loading` — that's what causes the heatmap flicker
 *  on TM hover.
 */
export function useArrayRow(zarrArr: any | null, index: number): {
  data: any | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!zarrArr) { setData(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRow(zarrArr, index)
      .then((slice) => { if (!cancelled) setData(slice); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [zarrArr, index]);

  return { data, loading, error };
}

/** Hook: batch-fetch the same row index from multiple zarr arrays as one
 *  await. All slices arrive in a single state update, so the consumer only
 *  re-renders once per index change rather than once per fetch resolving.
 *
 *  Pass an object `{ name: zarrArr | null }`. While `index` changes, `data`
 *  retains the previous payload until the new batch resolves; `loading`
 *  flips to true during the fetch.
 */
export function useArrayRowsBatch<K extends string>(
  arrays: Record<K, any | null>,
  index: number,
): {
  data: Record<K, any> | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<Record<K, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable identity for the array set: depend on each array reference.
  const keys = Object.keys(arrays) as K[];
  const arrRefs = keys.map((k) => arrays[k]);

  useEffect(() => {
    if (arrRefs.some((a) => !a)) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all(arrRefs.map((a) => getRow(a, index)))
      .then((slices) => {
        if (cancelled) return;
        const out = {} as Record<K, any>;
        keys.forEach((k, i) => { out[k] = slices[i]; });
        setData(out);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...arrRefs, index]);

  return { data, loading, error };
}
