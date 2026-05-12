"""Delete stray files from failed flatten attempts.

Keeps: artifacts/, zarr/, scripts/, manifest.json
Deletes: data/, stray dirs at run root, stray zarr.json at run root

Usage:
    uv run python cleanup_stray.py --dry-run    # preview
    uv run python cleanup_stray.py              # delete
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


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    store = get_store()

    # Find all runs
    runs = set()
    print("Scanning for runs...")
    for page in obs.list(store, "experiments/"):
        for obj in page:
            parts = obj["path"].split("/")
            if len(parts) >= 5 and parts[2] == "runs":
                runs.add("/".join(parts[:4]) + "/")

    runs = sorted(runs)
    print(f"Found {len(runs)} runs\n")

    # Collect stray objects
    keep_dirs = {"artifacts", "zarr", "scripts"}
    to_delete = []

    for run in runs:
        result = obs.list_with_delimiter(store, run)
        run_strays = []

        for p in result["common_prefixes"]:
            dirname = p.replace(run, "").rstrip("/")
            if dirname not in keep_dirs:
                for page in obs.list(store, p):
                    for obj in page:
                        run_strays.append(obj["path"])

        for obj in result.get("objects", []):
            fname = obj["path"].replace(run, "")
            if fname != "manifest.json":
                run_strays.append(obj["path"])

        if run_strays:
            short = run.replace("experiments/", "")
            print(f"{short}: {len(run_strays)} stray objects")
            to_delete.extend(run_strays)

    print(f"\nTotal: {len(to_delete)} objects to delete")

    if not to_delete:
        print("Nothing to clean up.")
        return

    if args.dry_run:
        print("(dry run — nothing deleted)")
        return

    resp = input(f"Delete {len(to_delete)} stray objects? [y/N] ")
    if resp.lower() != "y":
        print("Aborted.")
        return

    done = 0
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(obs.delete, store, k): k for k in to_delete}
        for f in as_completed(futures):
            f.result()
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(to_delete)}")

    print(f"\nDone. Deleted {done} objects.")


if __name__ == "__main__":
    main()
