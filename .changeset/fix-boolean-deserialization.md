---
"oakbun": patch
---

fix(db): auto-deserialize SQLite INTEGER booleans to JS boolean in deserializeRow

`column.boolean()` columns stored as `0`/`1` in SQLite are now correctly
deserialized to `false`/`true` when reading rows. Symmetric with the existing
`column.timestamp()` → `Date` deserialization.

Closes #7
