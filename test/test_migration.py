"""Smoke test for migrate_v7.sql against an in-memory v6-state SQLite DB.

Verifies the migration:
  - coalesces NULL label / NULL params_json into the canonical empty values
  - de-duplicates rows that share (run_id, label, params_json)
  - adds the updated_at column and back-fills it from created_at
  - installs the UNIQUE(run_id, label, params_json) index
  - the index actually rejects duplicate inserts after the fact

Run from anywhere:
    uv run python aixi/strata/test/test_migration.py
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATE_V7 = REPO_ROOT / "aixi/strata/src/db/migrate_v7.sql"


# Minimal v6-shape artifacts table (matches the prod state we're migrating from).
V6_SCHEMA = """
CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  run_id TEXT,
  artifact_type TEXT NOT NULL,
  label TEXT,
  uri TEXT NOT NULL,
  content_hash TEXT,
  size_bytes INTEGER,
  params_json TEXT,
  created_at TEXT NOT NULL
);
"""


def main() -> int:
    db = sqlite3.connect(":memory:")
    db.executescript(V6_SCHEMA)

    # Seed: a normal row, a NULL-label row, and two duplicates sharing the
    # same (run_id, label, params_json) identity. The migration should keep
    # exactly one of the duplicates (the newest by rowid).
    now = "2025-01-01T00:00:00Z"
    rows = [
        ("a1", "exp1", "run1", "plotly_json", "loss",      "u/a1", "h1", 100, '{"seed":0}', now),
        ("a2", "exp1", "run1", "plot_html",  None,         "u/a2", "h2", 200, None,          now),
        ("a3", "exp1", "run1", "plotly_json", "sus",       "u/a3", "h3", 300, '{"k":1}',     now),
        ("a4", "exp1", "run1", "plotly_json", "sus",       "u/a4", "h4", 400, '{"k":1}',     now),
    ]
    db.executemany(
        "INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    db.commit()

    assert db.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 4

    # Apply the migration.
    db.executescript(MIGRATE_V7.read_text())
    db.commit()

    # --- Assertions ---

    count = db.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0]
    assert count == 3, f"expected 3 rows after dedup, got {count}"

    # NULL coalescing.
    null_label = db.execute("SELECT COUNT(*) FROM artifacts WHERE label IS NULL").fetchone()[0]
    assert null_label == 0, f"expected 0 NULL labels, got {null_label}"
    null_params = db.execute("SELECT COUNT(*) FROM artifacts WHERE params_json IS NULL").fetchone()[0]
    assert null_params == 0, f"expected 0 NULL params_json, got {null_params}"

    # a2 (the NULL-label row) should have label='' and params_json='{}'.
    row = db.execute("SELECT label, params_json FROM artifacts WHERE artifact_id='a2'").fetchone()
    assert row == ("", "{}"), f"expected ('', '{{}}') for a2 sentinel coalescing, got {row}"

    # updated_at populated for everyone.
    null_updated = db.execute("SELECT COUNT(*) FROM artifacts WHERE updated_at IS NULL").fetchone()[0]
    assert null_updated == 0, f"expected updated_at populated for all rows, {null_updated} still NULL"

    # Dedup kept the newest (max rowid) — a4, not a3.
    surviving = {r[0] for r in db.execute(
        "SELECT artifact_id FROM artifacts WHERE label='sus' AND params_json='{\"k\":1}'"
    ).fetchall()}
    assert surviving == {"a4"}, f"expected a4 to survive dedup, got {surviving}"

    # UNIQUE index installed.
    idx = db.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_artifacts_unique'"
    ).fetchone()
    assert idx is not None, "expected idx_artifacts_unique to exist"

    # Inserting a duplicate now fails.
    try:
        db.execute(
            """INSERT INTO artifacts
               (artifact_id, experiment_id, run_id, artifact_type, label, uri,
                content_hash, size_bytes, params_json, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            ("a5", "exp1", "run1", "plotly_json", "sus", "u/a5", "h5", 500, '{"k":1}', now),
        )
        db.commit()
        raise AssertionError("expected IntegrityError on duplicate insert")
    except sqlite3.IntegrityError as exc:
        assert "UNIQUE" in str(exc), f"expected UNIQUE constraint error, got: {exc}"

    print("OK migration smoke test passed (4 rows -> 3 after dedup, sentinels + index verified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
