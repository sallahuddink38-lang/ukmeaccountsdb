/* =====================================================================
   REPORTS (reports.js) — Odoo-style reporting menu
   Part 1: shared helpers, Statement Reports, Ledgers.
   Part 2 (reports2.js): Partner reports, Taxes & Fiscal, Management.
   ===================================================================== */

const REPORTS = {};          // viewId -> { group, title, sub, render }
const EXTRA_VIEWS = {};      // viewId -> { title, sub, render, actions }  (journal entries, assets, loans…)
const REPORT_GROUPS = [
  ["Statement Reports", ["rep_balance", "rep_pl", "rep_cashflow", "rep_depr"]],
  ["Ledgers",           ["rep_trial", "rep_gl"]],
  ["Partner Reports",   ["rep_partner", "rep_custstmt", "rep_agedrec", "rep_agedpay"]],
  ["Taxes & Fiscal",    ["rep_tax", "rep_fiscal"]],
  ["Management",        ["rep_invanalysis", "rep_cfanalysis", "rep_analytic", "rep_exec", "rep_loans"]]
];
function defReport(id, title, sub, fn){ REPORTS[id] = { title, sub, render:fn }; titles[id] = [title, sub]; }

/* ---------- number / table helpers ---------- */
function nf(v){
  v = round2(v);
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
  return (v < 0 ? "-" : "") + s;
}
function nfz(v){ return Math.abs(v) < 0.005 ? "" : nf(v); }
function tdn(v, extra){ return `<td class="right mono${v < -0.004 ? " rp-neg" : ""}" ${extra || ""}>${nf(v)}</td>`; }
function pct(a, b){ return b ? (a / b * 100).toFixed(1) + "%" : "—"; }
function panel(title, bodyHtml, noteHtml, rightHtml){
  return `<div class="panel">${title ? `<div class="panel-head"><h2>${title}</h2>${rightHtml || ""}</div>` : ""}<div class="panel-body">${bodyHtml}</div>${noteHtml ? `<div class="tb-note">${noteHtml}</div>` : ""}</div>`;
}
function emptyRow(cols, msg){ return `<tr><td colspan="${cols}" style="text-align:center;color:var(--muted);padding:22px 0;">${msg || "No data for this selection."}</td></tr>`; }

/* statement-style table: rows = {t:"sec"|"row"|"total"|"grand", label, vals[], indent} */
function stmtTable(cols, rows, note){
  const n = cols.length;
  const body = rows.map(r => {
    if(r.t === "sec") return `<tr class="rp-sec"><td colspan="${n + 1}">${r.label}</td></tr>`;
    const cls = r.t === "total" ? "rp-total" : r.t === "grand" ? "rp-grand" : "";
    return `<tr class="${cls}"><td style="padding-left:${14 + (r.indent || 0) * 18}px">${r.label}</td>${r.vals.map(v => tdn(v)).join("")}</tr>`;
  }).join("");
  return panel("", `<table class="grid rp-stmt"><thead><tr><th></th>${cols.map(c => `<th class="right">${c}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`, note);
}

/* ---------- toolbar (period, currency, compare…) ---------- */
function rpPresetRange(p){
  const t = toISO(new Date()), fs = fyStartISO(t);
  if(p === "fy") return [fs, t];
  if(p === "lastfy") return [addMonthsISO(fs, -12), addDaysISO(fs, -1)];
  if(p === "month") return [t.slice(0, 8) + "01", t];
  if(p === "lastmonth"){ const e = addDaysISO(t.slice(0, 8) + "01", -1); return [e.slice(0, 8) + "01", e]; }
  if(p === "quarter"){
    const d = parseDate(t), f = parseDate(fs);
    const md = (d.getFullYear() - f.getFullYear()) * 12 + d.getMonth() - f.getMonth();
    return [addMonthsISO(fs, Math.floor(md / 3) * 3), t];
  }
  if(p === "12m") return [addDaysISO(addMonthsISO(t, -12), 1), t];
  if(p === "all") return ["2000-01-01", t];
  return null;
}
function repSet(k, v){
  repState[k] = v;
  if(k === "from" || k === "to") repState.preset = "custom";
  render();
}
function repPreset(p){
  repState.preset = p;
  const r = rpPresetRange(p);
  if(r){ repState.from = r[0]; repState.to = r[1]; }
  render();
}
function rpTools(o){
  repInit(); o = o || {};
  const curOpts = [["ALL", "Consolidated in " + curCode(baseCur()) + " (" + baseCur().trim() + ")"]].concat(usedCurrencies().map(c => [c, curCode(c) + " only"]));
  const sel = (id, opts, cur, fn) => `<select onchange="${fn}(this.value)">${opts.map(([v, l]) => `<option value="${escHtml(v)}" ${String(cur) === String(v) ? "selected" : ""}>${escHtml(l)}</option>`).join("")}</select>`;
  const presets = [["fy", "This fiscal year"], ["lastfy", "Last fiscal year"], ["quarter", "This quarter"], ["month", "This month"], ["lastmonth", "Last month"], ["12m", "Last 12 months"], ["all", "All time"], ["custom", "Custom"]];
  let h = '<div class="panel no-pdf"><div class="panel-body pad"><div class="rp-tools">';
  if(o.range){
    h += `<div class="field"><label>Period</label>${sel("p", presets, repState.preset, "repPreset")}</div>
          <div class="field"><label>From</label><input type="date" value="${repState.from}" onchange="repSet('from',this.value)"></div>
          <div class="field"><label>To</label><input type="date" value="${repState.to}" onchange="repSet('to',this.value)"></div>`;
  }
  if(o.asof) h += `<div class="field"><label>As of</label><input type="date" value="${repState.asOf}" onchange="repSet('asOf',this.value)"></div>`;
  if(o.cur !== false) h += `<div class="field"><label>Currency</label>${sel("c", curOpts, repState.cur, "repSetCur")}</div>`;
  if(o.compare) h += `<div class="field"><label>&nbsp;</label><label class="rp-check"><input type="checkbox" ${repState.compare ? "checked" : ""} onchange="repSet('compare',this.checked)"> ${o.compareLabel || "Compare with previous period"}</label></div>`;
  h += (o.extra || "") + "</div></div></div>";
  return h;
}
function repSetCur(v){ repState.cur = v; render(); }
function rpMeta(periodText){
  let fx = "";
  if(repState.cur === "ALL"){
    const others = usedCurrencies().filter(c => c !== baseCur());
    if(others.length){
      fx = " · FX: " + others.map(c => "1 " + curCode(c) + " = " + baseCur().trim() + " " + fxRate(c) + (fxMissing(c) ? " (rate not set!)" : "")).join(", ");
    }
  }
  return `<div class="rp-meta">${periodText} · Amounts in ${escHtml(vsym().trim())}${repState.cur === "ALL" ? " (consolidated)" : ""}${fx}</div>`;
}
function rpPeriodText(){ return `Period ${fmtDate(repState.from)} – ${fmtDate(repState.to)}`; }
function rpPrevRange(){
  const days = Math.round((parseDate(repState.to) - parseDate(repState.from)) / 86400000) + 1;
  const pTo = addDaysISO(repState.from, -1);
  return [addDaysISO(pTo, -(days - 1)), pTo];
}

/* ========================================================================
   STATEMENT REPORTS
   ======================================================================== */

/* ---------- Balance Sheet ---------- */
function rpBalanceSheet(){
  repInit();
  const lines = viewLines();
  const d1 = repState.asOf, d2 = addMonthsISO(d1, -12);
  const dates = repState.compare ? [d1, d2] : [d1];
  const data = dates.map(d => {
    const m = tbAt(lines, d);
    let earn = 0; m.forEach((v, c) => { if(isPL(c)) earn -= v; });
    return { m, earn };
  });
  const codes = new Set();
  data.forEach(x => x.m.forEach((v, c) => { if(!isPL(c) && Math.abs(v) > 0.004) codes.add(c); }));
  const list = [...codes].sort();
  const sel = pred => list.filter(c => pred(accInfo(c)));
  const acctRows = cs => cs.map(c => ({ t:"row", indent:1, label:escHtml(accName(c)), vals:data.map(x => natural(c, x.m.get(c) || 0)) }));
  const tot = cs => data.map(x => cs.reduce((s, c) => s + natural(c, x.m.get(c) || 0), 0));
  const add = (a, b) => a.map((v, i) => v + b[i]);

  const bank = sel(i => i.sub === "bank"), recv = sel(i => i.sub === "receivable"), curA = sel(i => i.type === "asset" && i.sub === "current");
  const fixed = sel(i => i.sub === "fixed");
  const curL = sel(i => i.type === "liability" && (i.sub === "current" || i.sub === "payable")), nonL = sel(i => i.type === "liability" && i.sub === "noncurrent");
  const eq = sel(i => i.type === "equity");

  const tBank = tot(bank), tRecv = tot(recv), tCurA = tot(curA), tFixed = tot(fixed);
  const totCurAssets = add(add(tBank, tRecv), tCurA);
  const totAssets = add(totCurAssets, tFixed);
  const tCurL = tot(curL), tNonL = tot(nonL), totLiab = add(tCurL, tNonL);
  const earn = data.map(x => x.earn);
  const totEq = add(tot(eq), earn);
  const diff = totAssets.map((a, i) => round2(a - totLiab[i] - totEq[i]));

  const rows = [
    { t:"sec", label:"ASSETS" },
    { t:"sec", label:"Current Assets" },
    { t:"row", indent:1, label:"<b>Bank &amp; Cash</b>", vals:tBank }, ...acctRows(bank).map(r => ({ ...r, indent:2 })),
    { t:"row", indent:1, label:"<b>Receivables</b>", vals:tRecv }, ...acctRows(recv).map(r => ({ ...r, indent:2 })),
    ...(curA.length ? [{ t:"row", indent:1, label:"<b>Other Current Assets</b>", vals:tCurA }, ...acctRows(curA).map(r => ({ ...r, indent:2 }))] : []),
    { t:"total", label:"Total Current Assets", vals:totCurAssets },
    { t:"sec", label:"Non-current Assets" }, ...acctRows(fixed),
    { t:"total", label:"Net Fixed Assets", vals:tFixed },
    { t:"grand", label:"TOTAL ASSETS", vals:totAssets },
    { t:"sec", label:"LIABILITIES" },
    { t:"sec", label:"Current Liabilities" }, ...acctRows(curL), { t:"total", label:"Total Current Liabilities", vals:tCurL },
    ...(nonL.length ? [{ t:"sec", label:"Non-current Liabilities" }, ...acctRows(nonL), { t:"total", label:"Total Non-current Liabilities", vals:tNonL }] : []),
    { t:"grand", label:"TOTAL LIABILITIES", vals:totLiab },
    { t:"sec", label:"EQUITY" }, ...acctRows(eq),
    { t:"row", indent:1, label:"Current Year Earnings", vals:earn },
    { t:"grand", label:"TOTAL EQUITY", vals:totEq },
    { t:"grand", label:"TOTAL LIABILITIES + EQUITY", vals:add(totLiab, totEq) }
  ];
  const ok = diff.every(d => Math.abs(d) < 0.01);
  const note = (ok ? "✓ Balanced — Total Assets equal Liabilities + Equity." : "⚠ Out of balance by " + nf(diff[0]) + " — check manual journal entries.")
    + " Retained earnings carry the result of earlier fiscal years (fiscal year starts " + MONTH_NAMES[fiscalStartMonth() - 1] + "). Depreciation is posted at each month end.";
  return rpTools({ asof:true, compare:true, compareLabel:"Compare with same date last year" }) + rpMeta("As of " + fmtDate(d1))
    + stmtTable(dates.map(d => fmtDate(d)), rows, note);
}

/* ---------- Profit and Loss ---------- */
function plNet(lines, from, to){
  const out = new Map();
  moveAgg(lines, from, to).forEach((e, c) => out.set(c, e.dr - e.cr));
  return out;
}
function rpProfitLoss(){
  repInit();
  const lines = viewLines();
  const ranges = [[repState.from, repState.to]];
  if(repState.compare) ranges.push(rpPrevRange());
  const data = ranges.map(r => plNet(lines, r[0], r[1]));
  const codes = new Set(); data.forEach(m => m.forEach((v, c) => { if(isPL(c) && Math.abs(v) > 0.004) codes.add(c); }));
  const list = [...codes].sort();
  const sel = pred => list.filter(c => pred(accInfo(c)));
  const rowsFor = (cs, sign) => cs.map(c => ({ t:"row", indent:1, label:escHtml(accName(c)), vals:data.map(m => sign * (m.get(c) || 0)) }));
  const tot = (cs, sign) => data.map(m => cs.reduce((s, c) => s + sign * (m.get(c) || 0), 0));
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const add = (a, b) => a.map((v, i) => v + b[i]);

  const inc = sel(i => i.type === "income" && i.sub !== "other"), cogs = sel(i => i.type === "expense" && i.sub === "cogs");
  const opex = sel(i => i.type === "expense" && i.sub === "opex"), oInc = sel(i => i.type === "income" && i.sub === "other"), oExp = sel(i => i.type === "expense" && i.sub === "other");
  const tInc = tot(inc, -1), tCogs = tot(cogs, 1), gross = sub(tInc, tCogs), tOpex = tot(opex, 1), opProfit = sub(gross, tOpex);
  const tOInc = tot(oInc, -1), tOExp = tot(oExp, 1), net = sub(add(opProfit, tOInc), tOExp);
  const rows = [
    { t:"sec", label:"Income" }, ...rowsFor(inc, -1), { t:"total", label:"Total Income", vals:tInc },
    { t:"sec", label:"Cost of Revenue (purchases)" }, ...rowsFor(cogs, 1), { t:"total", label:"Total Cost of Revenue", vals:tCogs },
    { t:"grand", label:"GROSS PROFIT", vals:gross },
    { t:"sec", label:"Operating Expenses" }, ...rowsFor(opex, 1), { t:"total", label:"Total Operating Expenses", vals:tOpex },
    { t:"grand", label:"OPERATING PROFIT", vals:opProfit },
    ...((oInc.length || oExp.length) ? [{ t:"sec", label:"Other Income / Expenses" }, ...rowsFor(oInc, -1), ...rowsFor(oExp, -1).map(r => r)] : []),
    { t:"grand", label:"NET PROFIT", vals:net }
  ];
  // "other expenses" were passed with sign -1 so they show as negatives under "Other Income / Expenses"
  const cols = ranges.map(r => fmtDate(r[0]) + " – " + fmtDate(r[1]));
  const margin = tInc[0] ? "Gross margin " + pct(gross[0], tInc[0]) + " · Net margin " + pct(net[0], tInc[0]) : "";
  return rpTools({ range:true, compare:true }) + rpMeta(rpPeriodText())
    + stmtTable(cols, rows, "Accrual basis — income is recognised on the invoice date and purchases on the purchase-order date. " + margin);
}

/* ---------- Cash Flow Statement (direct method, from the bank accounts) ---------- */
function cfCategory(code){
  const i = accInfo(code);
  if(code === "1100") return ["op", "Cash received from customers"];
  if(code === "2100") return ["op", "Cash paid to suppliers"];
  if(code === "1210" || code === "2210") return ["op", "VAT / tax received (paid)"];
  if(code === "4100" || code === "6100") return ["op", "Interest received (paid)"];
  if(i.sub === "fixed") return ["inv", "Purchase / sale of fixed assets"];
  if(code === "1300") return ["inv", "Loans given / collected"];
  if(code === "2300") return ["fin", "Loans received / repaid (principal)"];
  if(i.type === "equity") return ["fin", "Owner's capital / drawings"];
  if(i.type === "income" || i.type === "expense") return ["op", "Other operating income / expenses"];
  return ["op", "Other receipts / payments"];
}
function cfCompute(lines, from, to){
  const open = lines.filter(l => accInfo(l.acc).sub === "bank" && l.date < from).reduce((s, l) => s + l.dr - l.cr, 0);
  const inRange = lines.filter(l => l.date >= from && l.date <= to);
  const byMove = new Map();
  inRange.forEach(l => { if(!byMove.has(l.mid)) byMove.set(l.mid, []); byMove.get(l.mid).push(l); });
  const cats = { op:new Map(), inv:new Map(), fin:new Map() };
  let change = 0;
  byMove.forEach(ls => {
    const bankNet = ls.filter(l => accInfo(l.acc).sub === "bank").reduce((s, l) => s + l.dr - l.cr, 0);
    if(Math.abs(bankNet) < 0.004) return;
    change += bankNet;
    const counters = ls.filter(l => accInfo(l.acc).sub !== "bank").map(l => ({ acc:l.acc, w:Math.abs(l.dr - l.cr) })).filter(c => c.w > 0);
    const W = counters.reduce((s, c) => s + c.w, 0) || 1;
    counters.forEach(c => {
      const [k, label] = cfCategory(c.acc);
      cats[k].set(label, (cats[k].get(label) || 0) + bankNet * c.w / W);
    });
  });
  return { open, change, close:open + change, cats };
}
function rpCashFlow(){
  repInit();
  const lines = viewLines();
  const ranges = [[repState.from, repState.to]];
  if(repState.compare) ranges.push(rpPrevRange());
  const data = ranges.map(r => cfCompute(lines, r[0], r[1]));
  const labelsFor = k => { const s = new Set(); data.forEach(d => d.cats[k].forEach((v, l) => s.add(l))); return [...s]; };
  const block = (k, title, totalLabel) => {
    const ls = labelsFor(k);
    const rows = ls.map(l => ({ t:"row", indent:1, label:escHtml(l), vals:data.map(d => d.cats[k].get(l) || 0) }));
    const t = data.map(d => [...d.cats[k].values()].reduce((s, v) => s + v, 0));
    return { rows:[{ t:"sec", label:title }, ...rows, { t:"total", label:totalLabel, vals:t }], total:t };
  };
  const op = block("op", "Cash flows from operating activities", "Net cash from operating activities");
  const inv = block("inv", "Cash flows from investing activities", "Net cash from investing activities");
  const fin = block("fin", "Cash flows from financing activities", "Net cash from financing activities");
  const net = data.map((d, i) => op.total[i] + inv.total[i] + fin.total[i]);
  const rows = [
    { t:"row", label:"<b>Cash at beginning of period</b>", vals:data.map(d => d.open) },
    ...op.rows, ...inv.rows, ...fin.rows,
    { t:"grand", label:"NET INCREASE / (DECREASE) IN CASH", vals:net },
    { t:"grand", label:"CASH AT END OF PERIOD", vals:data.map(d => d.close) }
  ];
  const ok = data.every((d, i) => Math.abs(net[i] - d.change) < 0.01);
  return rpTools({ range:true, compare:true }) + rpMeta(rpPeriodText())
    + stmtTable(ranges.map(r => fmtDate(r[0]) + " – " + fmtDate(r[1])), rows,
      (ok ? "✓ Ties to the movement of the bank accounts." : "⚠ Does not tie to the bank accounts.") + " Direct method: every bank movement is classified by the account on the other side of the entry.");
}

/* ---------- Depreciation Schedule ---------- */
function rpDepreciation(){
  repInit();
  const from = repState.from, to = repState.to;
  const assets = fixedAssets.filter(a => inView(a.currency || baseCur()));
  const rows = assets.map(a => {
    const cur = a.currency || baseCur(), cost = Number(a.cost) || 0, sch = assetSchedule(a);
    const gOpen = a.purchaseDate < from ? cost : 0, add = a.purchaseDate >= from && a.purchaseDate <= to ? cost : 0;
    const gClose = a.purchaseDate <= to ? cost : 0;
    const accAt = d => sch.filter(s => s.date <= d).reduce((m, s) => s.accum, 0);
    const aOpen = accAt(addDaysISO(from, -1)), aClose = accAt(to);
    return { a, cur, gOpen:vamt(cur, gOpen), add:vamt(cur, add), gClose:vamt(cur, gClose), aOpen:vamt(cur, aOpen), dep:vamt(cur, aClose - aOpen), aClose:vamt(cur, aClose), nbv:vamt(cur, gClose - aClose) };
  });
  const T = k => rows.reduce((s, r) => s + r[k], 0);
  const body = rows.map(r => `<tr><td>${escHtml(r.a.name)}<div style="font-size:11px;color:var(--muted)">${escHtml(r.a.category || "")}</div></td><td class="mono">${fmtDate(r.a.purchaseDate)}</td>
      <td>${r.a.method === "declining" ? "Declining " + (r.a.rate || Math.round(200 / (r.a.lifeYears || 1))) + "%" : "Straight-line"} · ${r.a.lifeYears}y</td>
      ${tdn(r.gOpen)}${tdn(r.add)}${tdn(r.gClose)}${tdn(r.aOpen)}${tdn(r.dep)}${tdn(r.aClose)}${tdn(r.nbv)}</tr>`).join("") || emptyRow(10, "No fixed assets yet — add them under Accounting → Fixed Assets.");
  const foot = rows.length ? `<tfoot><tr class="rp-grand"><td colspan="3">Total</td>${["gOpen", "add", "gClose", "aOpen", "dep", "aClose", "nbv"].map(k => tdn(T(k))).join("")}</tr></tfoot>` : "";
  const main = panel("Depreciation schedule", `<table class="grid"><thead><tr><th>Asset</th><th>Purchased</th><th>Method</th>
      <th class="right">Gross opening</th><th class="right">Additions</th><th class="right">Gross closing</th>
      <th class="right">Accum. opening</th><th class="right">Depreciation</th><th class="right">Accum. closing</th><th class="right">Net book value</th></tr></thead><tbody>${body}</tbody>${foot}</table>`,
      "Depreciation is computed monthly from the purchase month. Periods that end in the future show the planned (scheduled) depreciation.");
  // yearly plan by fiscal year, per asset
  let plan = "";
  if(assets.length){
    const fys = new Set(); const per = assets.map(a => {
      const cur = a.currency || baseCur(), m = new Map();
      assetSchedule(a).forEach(s => { const k = fyStartISO(s.date); fys.add(k); m.set(k, (m.get(k) || 0) + vamt(cur, s.dep)); });
      return { a, m };
    });
    const ks = [...fys].sort();
    plan = panel("Planned depreciation by fiscal year", `<table class="grid"><thead><tr><th>Asset</th>${ks.map(k => `<th class="right">${fyLabel(k)}</th>`).join("")}<th class="right">Total</th></tr></thead><tbody>
      ${per.map(p => `<tr><td>${escHtml(p.a.name)}</td>${ks.map(k => tdn(p.m.get(k) || 0)).join("")}${tdn([...p.m.values()].reduce((s, v) => s + v, 0))}</tr>`).join("")}
      </tbody><tfoot><tr class="rp-grand"><td>Total</td>${ks.map(k => tdn(per.reduce((s, p) => s + (p.m.get(k) || 0), 0))).join("")}${tdn(per.reduce((s, p) => s + [...p.m.values()].reduce((a, b) => a + b, 0), 0))}</tr></tfoot></table>`);
  }
  return rpTools({ range:true }) + rpMeta(rpPeriodText()) + main + plan;
}

/* ========================================================================
   LEDGERS
   ======================================================================== */

/* ---------- Trial Balance ---------- */
function rpTrialBalance(){
  repInit();
  const lines = viewLines();
  const from = repState.from, to = repState.to;
  const init = tbAt(lines, addDaysISO(from, -1)), end = tbAt(lines, to), mv = moveAgg(lines, from, to);
  const codes = new Set([...init.keys(), ...end.keys(), ...mv.keys()]);
  const list = [...codes].filter(c => Math.abs(init.get(c) || 0) > 0.004 || Math.abs(end.get(c) || 0) > 0.004 || (mv.get(c) && (mv.get(c).dr || mv.get(c).cr))).sort();
  const split = v => [v > 0 ? v : 0, v < 0 ? -v : 0];
  const tot = [0, 0, 0, 0, 0, 0];
  const body = list.map(c => {
    const i = split(init.get(c) || 0), e = mv.get(c) || { dr:0, cr:0 }, f = split(end.get(c) || 0);
    [i[0], i[1], e.dr, e.cr, f[0], f[1]].forEach((v, k) => tot[k] += v);
    return `<tr><td class="mono">${c}</td><td>${escHtml(accInfo(c).name)}</td><td><span class="acct-type ${accInfo(c).type}">${accInfo(c).type}</span></td>
      <td class="right mono">${nfz(i[0])}</td><td class="right mono">${nfz(i[1])}</td><td class="right mono">${nfz(e.dr)}</td><td class="right mono">${nfz(e.cr)}</td><td class="right mono">${nfz(f[0])}</td><td class="right mono">${nfz(f[1])}</td></tr>`;
  }).join("") || emptyRow(9);
  const ok = Math.abs(tot[4] - tot[5]) < 0.01 && Math.abs(tot[0] - tot[1]) < 0.01 && Math.abs(tot[2] - tot[3]) < 0.01;
  return rpTools({ range:true }) + rpMeta(rpPeriodText())
    + panel("", `<table class="grid"><thead><tr><th rowspan="2">Code</th><th rowspan="2">Account</th><th rowspan="2">Type</th><th colspan="2" class="right">Initial balance</th><th colspan="2" class="right">Period</th><th colspan="2" class="right">End balance</th></tr>
      <tr><th class="right">Debit</th><th class="right">Credit</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Debit</th><th class="right">Credit</th></tr></thead>
      <tbody>${body}</tbody><tfoot><tr class="rp-grand"><td colspan="3">Total</td>${tot.map(v => `<td class="right mono">${nf(v)}</td>`).join("")}</tr></tfoot></table>`,
      (ok ? "✓ Balanced — total debits equal total credits in every column." : "⚠ Out of balance — check manual journal entries.")
      + " Income and expense accounts restart each fiscal year; earlier years are carried in 3900 Retained Earnings.");
}

/* ---------- General Ledger ---------- */
function rpGeneralLedger(){
  repInit();
  const lines = viewLines();
  const from = repState.from, to = repState.to;
  const init = tbAt(lines, addDaysISO(from, -1));
  const inRange = lines.filter(l => l.date >= from && l.date <= to);
  const codes = new Set(); inRange.forEach(l => codes.add(l.acc)); init.forEach((v, c) => { if(Math.abs(v) > 0.004) codes.add(c); });
  let list = [...codes].sort();
  const allCodes = list.slice();
  if(repState.account !== "all") list = list.filter(c => c === repState.account);
  const accSel = `<div class="field"><label>Account</label><select onchange="repSet('account',this.value)"><option value="all">All accounts</option>${allCodes.map(c => `<option value="${c}" ${repState.account === c ? "selected" : ""}>${escHtml(accName(c))}</option>`).join("")}</select></div>`;
  const blocks = list.map(c => {
    let bal = init.get(c) || 0, dr = 0, cr = 0;
    const ls = inRange.filter(l => l.acc === c).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    const rows = ls.map(l => { bal += l.dr - l.cr; dr += l.dr; cr += l.cr;
      return `<tr><td class="mono">${fmtDate(l.date)}</td><td class="mono">${escHtml(l.ref || "")}</td><td>${escHtml(l.partner || "")}</td><td>${escHtml(l.label)}</td>
        <td class="right mono">${nfz(l.dr)}</td><td class="right mono">${nfz(l.cr)}</td>${tdn(bal)}</tr>`; }).join("");
    return panel(escHtml(accName(c)), `<table class="grid"><thead><tr><th>Date</th><th>Reference</th><th>Partner</th><th>Label</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr></thead><tbody>
      <tr class="rp-sec"><td colspan="6">Initial balance</td>${tdn(init.get(c) || 0)}</tr>${rows}</tbody>
      <tfoot><tr class="rp-total"><td colspan="4">Total / ending balance</td><td class="right mono">${nf(dr)}</td><td class="right mono">${nf(cr)}</td>${tdn(bal)}</tr></tfoot></table>`);
  }).join("") || panel("", `<div class="empty">No ledger entries in this period.</div>`);
  return rpTools({ range:true, extra:accSel }) + rpMeta(rpPeriodText()) + blocks;
}

/* ---------- register ---------- */
defReport("rep_balance", "Balance Sheet", "Assets, liabilities and equity at a date", rpBalanceSheet);
defReport("rep_pl", "Profit and Loss", "Income, costs and net profit for a period", rpProfitLoss);
defReport("rep_cashflow", "Cash Flow Statement", "Where cash came from and where it went (direct method)", rpCashFlow);
defReport("rep_depr", "Depreciation Schedule", "Fixed assets: cost, depreciation and net book value", rpDepreciation);
defReport("rep_trial", "Trial Balance", "Initial, period and end balances for every account", rpTrialBalance);
defReport("rep_gl", "General Ledger", "Every posting, account by account, with running balance", rpGeneralLedger);
