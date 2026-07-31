# vledger — ingestion (read path)

vledger keeps **no store**. It reads the reconstruction files off disk and
aggregates them in the frontend for display. "Ingestion" here means the read +
parse path, not a persisted import. See also `README.md` and `BACKLOG.md`.

## Source

The `accounting.master/.../reconstruction/` folder (auto-detected at
`~/Documents/accounting.master/…`, or chosen via the picker and remembered):

- `_cgt/SA108-summary.csv`, `_cgt/cgt-disposals-all.csv`, `_cgt/btc-s104-ledger.csv`
- `<venue>/<venue>-canonical.csv` per venue

## Backend (`src-tauri/src/lib.rs`)

Two commands, **string-only**: `default_root` (probe for the folder) and
`load_reconstruction` (read each file as a raw UTF-8 string into a struct; missing
files reported, not fatal). **No CSV split, no numeric or date parse in Rust.**

## Frontend (`src/app.ts`) — types, conversions, defaults

- Minimal RFC-4180 parser → `Record<string,string>[]` (every field a string).
- **Numbers:** `num()` strips `,`/spaces, `parseFloat`, and maps blank/unparseable
  → `0`. **Float is display-only** — the authoritative decimals stay in the CSVs
  (vledger never writes back). Blank `gain_gbp` isn't a problem here because that
  column is always populated; the canonical "blank `gbp_value` = pending" rule
  lives upstream in the CSV layer.
- **Dates:** treated as **opaque ISO-8601 strings** — sorted lexicographically and
  `slice(0,7)` for `YYYY-MM` buckets, so they must be ISO. No tz conversion (the
  reconstruction is already UTC per `xledger/CANONICAL.md`); no validation guard.
- **`provisional`** = exact string `"yes"`; anything else counts as firm.
- Amounts float-accumulate for the charts, then round for display — a visual
  reconstruction, not filed figures.

This is the canonical/CSV-layer contract shared with xledger; nledger differs
internally by design (msat integers, node-local time) — the two agree only at the
reconstruction seam.
