-- v8: Add doc_slugs column for linking experiments to Google Docs
ALTER TABLE experiments ADD COLUMN doc_slugs TEXT; -- JSON array of InstantDB draft post slugs
