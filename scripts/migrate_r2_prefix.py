"""Migrate R2 objects from /<slug>/ to /experiments/<slug>/.

Two-phase migration: copy first, then clean up old paths separately.

Usage:
    uv run python migrate_r2_prefix.py --dry-run     # preview
    uv run python migrate_r2_prefix.py                # copy to new paths (non-destructive)
    uv run python migrate_r2_prefix.py --cleanup      # delete old paths after verifying copy

Requires R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in environment.
"""

from __future__ import annotations

import argparse
import os
import re

import obstore as obs
from dotenv import load_dotenv
from obstore.store import S3Store

load_dotenv()

SLUG_PATTERN = re.compile(r"^.+-[a-z0-9]{4}$")
SKIP_PREFIXES = {"experiments", "solutions", "data", "v0", "test"}


def get_store() -> S3Store:
    account_id = os.environ.get("R2_ACCOUNT_ID", "d00038c6596061598646a3726dd77a60")
    return S3Store.from_url(
        f"s3://{os.environ.get('R2_BUCKET', 'aixi')}/",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        aws_endpoint=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_region="auto",
    )


def list_old_slugs(store: S3Store) -> list[str]:
    """Find top-level prefixes that look like experiment slugs."""
    result = obs.list_with_delimiter(store, "")
    prefixes = [p.rstrip("/") for p in result["common_prefixes"]]
    return sorted(p for p in prefixes if p not in SKIP_PREFIXES and SLUG_PATTERN.match(p))


def list_keys(store: S3Store, prefix: str) -> list[str]:
    """List all object keys under a prefix."""
    keys = []
    for page in obs.list(store, prefix):
        for obj in page:
            keys.append(obj["path"])
    return keys


def copy_slug(store: S3Store, slug: str, dry_run: bool) -> int:
    """Copy objects from <slug>/ to experiments/<slug>/. Non-destructive."""
    old_prefix = f"{slug}/"
    new_prefix = f"experiments/{slug}/"

    old_keys = list_keys(store, old_prefix)
    if not old_keys:
        print(f"  (empty)")
        return 0

    # Check which ones already exist at new path (resume support)
    new_keys = set(list_keys(store, new_prefix))
    to_copy = []
    for old_key in old_keys:
        new_key = new_prefix + old_key[len(old_prefix):]
        if new_key not in new_keys:
            to_copy.append((old_key, new_key))

    if not to_copy:
        print(f"  already copied ({len(old_keys)} objects)")
        return 0

    print(f"  {len(to_copy)} to copy ({len(old_keys) - len(to_copy)} already done)")
    for i, (old_key, new_key) in enumerate(to_copy):
        if dry_run:
            print(f"    {old_key} -> {new_key}")
        else:
            obs.copy(store, old_key, new_key)
            if (i + 1) % 100 == 0:
                print(f"    {i + 1}/{len(to_copy)}")
    return len(to_copy)


def cleanup_slug(store: S3Store, slug: str, dry_run: bool) -> int:
    """Delete old-path objects after verifying they exist at new path."""
    old_prefix = f"{slug}/"
    new_prefix = f"experiments/{slug}/"

    old_keys = list_keys(store, old_prefix)
    if not old_keys:
        return 0

    # Verify every old key has a corresponding new key
    new_keys = set(list_keys(store, new_prefix))
    missing = []
    for old_key in old_keys:
        new_key = new_prefix + old_key[len(old_prefix):]
        if new_key not in new_keys:
            missing.append(old_key)

    if missing:
        print(f"  SKIPPING — {len(missing)} objects not yet copied:")
        for k in missing[:5]:
            print(f"    {k}")
        if len(missing) > 5:
            print(f"    ... and {len(missing) - 5} more")
        return 0

    print(f"  deleting {len(old_keys)} old objects")
    for old_key in old_keys:
        if not dry_run:
            obs.delete(store, old_key)
    return len(old_keys)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview without executing")
    parser.add_argument("--cleanup", action="store_true",
                        help="Delete old paths (only after copy phase is complete)")
    args = parser.parse_args()

    store = get_store()
    slugs = list_old_slugs(store)

    if not slugs:
        print("No old-style slugs found. Migration complete.")
        return

    phase = "cleanup" if args.cleanup else "copy"
    print(f"Phase: {phase} ({'dry-run' if args.dry_run else 'live'})")
    print(f"Found {len(slugs)} slugs at old paths:")
    for s in slugs:
        print(f"  {s}/")

    if not args.dry_run:
        print()
        action = "Delete old copies" if args.cleanup else "Copy to experiments/ prefix"
        resp = input(f"{action} for {len(slugs)} experiments? [y/N] ")
        if resp.lower() != "y":
            print("Aborted.")
            return

    total = 0
    for slug in slugs:
        print(f"\n{slug}/:")
        if args.cleanup:
            n = cleanup_slug(store, slug, args.dry_run)
        else:
            n = copy_slug(store, slug, args.dry_run)
        total += n

    action = "would process" if args.dry_run else ("deleted" if args.cleanup else "copied")
    print(f"\nDone. {action} {total} objects across {len(slugs)} experiments.")


if __name__ == "__main__":
    main()
