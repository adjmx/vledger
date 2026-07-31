// vledger dashboard — reads the reconstruction files (via Rust), aggregates them
// in the browser, and draws the same panels as the standalone HTML dashboard.
// One module: parse → aggregate → render. No framework; hand-drawn SVG.

import { Recon, defaultRoot, loadReconstruction, pickFolder } from "./lib/tauri";

/* ===================== CSV ===================== */
// Minimal RFC-4180 parser: quoted fields, "" escapes, commas/newlines in quotes.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQ = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1)
    .filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""))
    .map((r) => {
      const o: Record<string, string> = {};
      head.forEach((h, i) => (o[h] = r[i] ?? ""));
      return o;
    });
}
const num = (v: string | undefined): number => {
  const n = parseFloat((v ?? "").replace(/[, ]/g, ""));
  return isNaN(n) ? 0 : n;
};

/* ===================== aggregation ===================== */
export interface Year {
  ty: string; disposals: number; proceeds: number; costs: number;
  gains: number; losses: number; net: number; aea: number; prov: number; taxable: number;
}
export interface FP { ty: string; firm: number; prov: number; }
export interface AssetGain { asset: string; gain: number; n: number; firm: number; prov: number; }
export interface Bucket { label: string; n: number; }
export interface PoolPt { date: string; avg: number; }
export interface HoldPt { m: string; qty: number; }
export interface Dash {
  years: Year[]; yearFP: FP[]; byAsset: AssetGain[];
  cgtClass: Bucket[]; reasons: Bucket[];
  btcPool: PoolPt[]; btcHold: HoldPt[];
  totals: Record<string, number>;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function aggregate(r: Recon): Dash {
  const years: Year[] = [];
  if (r.sa108) for (const row of parseCsv(r.sa108)) {
    const net = num(row.net_gain), aea = num(row.aea_reference);
    years.push({
      ty: row.tax_year, disposals: num(row.box14_disposals), proceeds: num(row.box15_proceeds),
      costs: num(row.box16_costs), gains: num(row.box17_gains_before_losses), losses: num(row.box18_losses),
      net, aea, prov: num(row.provisional_disposals), taxable: round2(Math.max(0, net - aea)),
    });
  }

  const disp = r.disposals ? parseCsv(r.disposals) : [];
  // firm vs provisional by year
  const fpMap = new Map<string, { firm: number; prov: number }>();
  for (const d of disp) {
    const k = d.tax_year, g = num(d.gain_gbp);
    const e = fpMap.get(k) ?? { firm: 0, prov: 0 };
    if (d.provisional === "yes") e.prov += g; else e.firm += g;
    fpMap.set(k, e);
  }
  const yearFP: FP[] = [...fpMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ty, v]) => ({ ty, firm: round2(v.firm), prov: round2(v.prov) }));

  // by asset
  const aMap = new Map<string, AssetGain>();
  for (const d of disp) {
    const a = d.asset, g = num(d.gain_gbp);
    const e = aMap.get(a) ?? { asset: a, gain: 0, n: 0, firm: 0, prov: 0 };
    e.gain += g; e.n += 1;
    if (d.provisional === "yes") e.prov += g; else e.firm += g;
    aMap.set(a, e);
  }
  const byAsset = [...aMap.values()]
    .map((e) => ({ ...e, gain: round2(e.gain), firm: round2(e.firm), prov: round2(e.prov) }))
    .sort((a, b) => b.gain - a.gain);

  // canonical rows: classification + reason buckets + BTC holdings
  const allTx: Record<string, string>[] = [];
  for (const cf of r.canonical) for (const row of parseCsv(cf.csv)) allTx.push(row);

  const classMap = new Map<string, number>();
  for (const t of allTx) {
    const k = t.cgt_class && t.cgt_class.trim() ? t.cgt_class : "(blank)";
    classMap.set(k, (classMap.get(k) ?? 0) + 1);
  }
  const classOrder = ["acquisition", "transfer", "pending", "none", "disposal"];
  const cgtClass: Bucket[] = [...classMap.entries()]
    .sort((a, b) => (classOrder.indexOf(a[0]) + 99) % 100 - (classOrder.indexOf(b[0]) + 99) % 100 || b[1] - a[1])
    .map(([k, n]) => ({ label: k, n }));

  const B = {
    tOut: "Transfer out — own custody (cross-link on-chain)",
    tIn: "Transfer in — cost basis at source",
    ln: "Lightning send — SPEND vs TRANSFER (nledger)",
    c2c: "Crypto-to-crypto — needs GBP spot",
    fiat: "Fiat funding — cross-link to bank",
    other: "Other pending",
  };
  const rc: Record<string, number> = {};
  for (const t of allTx) {
    const nt = (t.note ?? "").toLowerCase();
    let key = "";
    if (nt.includes("own custody")) key = B.tOut;
    else if (nt.includes("from external")) key = B.tIn;
    else if (nt.includes("lightning send")) key = B.ln;
    else if (nt.includes("crypto-to-crypto")) key = B.c2c;
    else if (nt.includes("fiat funding")) key = B.fiat;
    else if (t.cgt_class === "pending") key = B.other;
    if (key) rc[key] = (rc[key] ?? 0) + 1;
  }
  const reasons: Bucket[] = Object.entries(rc).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);

  // BTC pool avg cost from the S104 ledger
  const poolMap = new Map<string, number>();
  if (r.btcLedger) for (const row of parseCsv(r.btcLedger)) {
    const m = /pool @ £([\d,]+\.\d+)\/BTC/.exec(row.matched_against ?? "");
    if (m) poolMap.set(row.disposal_date, parseFloat(m[1].replace(/,/g, "")));
  }
  const btcPool: PoolPt[] = [...poolMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, avg]) => ({ date, avg }));

  // BTC holdings over time (replay acquisitions/disposals), monthly
  const btcRows = allTx.filter((t) => t.asset === "BTC" && t.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  let runq = 0;
  const monthly = new Map<string, number>();
  for (const t of btcRows) {
    const q = Math.abs(num(t.qty));
    if (t.cgt_class === "acquisition") runq += q;
    else if (t.cgt_class === "disposal") runq -= q;
    monthly.set(t.date.slice(0, 7), round2(runq * 1e6) / 1e6);
  }
  const btcHold: HoldPt[] = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, qty]) => ({ m, qty }));

  const totals = {
    total_gain: round2(byAsset.reduce((s, a) => s + a.gain, 0)),
    firm: round2(yearFP.reduce((s, y) => s + y.firm, 0)),
    prov: round2(yearFP.reduce((s, y) => s + y.prov, 0)),
    disposals: years.reduce((s, y) => s + y.disposals, 0),
    prov_disposals: disp.filter((d) => d.provisional === "yes").length,
    taxable_total: round2(years.reduce((s, y) => s + y.taxable, 0)),
    tx_total: allTx.length,
    venues: r.canonical.length,
    pending_tx: allTx.filter((t) => t.cgt_class === "pending").length,
  };

  return { years, yearFP, byAsset, cgtClass, reasons, btcPool, btcHold, totals };
}

/* ===================== drawing helpers ===================== */
const NS = "http://www.w3.org/2000/svg";
type Attrs = Record<string, string | number>;
function E(tag: string, a: Attrs = {}): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in a) e.setAttribute(k, String(a[k]));
  return e;
}
const gbp0 = (v: number) => "£" + Math.round(v).toLocaleString("en-GB");
const gbp2 = (v: number) => "£" + v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function css(n: string): string {
  const root = document.querySelector(".viz-root");
  return root ? getComputedStyle(root).getPropertyValue(n).trim() : "";
}
let tip: HTMLElement;
function showTip(html: string, ev: { clientX: number; clientY: number }) { tip.innerHTML = html; tip.style.opacity = "1"; moveTip(ev); }
function moveTip(ev: { clientX: number; clientY: number }) {
  const p = 12; let x = ev.clientX + p, y = ev.clientY + p;
  const r = tip.getBoundingClientRect();
  if (x + r.width > innerWidth) x = ev.clientX - r.width - p;
  if (y + r.height > innerHeight) y = ev.clientY - r.height - p;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
function hideTip() { tip.style.opacity = "0"; }
function hook(el: SVGElement, html: string) {
  el.classList.add("bar-interactive");
  el.addEventListener("mousemove", (e) => showTip(html, e as MouseEvent));
  el.addEventListener("mouseleave", hideTip);
}
function svgFrame(W: number, H: number): SVGElement {
  const svg = E("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMinYMin meet" });
  if (W < 520) (svg as SVGElement & { style: CSSStyleDeclaration }).style.minWidth = W + "px";
  return svg;
}
function el(id: string): HTMLElement { return document.getElementById(id) as HTMLElement; }

/* ===================== charts ===================== */
function chartTaxable(d: Dash) {
  const host = el("c1"); host.innerHTML = "";
  const ys = d.years, W = 880, H = 340, m = { t: 24, r: 16, b: 46, l: 60 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxV = Math.max(...ys.map((y) => Math.max(y.net, y.aea))) * 1.08;
  const minV = Math.min(0, ...ys.map((y) => y.net)) * 1.15;
  const Y = (v: number) => m.t + ih * (maxV - v) / (maxV - minV);
  const bw = iw / ys.length, bar = Math.min(56, bw * 0.56);
  const svg = svgFrame(W, H);
  const step = maxV > 12000 ? 4000 : 2000;
  for (let g = Math.ceil(minV / step) * step; g <= maxV; g += step) {
    svg.appendChild(E("line", { class: "gridline", x1: m.l, x2: m.l + iw, y1: Y(g), y2: Y(g) }));
    const tx = E("text", { x: m.l - 8, y: Y(g) + 4, "text-anchor": "end", "font-size": 11 }); tx.textContent = gbp0(g); svg.appendChild(tx);
  }
  svg.appendChild(E("line", { x1: m.l, x2: m.l + iw, y1: Y(0), y2: Y(0), stroke: css("--text-muted") }));
  ys.forEach((yr, i) => {
    const cx = m.l + bw * i + bw / 2, x0 = cx - bar / 2;
    if (yr.net >= 0) {
      const shelt = Math.min(yr.net, yr.aea), tax = Math.max(0, yr.net - yr.aea);
      if (shelt > 0) svg.appendChild(E("rect", { x: x0, y: Y(shelt), width: bar, height: Math.max(0, Y(0) - Y(shelt)), rx: 3, fill: css("--neutral-fill") }));
      if (tax > 0) {
        const yt = Y(yr.net), hb = Y(yr.aea) - yt - 2;
        svg.appendChild(E("rect", { x: x0, y: yt, width: bar, height: Math.max(0, hb), rx: 4, fill: css("--series-1") }));
        const lab = E("text", { x: cx, y: yt - 6, "text-anchor": "middle", "font-size": 12, class: "val-label" }); lab.textContent = gbp0(tax); svg.appendChild(lab);
      }
      const ay = Y(Math.min(yr.aea, yr.net)), sdiamond = 5;
      svg.appendChild(E("path", { d: `M ${cx} ${ay - sdiamond} L ${cx + sdiamond} ${ay} L ${cx} ${ay + sdiamond} L ${cx - sdiamond} ${ay} Z`, fill: "none", stroke: css("--text-secondary"), "stroke-width": 1.4 }));
    } else {
      svg.appendChild(E("rect", { x: x0, y: Y(0), width: bar, height: Math.max(0, Y(yr.net) - Y(0)), rx: 4, fill: css("--critical") }));
      const lab = E("text", { x: cx, y: Y(yr.net) + 16, "text-anchor": "middle", "font-size": 11, fill: css("--critical") }); lab.textContent = gbp0(yr.net); svg.appendChild(lab);
    }
    const xl = E("text", { x: cx, y: H - m.b + 20, "text-anchor": "middle", "font-size": 11.5 }); xl.textContent = yr.ty; svg.appendChild(xl);
    const hit = E("rect", { x: x0 - 6, y: m.t, width: bar + 12, height: ih, fill: "transparent" });
    hook(hit, `<b>${yr.ty}</b><br>Net gain: <b>${gbp2(yr.net)}</b><br>Allowance (AEA): ${gbp0(yr.aea)}<br><span style="color:${css("--series-1")}">Taxable: <b>${gbp2(yr.taxable)}</b></span><br><span class="muted">${yr.disposals} disposals · ${yr.prov} provisional</span>`);
    svg.appendChild(hit);
  });
  host.appendChild(svg);
}

function chartFirmProv(d: Dash) {
  const host = el("c2"); host.innerHTML = "";
  const sw = el("hatchsw");
  sw.style.background = `repeating-linear-gradient(45deg, ${css("--warning-fill")}, ${css("--warning-fill")} 3px, transparent 3px, transparent 6px)`;
  sw.style.border = "1px solid " + css("--warning-fill");
  const ys = d.yearFP, W = 880, H = 320, m = { t: 24, r: 16, b: 46, l: 60 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxV = Math.max(...ys.map((x) => Math.max(x.firm, x.prov))) * 1.1;
  const minV = Math.min(0, ...ys.map((x) => Math.min(x.firm, x.prov))) * 1.2;
  const Y = (v: number) => m.t + ih * (maxV - v) / (maxV - minV);
  const svg = svgFrame(W, H);
  const defs = E("defs"); const pat = E("pattern", { id: "hatch", width: 6, height: 6, patternTransform: "rotate(45)", patternUnits: "userSpaceOnUse" });
  pat.appendChild(E("rect", { width: 6, height: 6, fill: css("--warning-fill"), opacity: .22 }));
  pat.appendChild(E("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: css("--warning-fill"), "stroke-width": 3 })); defs.appendChild(pat); svg.appendChild(defs);
  const step = 4000;
  for (let g = Math.ceil(minV / step) * step; g <= maxV; g += step) {
    svg.appendChild(E("line", { class: "gridline", x1: m.l, x2: m.l + iw, y1: Y(g), y2: Y(g) }));
    const tx = E("text", { x: m.l - 8, y: Y(g) + 4, "text-anchor": "end", "font-size": 11 }); tx.textContent = gbp0(g); svg.appendChild(tx);
  }
  svg.appendChild(E("line", { x1: m.l, x2: m.l + iw, y1: Y(0), y2: Y(0), stroke: css("--text-muted") }));
  const bw = iw / ys.length, gb = Math.min(24, bw * 0.28);
  ys.forEach((yr, i) => {
    const cx = m.l + bw * i + bw / 2;
    const drawBar = (v: number, xoff: number, fill: string, hatch: boolean) => {
      if (Math.abs(v) < 0.005) return;
      const yy = Math.min(Y(v), Y(0)), h = Math.abs(Y(v) - Y(0));
      const rr = E("rect", { x: cx + xoff, y: yy, width: gb, height: Math.max(0, h), rx: 3, fill });
      if (hatch) { rr.setAttribute("stroke", css("--warning-fill")); rr.setAttribute("stroke-width", "1"); }
      svg.appendChild(rr);
    };
    drawBar(yr.firm, -gb - 2, css("--series-1"), false);
    drawBar(yr.prov, 2, "url(#hatch)", true);
    const xl = E("text", { x: cx, y: H - m.b + 20, "text-anchor": "middle", "font-size": 11.5 }); xl.textContent = yr.ty; svg.appendChild(xl);
    const hit = E("rect", { x: cx - gb - 4, y: m.t, width: gb * 2 + 8, height: ih, fill: "transparent" });
    hook(hit, `<b>${yr.ty}</b><br>Firm: <b>${gbp2(yr.firm)}</b><br><span style="color:${css("--warning")}">Provisional: <b>${gbp2(yr.prov)}</b></span>`);
    svg.appendChild(hit);
  });
  host.appendChild(svg);
}

function chartByAsset(d: Dash) {
  const host = el("c3"); host.innerHTML = "";
  const rows = d.byAsset.filter((a) => a.n > 0), W = 880, rowH = 34, m = { t: 10, r: 150, l: 64, b: 28 };
  const H = m.t + m.b + rows.length * rowH, iw = W - m.l - m.r;
  const maxA = Math.max(...rows.map((a) => Math.abs(a.gain))) * 1.05 || 1;
  const X = (v: number) => m.l + iw / 2 + (v / maxA) * (iw / 2);
  const svg = svgFrame(W, H);
  svg.appendChild(E("line", { x1: X(0), x2: X(0), y1: m.t, y2: H - m.b, stroke: css("--text-muted") }));
  rows.forEach((a, i) => {
    const cy = m.t + i * rowH + rowH / 2, pos = a.gain >= 0;
    const x0 = pos ? X(0) : X(a.gain), w = Math.abs(X(a.gain) - X(0));
    const provy = Math.abs(a.prov) > Math.abs(a.firm) && a.n > 1;
    const rr = E("rect", { x: x0, y: cy - 9, width: Math.max(1, w), height: 18, rx: 4, fill: pos ? css("--series-1") : css("--critical") });
    hook(rr, `<b>${a.asset}</b> · ${a.n} disposal${a.n > 1 ? "s" : ""}<br>Net gain: <b>${gbp2(a.gain)}</b><br>Firm: ${gbp2(a.firm)}<br><span style="color:${css("--warning")}">Provisional: ${gbp2(a.prov)}</span>`);
    svg.appendChild(rr);
    const al = E("text", { x: m.l - 10, y: cy + 4, "text-anchor": "end", "font-size": 12.5, class: "val-label" }); al.textContent = a.asset; svg.appendChild(al);
    const vl = E("text", { x: pos ? X(a.gain) + 8 : X(a.gain) - 8, y: cy + 4, "text-anchor": pos ? "start" : "end", "font-size": 12, class: "val-label" });
    vl.textContent = gbp0(a.gain) + (provy ? "  ⚠" : ""); if (provy) vl.setAttribute("fill", css("--warning")); svg.appendChild(vl);
  });
  host.appendChild(svg);
}

function lineChart(hostId: string, pts: { t: number; label: string }[], vals: number[], fmtY: (v: number) => string, tips: string[], color: string) {
  const host = el(hostId); host.innerHTML = "";
  const W = 520, H = 250, m = { t: 18, r: 54, b: 34, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xmin = Math.min(...pts.map((p) => p.t)), xmax = Math.max(...pts.map((p) => p.t));
  const ymax = Math.max(...vals) * 1.08, ymin = Math.min(...vals, 0);
  const X = (v: number) => m.l + iw * (v - xmin) / ((xmax - xmin) || 1);
  const Y = (v: number) => m.t + ih * (ymax - v) / ((ymax - ymin) || 1);
  const svg = svgFrame(W, H); (svg as SVGElement & { style: CSSStyleDeclaration }).style.minWidth = "300px";
  const mag = Math.pow(10, Math.floor(Math.log10(ymax || 1)));
  const step = mag * ((ymax / mag) > 5 ? 2 : 1);
  for (let g = Math.ceil(ymin / step) * step; g <= ymax; g += step) {
    svg.appendChild(E("line", { class: "gridline", x1: m.l, x2: m.l + iw, y1: Y(g), y2: Y(g) }));
    const tx = E("text", { x: m.l - 6, y: Y(g) + 4, "text-anchor": "end", "font-size": 10.5 }); tx.textContent = fmtY(g); svg.appendChild(tx);
  }
  let dstr = "";
  pts.forEach((p, i) => { const px = X(p.t), py = Y(vals[i]); dstr += i ? ` L ${px} ${py}` : `M ${px} ${py}`; });
  svg.appendChild(E("path", { d: `${dstr} L ${X(xmax)} ${Y(ymin)} L ${X(xmin)} ${Y(ymin)} Z`, fill: color, opacity: .12 }));
  svg.appendChild(E("path", { d: dstr, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }));
  const li = pts.length - 1;
  const endl = E("text", { x: X(pts[li].t) + 6, y: Y(vals[li]) + 4, "font-size": 11, class: "val-label" }); endl.textContent = fmtY(vals[li]); svg.appendChild(endl);
  [0, li].forEach((k) => { const tx = E("text", { x: X(pts[k].t), y: H - m.b + 18, "text-anchor": "middle", "font-size": 10.5 }); tx.textContent = pts[k].label; svg.appendChild(tx); });
  pts.forEach((p, i) => {
    const px = X(p.t), py = Y(vals[i]);
    svg.appendChild(E("circle", { cx: px, cy: py, r: 3.5, fill: color }));
    const hit = E("circle", { cx: px, cy: py, r: 9, fill: "transparent" }); hook(hit, tips[i]); svg.appendChild(hit);
  });
  host.appendChild(svg);
}

function chartClass(d: Dash) {
  const host = el("c5"); host.innerHTML = "";
  const leg = el("c5leg"); leg.innerHTML = "";
  const segs = d.cgtClass, tot = segs.reduce((s, x) => s + x.n, 0) || 1;
  const colors: Record<string, string> = {
    acquisition: css("--series-1"), transfer: css("--series-3"), pending: css("--warning-fill"),
    none: css("--neutral-fill"), disposal: css("--series-2"), "(blank)": css("--neutral-fill"),
  };
  const labels: Record<string, string> = {
    acquisition: "Acquisition (buys)", transfer: "Transfer (not a disposal)", pending: "Pending decision",
    none: "Not chargeable", disposal: "Disposal (taxed)", "(blank)": "Unclassified",
  };
  const W = 880, H = 64, svg = svgFrame(W, H); (svg as SVGElement & { style: CSSStyleDeclaration }).style.minWidth = "520px";
  let x = 0;
  for (const seg of segs) {
    const w = seg.n / tot * W;
    if (w > 2) {
      const rr = E("rect", { x: x + 1, y: 14, width: w - 2, height: 34, rx: 5, fill: colors[seg.label] ?? css("--neutral-fill") });
      hook(rr, `<b>${labels[seg.label] ?? seg.label}</b><br>${seg.n} tx · ${(seg.n / tot * 100).toFixed(0)}%`); svg.appendChild(rr);
      if (w > 52) { const t = E("text", { x: x + w / 2, y: 35, "text-anchor": "middle", "font-size": 12, class: "val-label" }); t.textContent = String(seg.n); svg.appendChild(t); }
    }
    x += w;
  }
  host.appendChild(svg);
  for (const seg of segs) {
    const s = document.createElement("span");
    s.innerHTML = `<i class="swatch" style="background:${colors[seg.label] ?? css("--neutral-fill")}"></i> ${labels[seg.label] ?? seg.label}`;
    leg.appendChild(s);
  }
}

function chartReasons(d: Dash) {
  const host = el("c5b"); host.innerHTML = "";
  const rows = d.reasons.slice().sort((a, b) => b.n - a.n), max = Math.max(...rows.map((x) => x.n)) || 1;
  const isN = (s: string) => /nledger|own custody/i.test(s);
  for (const b of rows) {
    const row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:340px 1fr 44px;align-items:center;gap:10px;margin:6px 0;font-size:12.5px;";
    row.innerHTML = `<div style="color:var(--text-secondary)">${isN(b.label) ? "🔗 " : ""}${b.label}</div>
      <div style="background:var(--surface-2);border-radius:6px;height:16px;overflow:hidden">
        <div style="width:${b.n / max * 100}%;height:100%;background:${isN(b.label) ? css("--series-3") : css("--warning-fill")};border-radius:6px"></div></div>
      <div style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${b.n}</div>`;
    host.appendChild(row);
  }
  const note = document.createElement("div"); note.className = "hatch-note"; note.style.marginTop = "8px";
  note.innerHTML = '🔗 = resolved by cross-linking to <b>nledger</b> (on-chain / Lightning spends) — these decide whether crypto that left an exchange was <b>spent</b> (a disposal) or just <b>moved to your own wallet</b> (not taxable).';
  host.appendChild(note);
}

function drawAll(d: Dash) {
  chartTaxable(d); chartFirmProv(d); chartByAsset(d);
  lineChart("c4a", d.btcPool.map((p) => ({ t: Date.parse(p.date), label: p.date.slice(0, 7) })), d.btcPool.map((p) => p.avg),
    (v) => "£" + (v / 1000).toFixed(0) + "k", d.btcPool.map((p) => `<b>${p.date}</b><br>Pooled cost: <b>£${p.avg.toLocaleString("en-GB", { maximumFractionDigits: 2 })}</b> / BTC`), css("--series-1"));
  lineChart("c4b", d.btcHold.map((p) => ({ t: Date.parse(p.m + "-01"), label: p.m })), d.btcHold.map((p) => p.qty),
    (v) => v.toFixed(1), d.btcHold.map((p) => `<b>${p.m}</b><br>Held: <b>${p.qty.toFixed(4)} BTC</b>`), css("--series-3"));
  chartClass(d); chartReasons(d);
}

/* ===================== shell / markup ===================== */
const AEA_LINE = "AEAs: 2017/18 £11,300 · 18/19 £11,700 · 19/20 £12,000 · 20/21 £12,300 · 22/23 £12,300 · 24/25 & 25/26 £3,000.";

function tilesHtml(t: Record<string, number>): string {
  const tile = (lab: string, val: string, note: string, cls = "") =>
    `<div class="tile ${cls}"><div class="lab">${lab}</div><div class="val">${val}</div><div class="note">${note}</div></div>`;
  return tile("Realised gain (all years)", gbp0(t.total_gain), t.disposals + " disposals")
    + tile("Taxable after allowances", gbp0(t.taxable_total), "only years over the AEA", "accent")
    + tile("Provisional / at-risk", gbp0(t.prov), t.prov_disposals + " of " + t.disposals + " disposals", "warn")
    + tile("Pending classifications", String(t.pending_tx), "of " + t.tx_total + " transactions");
}

function dashboardHtml(root: string, d: Dash, missing: string[]): string {
  const warn = missing.length ? `<div class="banner">⚠ Missing source files (showing what's available): ${missing.join(", ")}</div>` : "";
  return `
  <div class="toolbar">
    <div class="kicker">vledger · UK Capital Gains · S104</div>
    <div class="grow"></div>
    <span class="rootpath" title="${root}">${root}</span>
    <button class="btn" id="btn-refresh">↻ Refresh</button>
    <button class="btn" id="btn-folder">Change folder…</button>
    <button class="btn" id="btn-theme">◐ Theme</button>
  </div>
  <h1>What the numbers actually say about the filing</h1>
  <p class="sub">${d.totals.venues} venues, ${d.totals.tx_total.toLocaleString("en-GB")} transactions, ${d.totals.disposals} CGT disposals
    reconstructed under UK rules (same-day → 30-day → S104 pool). The big number is the <b>realised gain</b>; the number that
    decides tax is what's left <b>after each year's exempt amount</b> — and a large slice is still <b>provisional</b>.</p>
  ${warn}
  <section class="tiles">${tilesHtml(d.totals)}</section>

  <section class="panel">
    <h2>1 · Realised gain vs. what's taxable, by tax year</h2>
    <p class="desc">Each bar is that year's <b>net gain</b>. The pale part is sheltered by the <b>annual exempt amount</b> (marked ◇) —
      you don't pay on it. Only the <b>blue</b> part is taxable. Years under the line, and the 2018/19 loss, cost nothing.</p>
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-1)"></i> Taxable (above allowance)</span>
      <span><i class="swatch" style="background:var(--neutral-fill)"></i> Sheltered by allowance</span>
      <span><i class="swatch" style="background:var(--critical)"></i> Net loss</span>
      <span>◇ Annual exempt amount</span>
    </div>
    <div class="chart-scroll"><div id="c1"></div></div>
  </section>

  <section class="panel">
    <h2>2 · How much of each year's gain is <span style="color:var(--warning)">provisional</span></h2>
    <p class="desc">Firm gains rest on confirmed records. <b>Provisional</b> gains (hatched) use a deemed or estimated cost basis and
      can move once records are checked. <b>2020/21 is the exposure</b> — most of its gain is provisional.</p>
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-1)"></i> Firm</span>
      <span><i class="swatch" id="hatchsw"></i> Provisional (needs verifying)</span>
    </div>
    <div class="chart-scroll"><div id="c2"></div></div>
  </section>

  <section class="panel">
    <h2>3 · Which coins drive the gain</h2>
    <p class="desc">Net realised gain per asset (all years). <b>⚠ marks assets whose gain is mostly provisional</b> — ETH especially.</p>
    <div class="legend">
      <span><i class="swatch" style="background:var(--series-1)"></i> Net gain</span>
      <span><i class="swatch" style="background:var(--critical)"></i> Net loss</span>
      <span style="color:var(--warning)">⚠ mostly provisional</span>
    </div>
    <div class="chart-scroll"><div id="c3"></div></div>
  </section>

  <section class="panel">
    <h2>4 · The S104 pool, visualised (BTC)</h2>
    <p class="desc"><b>Pooling</b> is the core UK rule: every BTC you buy melts into one pot with a single <b>average cost per coin</b>.
      When you sell, the cost is that blended average. Left: how the average cost climbed as you bought more. Right: BTC held over time.</p>
    <div class="grid2">
      <div><div class="hatch-note" style="margin-bottom:6px">Pooled average cost — £ per BTC</div><div class="chart-scroll"><div id="c4a"></div></div></div>
      <div><div class="hatch-note" style="margin-bottom:6px">BTC held in the pool — quantity over time</div><div class="chart-scroll"><div id="c4b"></div></div></div>
    </div>
  </section>

  <section class="panel">
    <h2>5 · Every transaction, classified — and where nledger straps on</h2>
    <p class="desc">All ${d.totals.tx_total.toLocaleString("en-GB")} rows sorted into CGT roles. The <b>pending</b> ones are open decisions:
      crypto <b>leaving an exchange</b> is either a <b>disposal</b> (spent) or a <b>transfer to your own custody</b> (not taxable),
      resolved by cross-linking to <b>nledger</b> and to bank statements.</p>
    <div class="legend" id="c5leg"></div>
    <div class="chart-scroll"><div id="c5"></div></div>
    <div style="margin-top:20px">
      <div class="hatch-note" style="margin-bottom:8px">Open classification decisions & cross-link work (the “incomplete data”):</div>
      <div id="c5b"></div>
    </div>
  </section>

  <div class="foot">Source: reconstruction files under <code>${root}</code>. Method: same-day → 30-day → S104 pool;
    transfers excluded; c2c & external legs at exact-day market (Coin Metrics → Bank of England). ${AEA_LINE}
    Figures are a working reconstruction for review, not filed values.</div>`;
}

function emptyHtml(msg: string): string {
  return `<div class="empty">
    <div class="kicker">vledger</div>
    <h1>Point vledger at your reconstruction folder</h1>
    <p>${msg} Pick the <code>reconstruction</code> directory inside
      <code>accounting.master/accounting/</code> — the one containing <code>_cgt/</code> and the per-venue folders.</p>
    <button class="btn primary" id="btn-pick">Choose folder…</button>
  </div>`;
}

/* ===================== boot / orchestration ===================== */
const LS_ROOT = "vledger.root";
const LS_THEME = "vledger.theme";
let current: Dash | null = null;
let app: HTMLElement;

function currentTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem(LS_THEME, next); } catch { /* ignore */ }
  if (current) drawAll(current); // recolor SVGs against the new surface
}

async function loadAndRender(root: string) {
  app.innerHTML = `<div class="empty"><div class="kicker">vledger</div><h1>Loading…</h1><p>Reading ${root}</p></div>`;
  let recon: Recon;
  try {
    recon = await loadReconstruction(root);
  } catch (e) {
    app.innerHTML = emptyHtml(`Could not read that folder (${String(e)}).`);
    wireEmpty();
    return;
  }
  try { localStorage.setItem(LS_ROOT, root); } catch { /* ignore */ }
  if (!recon.sa108 && !recon.disposals && !recon.canonical.length) {
    app.innerHTML = emptyHtml("That folder has no reconstruction files.");
    wireEmpty();
    return;
  }
  current = aggregate(recon);
  app.innerHTML = dashboardHtml(recon.root, current, recon.missing);
  drawAll(current);
  el("btn-refresh").addEventListener("click", () => loadAndRender(root));
  el("btn-folder").addEventListener("click", pickAndLoad);
  el("btn-theme").addEventListener("click", toggleTheme);
}

async function pickAndLoad() {
  const start = (() => { try { return localStorage.getItem(LS_ROOT) ?? undefined; } catch { return undefined; } })();
  const picked = await pickFolder(start);
  if (picked) loadAndRender(picked);
}

function wireEmpty() {
  const b = document.getElementById("btn-pick");
  if (b) b.addEventListener("click", pickAndLoad);
}

export async function boot() {
  app = el("app");
  app.className = "viz-root";
  const wrap = document.createElement("div"); wrap.className = "wrap"; wrap.id = "wrap";
  app.appendChild(wrap);
  app = wrap; // render into .wrap
  tip = document.createElement("div"); tip.className = "tip"; document.body.appendChild(tip);

  let root: string | null = null;
  try { root = localStorage.getItem(LS_ROOT); } catch { /* ignore */ }
  if (!root) root = await defaultRoot();
  if (root) loadAndRender(root);
  else { app.innerHTML = emptyHtml("No folder chosen yet."); wireEmpty(); }
}
