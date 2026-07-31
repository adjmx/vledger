// Typed wrappers around vledger's two Rust commands (src-tauri/src/lib.rs),
// plus the folder picker (handled entirely in the webview via the dialog plugin).

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Raw source files read from the reconstruction folder. */
export interface Recon {
  root: string;
  sa108: string | null;
  disposals: string | null;
  btcLedger: string | null;
  canonical: { venue: string; csv: string }[];
  missing: string[];
}

/** Best-guess reconstruction dir on this machine, or null. */
export function defaultRoot(): Promise<string | null> {
  return invoke<string | null>("default_root");
}

/** Read every source file the dashboard needs from `root`. */
export function loadReconstruction(root: string): Promise<Recon> {
  return invoke<Recon>("load_reconstruction", { root });
}

/** Native folder picker → chosen path, or null if cancelled. */
export async function pickFolder(start?: string): Promise<string | null> {
  const res = await open({
    directory: true,
    multiple: false,
    title: "Pick the reconstruction folder",
    defaultPath: start,
  });
  return typeof res === "string" ? res : null;
}
