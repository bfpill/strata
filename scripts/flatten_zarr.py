"""Rename zarr/ to data/: copy zarr/* to data/*.

Two-phase: copy first, then cleanup old zarr/ subpaths.

Usage:
    uv run python flatten_zarr.py --dry-run          # preview
    uv run python flatten_zarr.py                     # copy (non-destructive, resumable)
    uv run python flatten_zarr.py --cleanup           # delete old zarr/ subpaths after verifying
    uv run python flatten_zarr.py --verify            # verify every zarr/ key exists in data/

Requires R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in environment.
"""

from __future__ import annotations

import argparse
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import obstore as obs
from dotenv import load_dotenv
from obstore.store import S3Store

load_dotenv()


def get_store() -> S3Store:
    account_id = os.environ.get("R2_ACCOUNT_ID", "d00038c6596061598646a3726dd77a60")
    return S3Store.from_url(
        f"s3://{os.environ.get('R2_BUCKET', 'aixi')}/",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        aws_endpoint=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_region="auto",
    )


def list_keys(store: S3Store, prefix: str) -> list[str]:
    keys = []
    for page in obs.list(store, prefix):
        for obj in page:
            keys.append(obj["path"])
    return keys


def find_all_runs(store: S3Store) -> list[tuple[str, str]]:
    """Find all (run_prefix, zarr_prefix) pairs that have a zarr/ subpath."""
    runs = []
    seen = set()
    for page in obs.list(store, "experiments/"):
        for obj in page:
            path = obj["path"]
            # Look for .../runs/N/zarr/zarr.json
            if "/zarr/zarr.json" not in path:
                continue
            zarr_json_path = path
            zarr_prefix = zarr_json_path.rsplit("zarr.json", 1)[0]  # .../runs/N/zarr/
            run_prefix = zarr_prefix.replace("zarr/", "", 1)  # wrong — need to strip trailing zarr/
            # Actually: zarr_prefix ends with /zarr/, run_prefix is everything before /zarr/
            run_prefix = zarr_prefix[: -len("zarr/")]
            if run_prefix in seen:
                continue
            seen.add(run_prefix)
            runs.append((run_prefix, zarr_prefix))
    return sorted(runs)


def copy_run(store: S3Store, run_prefix: str, zarr_prefix: str, dry_run: bool, workers: int = 16) -> int:
    """Copy zarr/* to data/*. Resumable."""
    data_prefix = run_prefix + "data/"

    zarr_keys = list_keys(store, zarr_prefix)
    if not zarr_keys:
        return 0

    existing = set(list_keys(store, data_prefix))

    to_copy = []
    for zk in zarr_keys:
        relative = zk[len(zarr_prefix):]
        new_key = data_prefix + relative
        if new_key not in existing:
            to_copy.append((zk, new_key))

    if not to_copy:
        print(f"  already done ({len(zarr_keys)} objects)")
        return 0

    print(f"  {len(to_copy)} to copy ({len(zarr_keys) - len(to_copy)} already done)")
    if dry_run:
        for old, new in to_copy[:5]:
            print(f"    {old.split('zarr/')[-1]}")
        if len(to_copy) > 5:
            print(f"    ... and {len(to_copy) - 5} more")
        return len(to_copy)

    done = 0
    def do_copy(pair):
        obs.copy(store, pair[0], pair[1])

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(do_copy, p): p for p in to_copy}
        for f in as_completed(futures):
            f.result()
            done += 1
            if done % 100 == 0:
                print(f"    {done}/{len(to_copy)}")
    return len(to_copy)


def cleanup_run(store: S3Store, run_prefix: str, zarr_prefix: str, dry_run: bool, workers: int = 16) -> int:
    """Delete zarr/* after verifying copies exist in data/."""
    data_prefix = run_prefix + "data/"

    zarr_keys = list_keys(store, zarr_prefix)
    if not zarr_keys:
        return 0

    existing = set(list_keys(store, data_prefix))
    missing = []
    for zk in zarr_keys:
        relative = zk[len(zarr_prefix):]
        new_key = data_prefix + relative
        if new_key not in existing:
            missing.append(relative)

    if missing:
        print(f"  SKIPPING — {len(missing)} not yet copied")
        for m in missing[:3]:
            print(f"    {m}")
        return 0

    print(f"  deleting {len(zarr_keys)} old zarr/ objects")
    if dry_run:
        return len(zarr_keys)

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(obs.delete, store, k): k for k in zarr_keys}
        for f in as_completed(futures):
            f.result()
            done += 1
            if done % 100 == 0:
                print(f"    {done}/{len(zarr_keys)}")
    return len(zarr_keys)


def verify_run(store: S3Store, run_prefix: str, zarr_prefix: str) -> bool:
    """Verify every key under zarr/ exists in data/."""
    data_prefix = run_prefix + "data/"

    zarr_keys = list_keys(store, zarr_prefix)
    if not zarr_keys:
        return True

    data_keys = set(list_keys(store, data_prefix))
    missing = []
    for zk in zarr_keys:
        relative = zk[len(zarr_prefix):]
        expected = data_prefix + relative
        if expected not in data_keys:
            missing.append(relative)

    if missing:
        print(f"  MISSING {len(missing)}/{len(zarr_keys)}:")
        for m in missing[:5]:
            print(f"    {m}")
        if len(missing) > 5:
            print(f"    ... and {len(missing) - 5} more")
        return False
    return True


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--cleanup", action="store_true", help="Delete old zarr/ subpaths")
    parser.add_argument("--verify", action="store_true", help="Verify all runs readable from root")
    args = parser.parse_args()

    store = get_store()
    print("Finding runs with zarr/ subpath...")
    runs = find_all_runs(store)
    print(f"Found {len(runs)} runs\n")

    if args.verify:
        ok = 0
        fail = 0
        for run_prefix, zarr_prefix in runs:
            short = run_prefix.replace("experiments/", "")
            print(f"{short}:", end=" ")
            if verify_run(store, run_prefix, zarr_prefix):
                print("OK")
                ok += 1
            else:
                fail += 1
        print(f"\n{ok} OK, {fail} failed")
        return

    phase = "cleanup" if args.cleanup else "copy"
    print(f"Phase: {phase} ({'dry-run' if args.dry_run else 'live'})")

    if not args.dry_run:
        action = "Delete old zarr/ subpaths" if args.cleanup else "Copy zarr/* to run root"
        resp = input(f"{action} for {len(runs)} runs? [y/N] ")
        if resp.lower() != "y":
            print("Aborted.")
            return

    total = 0
    for run_prefix, zarr_prefix in runs:
        short = run_prefix.replace("experiments/", "")
        print(f"{short}:")
        if args.cleanup:
            total += cleanup_run(store, run_prefix, zarr_prefix, args.dry_run)
        else:
            total += copy_run(store, run_prefix, zarr_prefix, args.dry_run)

    action = "would process" if args.dry_run else ("deleted" if args.cleanup else "copied")
    print(f"\nDone. {action} {total} objects across {len(runs)} runs.")


if __name__ == "__main__":
    main()
