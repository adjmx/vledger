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
  live in the reconstruction CSVs.
- Backend reads arbitrary paths via a custom command (not the fs-plugin ACL);
  only the folder picker needs the `dialog` capability.
