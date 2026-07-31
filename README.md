# vledger

Visual analysis of the UK crypto **Capital Gains** reconstruction — the third
sibling to **nledger** (Bitcoin/Lightning) and **xledger** (exchange store).

vledger keeps **no store of its own**. It reads the *same source files*
xledger's reconstruction produces, straight off disk, and renders them as a
full-screen dashboard: realised vs. taxable gain by year, firm vs. provisional
exposure, gain by asset, the **S104 pool** visualised, and every transaction
classified (including where **nledger**'s on-chain/Lightning spends resolve the
open "spend vs. transfer" decisions).

## Data

Point it at the **`reconstruction`** folder (inside
`accounting.master/accounting/`). On first run it auto-detects
`~/Documents/accounting.master/accounting/reconstruction` if present; otherwise
use **Choose folder…**. The chosen path is remembered. It reads:

- `_cgt/SA108-summary.csv`, `_cgt/cgt-disposals-all.csv`, `_cgt/btc-s104-ledger.csv`
- `<venue>/<venue>-canonical.csv` for each venue

Nothing is written; **the data never leaves the machine**. Source lives in git,
data lives in the Proton share — same split as the other two apps.

## Build (Linux)

```bash
make deps      # npm install + cargo fetch
make dev       # hot-reload
make build     # release binary -> src-tauri/target/release/vledger
make install   # -> ~/.local (bin + .desktop + icon)
```

Prereqs: Rust stable, Node 20+, and the Tauri v2 Linux deps
(`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
build-essential curl file`). Release via a `v*` tag → CI builds `.deb` + `.dmg`.
