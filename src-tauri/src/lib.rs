// vledger — read-only visual analysis over the UK crypto CGT reconstruction.
//
// Sibling to nledger (Bitcoin/LN) and xledger (exchange store). vledger keeps NO
// store of its own: it reads the SAME source files xledger's reconstruction
// produces, straight off disk, and the frontend does the aggregation + charts.
// That's the whole backend — two commands: guess the root, and read the files.
//
// Source layout it expects (the `accounting.master/.../reconstruction` dir):
//   <root>/_cgt/SA108-summary.csv        — per-year SA108 boxes + AEA
//   <root>/_cgt/cgt-disposals-all.csv    — every computed disposal
//   <root>/_cgt/btc-s104-ledger.csv      — BTC S104 pool ledger (pool avg cost)
//   <root>/<venue>/<venue>-canonical.csv — per-venue canonical transactions

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalFile {
    venue: String,
    csv: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Recon {
    root: String,
    sa108: Option<String>,
    disposals: Option<String>,
    btc_ledger: Option<String>,
    canonical: Vec<CanonicalFile>,
    /// Source files that were expected but not found (surfaced in the UI).
    missing: Vec<String>,
}

fn read_opt(p: &Path) -> Option<String> {
    fs::read_to_string(p).ok()
}

/// Best-guess reconstruction dir on this machine, or None if it isn't there.
/// Both Linux and macOS keep it under ~/Documents/accounting.master.
#[tauri::command]
fn default_root() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let p = PathBuf::from(home).join("Documents/accounting.master/accounting/reconstruction");
    if p.join("_cgt").is_dir() {
        Some(p.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// Read every source file the dashboard needs from `root`. Missing files are
/// reported (not fatal) so the UI can render what it has and flag the rest.
#[tauri::command]
fn load_reconstruction(root: String) -> Result<Recon, String> {
    let base = PathBuf::from(&root);
    if !base.is_dir() {
        return Err(format!("Not a folder: {root}"));
    }
    let cgt = base.join("_cgt");
    let mut missing = Vec::new();

    let mut need = |rel: &str, opt: &Option<String>| {
        if opt.is_none() {
            missing.push(rel.to_string());
        }
    };
    let sa108 = read_opt(&cgt.join("SA108-summary.csv"));
    need("_cgt/SA108-summary.csv", &sa108);
    let disposals = read_opt(&cgt.join("cgt-disposals-all.csv"));
    need("_cgt/cgt-disposals-all.csv", &disposals);
    let btc_ledger = read_opt(&cgt.join("btc-s104-ledger.csv"));
    need("_cgt/btc-s104-ledger.csv", &btc_ledger);

    // Canonical CSVs: each venue is a subdir <name>/ holding <name>-canonical.csv.
    // Dirs beginning with '_' (like _cgt, _crosslink) are tooling, not venues.
    let mut canonical = Vec::new();
    if let Ok(rd) = fs::read_dir(&base) {
        let mut names: Vec<String> = rd
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with('_') && !n.starts_with('.'))
            .collect();
        names.sort();
        for name in names {
            let f = base.join(&name).join(format!("{name}-canonical.csv"));
            if let Some(csv) = read_opt(&f) {
                canonical.push(CanonicalFile { venue: name, csv });
            }
        }
    }

    Ok(Recon {
        root,
        sa108,
        disposals,
        btc_ledger,
        canonical,
        missing,
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![default_root, load_reconstruction])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
