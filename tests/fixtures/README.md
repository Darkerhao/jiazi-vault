# Electron compatibility fixtures

These files were generated on 2026-11-19 by the original, unmodified Electron backend from commit `acc2a01`, before removing its runtime dependencies. Every password, credential, key and project is artificial test data.

- `legacy.json`: known master password, derived key, current credential and history expectations.
- `legacy-vault.sql`: original SQLite schema and rows, exported before the Rust implementation was used.
- `legacy-v1.jvault` through `legacy-v4.jvault`: authenticated encrypted backups for every previously supported format.

The artificial trash record has a 2099 deletion timestamp so the original 30-day retention policy will not make the compatibility fixture expire. Rust tests read these original files, and the Node interoperability test independently decrypts Rust-written output using `node:crypto` and the known fixture key.
