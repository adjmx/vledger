# vledger — backlog

Read-only visual analysis over the CGT reconstruction. Forked from xledger's
scaffold (Tauri 2), stripped to a vanilla-TS charting frontend + a two-command
Rust backend that reads the reconstruction files. Shares the *sources*, not a
store — so it always reflects the reconstruction as it's refined.

## Shipped
- **V0 — scaffold + dashboard.** Fork xledger, retarget (`vledger` /
  `uk.fizx.vledger`). Rust: `default_root` + `load_reconstruction`. Frontend:
  CSV parse → aggregate → 5 panels (taxable-vs-AEA, firm/provisional, by-asset,
  S104 BTC pool, classification + nledger cross-link). Folder picker + refresh +
  light/dark. Same layout as the standalone `_cgt/cgt-dashboard.html`.

## Next
- **V1 — drill-downs.** Click a year/asset to expand its disposals; ETH
  provisional-basis detail (the largest soft number); 2020/21 provisional list.
- **V2 — nledger cross-link view.** Load nledger's data too; visualise matched
  vs. unmatched transfers (the spend-vs-transfer resolutions).
- **V3 — export.** PNG/PDF of a panel, and a "figures for the return" sheet.
- **V4 — theme parity.** Optionally adopt the suite `--c-*` tokens (mono/fizx/
  upleb) alongside the data-viz palette.

## Notes
- All aggregation is in `src/app.ts` (mirrors the Python in `_cgt/`); if a
  reconstruction column changes, update the parser there.
- Amounts are parsed as floats **for display only**; the authoritative decimals
  live in the reconstruction CSVs. `num()` (`src/app.ts`) strips `,`/spaces,
  `parseFloat`s, and maps blank/unparseable → `0` (no error) — fine because the
  disposals/SA108 amount columns are always populated; the canonical
  "blank `gbp_value` = pending" rule lives upstream in the CSV layer, not here.
- Dates are treated as **opaque ISO-8601 strings**: sorted lexicographically and
  sliced `YYYY-MM` for month buckets, so they must be ISO (`YYYY-MM-DD…`) for the
  order/bucket to be correct. No tz conversion is applied (none needed — the
  reconstruction already emits UTC per `xledger/CANONICAL.md`). There is no
  validation guard; a non-ISO date would mis-sort silently.
- `provisional` is read as exact string `"yes"` (current data is only `yes`/`no`);
  any other value counts as firm. Normalize here if the canonical column ever
  emits `true`/`1`/`Y`.
- These conventions are the canonical/CSV-layer contract shared with xledger
  (decimal strings + ISO-8601 UTC). nledger deliberately differs internally
  (msat/sat integers, node-local time) — see its README; the two only need to
  agree at the reconstruction seam.
- Backend reads arbitrary paths via a custom command (not the fs-plugin ACL);
  only the folder picker needs the `dialog` capability.
