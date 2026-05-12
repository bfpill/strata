"""End-to-end smoke test for the v7 server endpoints, against `wrangler dev`.

Verifies the headline v7 behaviors via raw HTTP (no R2 — we PUT fake URIs so
we exercise the D1 paths in isolation):

  1. PUT /runs/:idx/artifacts upserts by (run_id, label, params) — same
     identity yields the same artifact_id, different identity creates
     a new row, siblings are never touched.
  2. PUT /runs/:idx/layouts/:label merges into artifact_layouts_json
     without clobbering other labels.
  3. PATCH /runs/:idx accepts hparams/sources/dataset_kinds/artifact_layouts
     independently.
  4. POST .../finalize is non-destructive: appends an invocation, flips
     status to 'finalized', and any legacy `artifacts` body field is
     upserted rather than wiped-and-reinserted.
  5. clear_artifacts (via DELETE /runs/:idx/artifacts) actually deletes.

Usage:
    uv run python aixi/strata/test/test_runtime.py

The script starts and stops `wrangler dev` itself; it requires .dev.vars
with STRATA_API_KEY set, which already exists in this repo.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

import httpx


REPO_ROOT = Path(__file__).resolve().parents[3]
STRATA_DIR = REPO_ROOT / "aixi/strata"
SCHEMA_SQL = STRATA_DIR / "src/db/schema.sql"
DEV_VARS = STRATA_DIR / ".dev.vars"
PORT = 8799  # avoid colliding with whatever the user might have running on 8787


def _load_api_key() -> str:
    for line in DEV_VARS.read_text().splitlines():
        if line.startswith("STRATA_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("STRATA_API_KEY not found in .dev.vars")


def _wait_for(url: str, timeout: float = 30.0) -> None:
    """Poll until the worker responds to /health, or give up."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = httpx.get(url, timeout=2.0)
            if r.status_code == 200:
                return
        except (httpx.HTTPError, ConnectionError):
            pass
        time.sleep(0.5)
    raise RuntimeError(f"worker at {url} did not come up within {timeout}s")


def _free_port(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def main() -> int:
    if not _free_port(PORT):
        print(f"ERROR: port {PORT} is in use; close whatever is using it and retry", file=sys.stderr)
        return 1

    api_key = _load_api_key()
    base = f"http://localhost:{PORT}"

    # Local D1 may have an older schema from previous dev sessions. Nuke
    # the miniflare state and apply the current schema fresh — this is a
    # smoke test running against an ephemeral DB, not anything precious.
    miniflare_state = STRATA_DIR / ".wrangler/state/v3/d1/miniflare-D1DatabaseObject"
    if miniflare_state.exists():
        print(f"Wiping local D1 state at {miniflare_state.relative_to(REPO_ROOT)}...")
        for f in miniflare_state.glob("*.sqlite*"):
            f.unlink()

    print("Applying schema.sql to local D1...")
    subprocess.run(
        ["npx", "wrangler", "d1", "execute", "strata-db", "--local", "--file=src/db/schema.sql"],
        cwd=STRATA_DIR, check=True, capture_output=True,
    )

    # Start wrangler dev.
    print(f"Starting wrangler dev on port {PORT}...")
    wrangler = subprocess.Popen(
        ["npx", "wrangler", "dev", "--port", str(PORT), "--log-level", "warn"],
        cwd=STRATA_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )

    try:
        _wait_for(f"{base}/health")
        print("Worker ready.")
        _run_assertions(base, api_key)
        print("\nOK runtime smoke test passed")
        return 0
    finally:
        wrangler.terminate()
        try:
            wrangler.wait(timeout=10)
        except subprocess.TimeoutExpired:
            wrangler.kill()


# --- HTTP helpers --------------------------------------------------------


class Client:
    def __init__(self, base: str, api_key: str):
        self.h = httpx.Client(
            base_url=base,
            headers={
                "Authorization": f"Bearer {api_key}",
                "X-Actor": "smoke-test",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        )

    def get(self, path: str) -> dict:
        r = self.h.get(path)
        r.raise_for_status()
        return r.json()

    def post(self, path: str, body: dict | None = None) -> dict:
        r = self.h.post(path, json=body or {})
        r.raise_for_status()
        return r.json()

    def put(self, path: str, body: dict | None = None) -> dict:
        r = self.h.put(path, json=body or {})
        r.raise_for_status()
        return r.json()

    def patch(self, path: str, body: dict) -> dict:
        r = self.h.patch(path, json=body)
        r.raise_for_status()
        return r.json()

    def delete(self, path: str) -> dict:
        r = self.h.delete(path)
        r.raise_for_status()
        return r.json()


# --- Assertions ----------------------------------------------------------


def _run_assertions(base: str, api_key: str) -> None:
    c = Client(base, api_key)

    # 0. Create a throwaway experiment + run.
    exp = c.post("/experiments/create", {
        "title": "smoke test",
        "name": "smoke",
        "group": "smoke-test",
        "tags": ["smoke"],
    })
    slug = exp["slug"]
    print(f"  created experiment: {slug}")

    run = c.post(f"/experiments/{slug}/runs/create", {"label": "smoke"})
    idx = run["run_index"]
    print(f"  created run #{idx}")

    artifacts_path = f"/experiments/{slug}/runs/{idx}/artifacts"
    manifest_path = f"/experiments/{slug}/manifest?run={idx}"

    # 1. Upsert three artifacts with distinct (label, params).
    a1 = c.put(artifacts_path, {
        "artifact_type": "plotly_json",
        "label": "loss",
        "uri": "fake/loss_seed=0.json",
        "content_hash": "hash-A",
        "size_bytes": 100,
        "params": {"seed": 0},
    })
    a2 = c.put(artifacts_path, {
        "artifact_type": "plotly_json",
        "label": "loss",
        "uri": "fake/loss_seed=1.json",
        "content_hash": "hash-B",
        "size_bytes": 100,
        "params": {"seed": 1},
    })
    a3 = c.put(artifacts_path, {
        "artifact_type": "plotly_json",
        "label": "sus",
        "uri": "fake/sus.json",
        "content_hash": "hash-C",
        "size_bytes": 200,
    })
    assert a1["created"] and a2["created"] and a3["created"], "first uploads should all be new rows"
    assert len({a1["artifact_id"], a2["artifact_id"], a3["artifact_id"]}) == 3
    print("  uploaded 3 distinct artifacts")

    m = c.get(manifest_path)
    arts = m["outputs"]["artifacts"]
    assert len(arts) == 3, f"expected 3 artifacts in manifest, got {len(arts)}"
    by_label_seed = {(a["label"], (a.get("params") or {}).get("seed")): a for a in arts}
    assert ("loss", 0) in by_label_seed
    assert ("loss", 1) in by_label_seed
    assert ("sus", None) in by_label_seed
    hashes = {a["content_hash"] for a in arts}
    assert hashes == {"hash-A", "hash-B", "hash-C"}
    updated_ats = [a["updated_at"] for a in arts]
    assert all(updated_ats), "all artifacts should have updated_at set"
    print("  manifest has 3 artifacts with distinct content_hashes + updated_at")

    # 2. Re-upload one of them: same identity, new content_hash.
    #    Other rows must be untouched.
    time.sleep(1.1)  # ensure updated_at moves at second-resolution
    a1_again = c.put(artifacts_path, {
        "artifact_type": "plotly_json",
        "label": "loss",
        "uri": "fake/loss_seed=0_v2.json",
        "content_hash": "hash-A2",
        "size_bytes": 110,
        "params": {"seed": 0},
    })
    assert not a1_again["created"], "re-upload of same identity should be an update, not insert"
    assert a1_again["artifact_id"] == a1["artifact_id"], "same identity must return same artifact_id"

    m = c.get(manifest_path)
    arts = m["outputs"]["artifacts"]
    assert len(arts) == 3, f"row count must still be 3 after re-upload, got {len(arts)}"
    seed0 = next(a for a in arts if a["label"] == "loss" and (a.get("params") or {}).get("seed") == 0)
    assert seed0["content_hash"] == "hash-A2", "re-uploaded row should have new hash"
    assert seed0["uri"] == "fake/loss_seed=0_v2.json", "re-uploaded row should have new uri"
    seed1 = next(a for a in arts if a["label"] == "loss" and (a.get("params") or {}).get("seed") == 1)
    assert seed1["content_hash"] == "hash-B", "untouched sibling must keep its hash"
    assert seed0["updated_at"] > seed1["updated_at"], "re-uploaded row's updated_at should advance past sibling's"
    print("  re-upload upserted in place, siblings untouched, updated_at advanced")

    # 3. Param canonicalisation: server should treat {"a":1,"b":2} and
    #    {"b":2,"a":1} as the same identity.
    p1 = c.put(artifacts_path, {
        "label": "canon", "uri": "fake/c1", "content_hash": "p1", "size_bytes": 1,
        "params": {"a": 1, "b": 2},
    })
    p2 = c.put(artifacts_path, {
        "label": "canon", "uri": "fake/c2", "content_hash": "p2", "size_bytes": 1,
        "params": {"b": 2, "a": 1},  # different key order
    })
    assert p1["artifact_id"] == p2["artifact_id"], "param key order should not affect identity"
    print("  param canonicalisation: key-order-insensitive identity confirmed")

    # 4. PUT per-label layout: merges, doesn't clobber.
    c.put(f"/experiments/{slug}/runs/{idx}/layouts/loss", {"layout": {"seed": "slider"}})
    c.put(f"/experiments/{slug}/runs/{idx}/layouts/sus", {"layout": {"variant": "dropdown"}})
    m = c.get(manifest_path)
    layouts = m["outputs"]["artifact_layouts"]
    assert layouts == {"loss": {"seed": "slider"}, "sus": {"variant": "dropdown"}}, (
        f"both labels should be present in artifact_layouts, got: {layouts}"
    )
    print("  per-label layouts: both labels present, neither clobbered the other")

    # 5. PATCH run accepts independent fields.
    c.patch(f"/experiments/{slug}/runs/{idx}", {"hparams": {"beta": 30, "seed": 42}})
    c.patch(f"/experiments/{slug}/runs/{idx}", {"sources": {"baseline": "fake-uri"}})
    m = c.get(manifest_path)
    assert m["hparams"] == {"beta": 30, "seed": 42}, f"hparams not set: {m['hparams']}"
    assert m["sources"] == {"baseline": "fake-uri"}, f"sources not set: {m['sources']}"
    print("  PATCH hparams and sources land independently")

    # 6. Non-destructive finalize: send a legacy body with a NEW artifact and
    #    confirm everything from before still exists.
    pre_count = len(c.get(manifest_path)["outputs"]["artifacts"])
    fin = c.post(f"/experiments/{slug}/runs/{idx}/finalize", {
        "invocation": {"argv": ["test"], "timestamp": "2025-01-01T00:00:00Z"},
        "artifacts": [{
            "artifact_type": "plotly_json",
            "label": "legacy_body_artifact",
            "uri": "fake/legacy.json",
            "content_hash": "hash-legacy",
            "size_bytes": 50,
            "params": {},
        }],
    })
    assert fin["status"] == "finalized"
    m = c.get(manifest_path)
    arts = m["outputs"]["artifacts"]
    assert len(arts) == pre_count + 1, (
        f"finalize-with-legacy-body must upsert (not replace) artifacts; "
        f"expected {pre_count+1}, got {len(arts)}"
    )
    assert any(a["label"] == "legacy_body_artifact" for a in arts)
    assert any(a["label"] == "loss" for a in arts), "previous artifacts must still be present"
    print(f"  non-destructive finalize: legacy-body artifact added, siblings preserved ({pre_count} -> {len(arts)})")

    # 7. Re-finalize: invocations append, artifacts unchanged.
    c.post(f"/experiments/{slug}/runs/{idx}/finalize", {
        "invocation": {"argv": ["test", "again"], "timestamp": "2025-01-02T00:00:00Z"},
    })
    m = c.get(manifest_path)
    assert len(m["invocations"]) == 2, f"expected 2 invocations, got {len(m['invocations'])}"
    assert len(m["outputs"]["artifacts"]) == pre_count + 1, "artifacts unchanged on re-finalize"
    print("  re-finalize: invocation appended, artifacts unchanged")

    # 8. DELETE artifacts wipes the set.
    c.delete(artifacts_path)
    m = c.get(manifest_path)
    assert len(m["outputs"]["artifacts"]) == 0, "delete-artifacts should clear them"
    print("  DELETE artifacts cleared the set")

    # 9. Cleanup.
    c.delete(f"/experiments/{slug}")
    print(f"  tombstoned {slug}")


if __name__ == "__main__":
    raise SystemExit(main())
