/* =====================================================================
   REPORTS part 2 (reports2.js):
   Partner Reports · Taxes & Fiscal · Management
   ===================================================================== */

/* ---------- shared summaries ---------- */
function plSummary(lines, from, to){
  const m = plNet(lines, from, to);
  let rev = 0, cogs = 0, opex = 0, oth = 0;
  m.forEach((v, c) => {
    const i = accInfo(c);
    if(i.type === "income"){ if(i.sub === "other") oth -= v; else rev -= v; }
    else if(i.type === "expense"){ if(i.sub === "cogs") cogs += v; else if(i.sub === "opex") opex += v; else oth -= v; }
  });
  return { rev, cogs, gross:rev - cogs, opex, oth, net:rev - cogs - opex + oth };
}
function positionAt(lines, date){
  const m = tbAt(lines, date);
  const S = pred => sumNat(m, (c, i) => !isPL(c) && pred(c, i));
  const assets = S((c, i) => i.type === "asset"), liab = S((c, i) => i.type === "liability");
  return {
    cash:S((c, i) => i.sub === "bank"), recv:S((c, i) => i.sub === "receivable"), pay:S((c, i) => i.sub === "payable"),
    curAssets:S((c, i) => i.type === "asset" && i.sub !== "fixed"), curLiab:S((c, i) => i.type === "liability" && i.sub !== "noncurrent"),
    fixed:S((c, i) => i.sub === "fixed"), loansTaken:S(c => c === "2300"), loansGiven:S(c => c === "1300"),
    tax:S(c => c === "2210") - S(c => c === "1210"),
    assets, liab, equity:assets - liab
  };
}
function analyticName(id){
  if(!id) return "(No analytic account)";
  const a = analyticAccounts.find(x => x.id === id);
  return a ? a.name : "(Deleted analytic account)";
}
function analyticOptionsHtml(sel){
  return `<option value="">— none —</option>` + analyticAccounts.map(a => `<option value="${escHtml(a.id)}" ${a.id === sel ? "selected" : ""}>${escHtml(a.name)}</option>`).join("");
}

/* ========================================================================
   PARTNER REPORTS
   ======================================================================== */

/* ---------- Partner Ledger ---------- */
function rpPartnerLedger(){
  repInit();
  let lines = viewLines().filter(l => (l.acc === "1100" || l.acc === "2100") && l.partner);
  if(repState.ptype === "customer") lines = lines.filter(l => l.acc === "1100");
  if(repState.ptype === "vendor") lines = lines.filter(l => l.acc === "2100");
  const from = repState.from, to = repState.to;
  const partners = [...new Set(lines.map(l => l.partner))].sort();
  const shown = repState.partner === "all" ? partners : partners.filter(p => p === repState.partner);
  const extra = `<div class="field"><label>Partner type</label><select onchange="repSet('ptype',this.value)">
      <option value="both" ${repState.ptype === "both" ? "selected" : ""}>Customers &amp; vendors</option><option value="customer" ${repState.ptype === "customer" ? "selected" : ""}>Customers (receivable)</option><option value="vendor" ${repState.ptype === "vendor" ? "selected" : ""}>Vendors (payable)</option></select></div>
    <div class="field"><label>Partner</label><select onchange="repSet('partner',this.value)"><option value="all">All partners</option>${partners.map(p => `<option value="${escHtml(p)}" ${repState.partner === p ? "selected" : ""}>${escHtml(p)}</option>`).join("")}</select></div>`;
  let gDr = 0, gCr = 0;
  const blocks = shown.map(p => {
    const all = lines.filter(l => l.partner === p).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    let bal = all.filter(l => l.date < from).reduce((s, l) => s + l.dr - l.cr, 0), dr = 0, cr = 0;
    const init = bal;
    const rows = all.filter(l => l.date >= from && l.date <= to).map(l => {
      bal += l.dr - l.cr; dr += l.dr; cr += l.cr;
      return `<tr><td class="mono">${fmtDate(l.date)}</td><td class="mono">${escHtml(l.ref || "")}</td><td>${l.acc === "1100" ? "Receivable" : "Payable"}</td><td>${escHtml(l.label)}</td>
        <td class="right mono">${nfz(l.dr)}</td><td class="right mono">${nfz(l.cr)}</td>${tdn(bal)}</tr>`;
    }).join("");
    gDr += dr; gCr += cr;
    return panel(escHtml(p), `<table class="grid"><thead><tr><th>Date</th><th>Reference</th><th>Account</th><th>Label</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr></thead><tbody>
      <tr class="rp-sec"><td colspan="6">Initial balance</td>${tdn(init)}</tr>${rows}</tbody>
      <tfoot><tr class="rp-total"><td colspan="4">Total</td><td class="right mono">${nf(dr)}</td><td class="right mono">${nf(cr)}</td>${tdn(bal)}</tr></tfoot></table>`);
  }).join("") || panel("", `<div class="empty">No partner entries for this selection.</div>`);
  return rpTools({ range:true, extra }) + rpMeta(rpPeriodText())
    + blocks + (shown.length > 1 ? `<div class="rp-meta" style="text-align:right;">All partners — Debit ${nf(gDr)} · Credit ${nf(gCr)} · Net ${nf(gDr - gCr)}</div>` : "")
    + `<div class="rp-meta">Positive balance = the partner owes us (receivable). Negative balance = we owe the partner (payable).</div>`;
}

/* ---------- Customer Statement ---------- */
function rpCustomerStatement(){
  repInit();
  const custs = [...new Set(invoices.map(d => (d.billTo || {}).company).filter(c => c && c !== "—"))].sort();
  if(!custs.includes(repState.customer)) repState.customer = custs[0] || "";
  const c = repState.customer, from = repState.from, to = repState.to;
  const extra = `<div class="field" style="min-width:260px;"><label>Customer</label><select onchange="repSet('customer',this.value)">${custs.map(x => `<option value="${escHtml(x)}" ${x === c ? "selected" : ""}>${escHtml(x)}</option>`).join("")}</select></div>`;
  if(!c) return rpTools({ range:true, extra }) + panel("", `<div class="empty">No customers yet — create an invoice first.</div>`);
  const lines = viewLines().filter(l => l.acc === "1100" && l.partner === c).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const opening = lines.filter(l => l.date < from).reduce((s, l) => s + l.dr - l.cr, 0);
  let bal = opening, ch = 0, rc = 0;
  const rows = lines.filter(l => l.date >= from && l.date <= to).map(l => {
    bal += l.dr - l.cr; ch += l.dr; rc += l.cr;
    let st = "";
    if(l.dr > 0){ const inv = invoices.find(i => i.invoiceNo === l.ref); if(inv) st = statusPill(effectiveStatus(inv), daysUntil(inv.dueDate), "invoice"); }
    else st = '<span class="pill paid">Received</span>';
    return `<tr><td class="mono">${fmtDate(l.date)}</td><td class="mono">${escHtml(l.ref || "")}</td><td>${l.dr > 0 ? "Invoice" : "Payment received"}</td><td>${st}</td>
      <td class="right mono">${nfz(l.dr)}</td><td class="right mono">${nfz(l.cr)}</td>${tdn(bal)}</tr>`;
  }).join("") || emptyRow(7, "No invoices or receipts in this period.");
  const first = invoices.find(i => (i.billTo || {}).company === c) || { billTo:{} };
  const b = first.billTo || {};
  const ageDocs = outstandingDocs("invoice", to).filter(d => d.party === c);
  const ages = AGE_BUCKETS.map(() => 0); ageDocs.forEach(d => { ages[ageBucketIndex(d.due, to)] += d.amount; });
  const ageTotal = ages.reduce((s, v) => s + v, 0);
  const head = `<div class="panel"><div class="panel-body pad" style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;">
      <div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Customer statement for</div><div style="font-size:17px;font-weight:700;">${escHtml(c)}</div>
        <div style="font-size:12.5px;color:var(--muted);max-width:480px;">${escHtml(b.address || "")}${b.email ? "<br>" + escHtml(b.email) : ""}${b.trn ? "<br>TRN " + escHtml(b.trn) : ""}</div></div>
      <div style="text-align:right;font-size:12.5px;"><div>Statement date: <b>${fmtDate(to)}</b></div><div>Period: ${fmtDate(from)} – ${fmtDate(to)}</div></div></div></div>`;
  const cards = `<div class="cards">
      <div class="card"><div class="label">Opening balance</div><div class="value" style="font-size:19px;">${nf(opening)}</div></div>
      <div class="card gold"><div class="label">Invoiced in period</div><div class="value" style="font-size:19px;">${nf(ch)}</div></div>
      <div class="card"><div class="label">Received in period</div><div class="value" style="font-size:19px;">${nf(rc)}</div></div>
      <div class="card ${bal > 0.004 ? "red" : ""}"><div class="label">Outstanding balance</div><div class="value ${bal > 0.004 ? "red" : ""}" style="font-size:19px;">${nf(bal)}</div></div></div>`;
  const ageing = panel("Outstanding by age (as of " + fmtDate(to) + ")", `<table class="grid"><thead><tr>${AGE_BUCKETS.map(b => `<th class="right">${b[0] === "Not due" ? "Not yet due" : b[0] + " days"}</th>`).join("")}<th class="right">Total outstanding</th></tr></thead>
      <tbody><tr>${ages.map(v => tdn(v)).join("")}${tdn(ageTotal)}</tr></tbody></table>`);
  return rpTools({ range:true, extra }) + rpMeta(rpPeriodText()) + head + cards
    + panel("Statement detail", `<table class="grid"><thead><tr><th>Date</th><th>Document</th><th>Type</th><th>Status</th><th class="right">Charges</th><th class="right">Payments received</th><th class="right">Balance</th></tr></thead><tbody>
      <tr class="rp-sec"><td colspan="6">Opening balance</td>${tdn(opening)}</tr>${rows}</tbody>
      <tfoot><tr class="rp-grand"><td colspan="4">Closing balance (outstanding)</td><td class="right mono">${nf(ch)}</td><td class="right mono">${nf(rc)}</td>${tdn(bal)}</tr></tfoot></table>`)
    + ageing;
}

/* ---------- Aged Receivable / Payable ---------- */
function rpAged(kind){
  repInit();
  const asOf = repState.asOf, inv = kind === "invoice";
  const docs = outstandingDocs(kind, asOf);
  const parties = [...new Set(docs.map(d => d.party))].sort();
  const tot = AGE_BUCKETS.map(() => 0);
  const prow = parties.map(p => {
    const a = AGE_BUCKETS.map(() => 0);
    docs.filter(d => d.party === p).forEach(d => { a[ageBucketIndex(d.due, asOf)] += d.amount; });
    a.forEach((v, i) => tot[i] += v);
    return `<tr><td>${escHtml(p)}</td>${a.map(v => tdn(v)).join("")}${tdn(a.reduce((s, v) => s + v, 0))}</tr>`;
  }).join("") || emptyRow(8, inv ? "No outstanding invoices at this date." : "No unpaid purchase orders at this date.");
  const grand = tot.reduce((s, v) => s + v, 0);
  const summary = panel("", `<table class="grid"><thead><tr><th>${inv ? "Customer" : "Vendor"}</th>${AGE_BUCKETS.map(b => `<th class="right">${b[0] === "Not due" ? "Not due" : b[0] + " d"}</th>`).join("")}<th class="right">Total</th></tr></thead>
      <tbody>${prow}</tbody><tfoot><tr class="rp-grand"><td>Total</td>${tot.map(v => tdn(v)).join("")}${tdn(grand)}</tr></tfoot></table>`,
      `Buckets count the days past the due date at ${fmtDate(asOf)}. ${inv ? "An invoice stays <b>Outstanding</b> until it is marked <b>Received</b>." : "A purchase order stays <b>Unpaid</b> until it is marked <b>Paid</b>."}`);
  const extra = `<div class="field"><label>&nbsp;</label><label class="rp-check"><input type="checkbox" ${repState.details ? "checked" : ""} onchange="repSet('details',this.checked)"> Show ${inv ? "invoice" : "PO"} details</label></div>`;
  let det = "";
  if(repState.details && docs.length){
    const sorted = docs.slice().sort((a, b) => a.party.localeCompare(b.party) || (a.due < b.due ? -1 : 1));
    det = panel(inv ? "Outstanding invoices" : "Unpaid purchase orders", `<table class="grid"><thead><tr><th>Document</th><th>${inv ? "Customer" : "Vendor"}</th><th>Date</th><th>Due</th><th class="right">Days overdue</th><th class="right">Amount</th><th>Status</th></tr></thead><tbody>
      ${sorted.map(d => { const days = Math.round((parseDate(asOf) - parseDate(d.due)) / 86400000);
        return `<tr><td class="mono">${escHtml(d.no)}</td><td>${escHtml(d.party)}</td><td class="mono">${fmtDate(d.date)}</td><td class="mono">${fmtDate(d.due)}</td>
          <td class="right mono">${days > 0 ? days : "—"}</td>${tdn(d.amount)}<td>${days > 0 ? '<span class="pill overdue">Overdue</span>' : '<span class="pill unpaid">' + (inv ? "Outstanding" : "Unpaid") + '</span>'}</td></tr>`; }).join("")}</tbody></table>`);
  }
  return rpTools({ asof:true, extra }) + rpMeta("As of " + fmtDate(asOf)) + summary + det;
}

/* ========================================================================
   TAXES & FISCAL
   ======================================================================== */

/* ---------- Tax Report ---------- */
function rpTax(){
  repInit();
  const from = repState.from, to = repState.to;
  const pick = (list, dateKey, kind) => list.filter(d => d[dateKey] && d[dateKey] >= from && d[dateKey] <= to && inView(d.currency || (kind === "invoice" ? "£" : "$")))
    .map(d => { const total = vamt(d.currency, docTotal(d.items)), rate = Number(d.taxRate) || 0, tax = taxPart(total, rate);
      return { d, kind, rate, total, tax, base:total - tax, no:kind === "invoice" ? d.invoiceNo : d.poNo, party:kind === "invoice" ? (d.billTo || {}).company : (d.vendor || {}).name, date:d[dateKey] }; });
  const sales = pick(invoices, "invoiceDate", "invoice"), purch = pick(purchaseOrders, "poDate", "po");
  const group = list => { const m = new Map(); list.forEach(x => { const e = m.get(x.rate) || { n:0, base:0, tax:0, total:0 }; e.n++; e.base += x.base; e.tax += x.tax; e.total += x.total; m.set(x.rate, e); }); return [...m.entries()].sort((a, b) => a[0] - b[0]); };
  const grpTable = (title, list, taxLabel) => {
    const g = group(list); const T = g.reduce((s, [r, e]) => ({ n:s.n + e.n, base:s.base + e.base, tax:s.tax + e.tax, total:s.total + e.total }), { n:0, base:0, tax:0, total:0 });
    return panel(title, `<table class="grid"><thead><tr><th>Tax rate</th><th class="right">Documents</th><th class="right">Base (excl. tax)</th><th class="right">${taxLabel}</th><th class="right">Total (incl. tax)</th></tr></thead><tbody>
      ${g.map(([r, e]) => `<tr><td>${r > 0 ? r + "%" : "0% — zero-rated / exempt"}</td><td class="right mono">${e.n}</td>${tdn(e.base)}${tdn(e.tax)}${tdn(e.total)}</tr>`).join("") || emptyRow(5, "No documents in this period.")}</tbody>
      <tfoot><tr class="rp-grand"><td>Total</td><td class="right mono">${T.n}</td>${tdn(T.base)}${tdn(T.tax)}${tdn(T.total)}</tr></tfoot></table>`);
  };
  const outTax = sales.reduce((s, x) => s + x.tax, 0), inTax = purch.reduce((s, x) => s + x.tax, 0);
  // position from the ledger (includes manual tax entries such as VAT payments)
  const lines = viewLines();
  const pos = positionAt(lines, to);
  const adj = lines.filter(l => l.src === "manual" && (l.acc === "2210" || l.acc === "1210") && l.date >= from && l.date <= to).reduce((s, l) => s + (l.acc === "2210" ? l.cr - l.dr : l.dr - l.cr), 0);
  const cards = `<div class="cards">
      <div class="card"><div class="label">Output tax (sales)</div><div class="value" style="font-size:19px;">${nf(outTax)}</div></div>
      <div class="card gold"><div class="label">Input tax (purchases)</div><div class="value" style="font-size:19px;">${nf(inTax)}</div></div>
      <div class="card ${outTax - inTax > 0 ? "amber" : ""}"><div class="label">Net tax for the period</div><div class="value" style="font-size:19px;">${nf(outTax - inTax)}</div><div class="foot">${outTax - inTax >= 0 ? "payable to tax authority" : "refundable"}</div></div>
      <div class="card"><div class="label">Tax position at ${fmtDate(to)}</div><div class="value" style="font-size:19px;">${nf(pos.tax)}</div><div class="foot">${pos.tax >= 0 ? "still to pay" : "still to reclaim"}</div></div></div>`;
  const details = repState.details ? panel("Document detail", `<table class="grid"><thead><tr><th>Type</th><th>Document</th><th>Partner</th><th>Date</th><th class="right">Rate</th><th class="right">Base</th><th class="right">Tax</th><th class="right">Total</th></tr></thead><tbody>
      ${sales.concat(purch).sort((a, b) => a.date < b.date ? -1 : 1).map(x => `<tr><td>${x.kind === "invoice" ? "Sale (output)" : "Purchase (input)"}</td><td class="mono">${escHtml(x.no)}</td><td>${escHtml(x.party)}</td><td class="mono">${fmtDate(x.date)}</td><td class="right mono">${x.rate}%</td>${tdn(x.base)}${tdn(x.tax)}${tdn(x.total)}</tr>`).join("") || emptyRow(8)}</tbody></table>`) : "";
  const extra = `<div class="field"><label>&nbsp;</label><label class="rp-check"><input type="checkbox" ${repState.details ? "checked" : ""} onchange="repSet('details',this.checked)"> Show document detail</label></div>`;
  return rpTools({ range:true, extra }) + rpMeta(rpPeriodText()) + cards
    + grpTable("Sales — output tax", sales, "Output tax") + grpTable("Purchases — input tax", purch, "Input tax")
    + panel("", `<table class="grid"><tbody>
        <tr><td>Output tax on sales</td>${tdn(outTax)}</tr><tr><td>Less: input tax on purchases</td>${tdn(-inTax)}</tr>
        <tr class="rp-total"><td>Net tax due for the period</td>${tdn(outTax - inTax)}</tr>
        <tr><td>Manual tax entries in the period (e.g. tax payments, adjustments)</td>${tdn(adj)}</tr></tbody></table>`,
      "Prices on invoices / purchase orders are treated as tax-inclusive: tax = total × rate ÷ (100 + rate). Set the rate per document (default rates in Settings → Tax &amp; Currency). Export sales are normally 0% zero-rated.")
    + details;
}

/* ---------- Fiscal Report ---------- */
function rpFiscal(){
  repInit();
  const lines = viewLines(), t = toISO(new Date());
  const first = lines.reduce((m, l) => (!m || l.date < m) ? l.date : m, t);
  const years = []; for(let s = fyStartISO(first); s <= fyStartISO(t); s = addMonthsISO(s, 12)) years.push(s);
  if(!years.includes(repState.fy)) repState.fy = years[years.length - 1];
  const fs = repState.fy, fe = addDaysISO(addMonthsISO(fs, 12), -1);
  const extra = `<div class="field"><label>Fiscal year</label><select onchange="repSet('fy',this.value)">${years.map(y => `<option value="${y}" ${y === fs ? "selected" : ""}>${fyLabel(y)} (${fmtDate(y)} – ${fmtDate(addDaysISO(addMonthsISO(y, 12), -1))})</option>`).join("")}</select></div>`;
  const qs = [0, 1, 2, 3].map(k => [addMonthsISO(fs, k * 3), addDaysISO(addMonthsISO(fs, k * 3 + 3), -1)]);
  const cols = qs.map(q => plSummary(lines, q[0], q[1])); const yr = plSummary(lines, fs, fe);
  const taxOf = (list, key, kind, from, to) => list.filter(d => d[key] >= from && d[key] <= to && inView(d.currency || "£")).reduce((s, d) => s + taxPart(vamt(d.currency, docTotal(d.items)), d.taxRate), 0);
  const q = (k, f) => cols.map(c => f(c)).concat([f(yr)]);
  const rowsDef = [
    ["Revenue", c => c.rev], ["Cost of revenue", c => c.cogs], ["Gross profit", c => c.gross, "total"], ["Operating expenses", c => c.opex],
    ["Other income / (expenses)", c => c.oth], ["Net profit", c => c.net, "grand"]
  ];
  const plRows = rowsDef.map(([l, f, cls]) => `<tr class="${cls ? "rp-" + cls : ""}"><td>${l}</td>${q(0, f).map(v => tdn(v)).join("")}</tr>`).join("");
  const outT = qs.map(r => taxOf(invoices, "invoiceDate", "invoice", r[0], r[1])), inT = qs.map(r => taxOf(purchaseOrders, "poDate", "po", r[0], r[1]));
  const taxRows = `<tr><td>Output tax (sales)</td>${outT.concat([outT.reduce((a, b) => a + b, 0)]).map(v => tdn(v)).join("")}</tr><tr><td>Input tax (purchases)</td>${inT.concat([inT.reduce((a, b) => a + b, 0)]).map(v => tdn(v)).join("")}</tr>`;
  const endDate = fe < t ? fe : t, pos = positionAt(lines, endDate);
  const posRows = [["Cash & bank", pos.cash], ["Receivables (customers outstanding)", pos.recv], ["Payables (vendors unpaid)", pos.pay], ["Fixed assets — net book value", pos.fixed],
    ["Loans taken (outstanding)", pos.loansTaken], ["Loans given (outstanding)", pos.loansGiven], ["Tax payable / (reclaimable)", pos.tax], ["Total equity (net assets)", pos.equity]]
    .map(([l, v]) => `<tr><td>${l}</td>${tdn(v)}</tr>`).join("");
  const overview = years.slice().reverse().map(y => { const e = addDaysISO(addMonthsISO(y, 12), -1), s = plSummary(lines, y, e), p = positionAt(lines, e < t ? e : t);
    return `<tr><td>${fyLabel(y)}</td><td class="mono">${fmtDate(y)} – ${fmtDate(e)}</td>${tdn(s.rev)}${tdn(s.cogs + s.opex)}${tdn(s.net)}${tdn(p.recv)}${tdn(p.pay)}${tdn(p.equity)}</tr>`; }).join("");
  return rpTools({ extra }) + rpMeta(fyLabel(fs) + ": " + fmtDate(fs) + " – " + fmtDate(fe))
    + panel("Results by fiscal quarter — " + fyLabel(fs), `<table class="grid"><thead><tr><th></th>${qs.map((r, k) => `<th class="right">Q${k + 1}<div style="font-weight:400;font-size:10px">${MONTH_NAMES[parseDate(r[0]).getMonth()].slice(0, 3)}–${MONTH_NAMES[parseDate(r[1]).getMonth()].slice(0, 3)}</div></th>`).join("")}<th class="right">Full year</th></tr></thead><tbody>${plRows}${taxRows}</tbody></table>`)
    + panel("Position at " + fmtDate(endDate), `<table class="grid"><tbody>${posRows}</tbody></table>`, fe > t ? "The fiscal year is still open — position shown as of today." : "Fiscal year closed.")
    + panel("All fiscal years", `<table class="grid"><thead><tr><th>Year</th><th>Dates</th><th class="right">Revenue</th><th class="right">Costs</th><th class="right">Net profit</th><th class="right">Receivable at end</th><th class="right">Payable at end</th><th class="right">Equity at end</th></tr></thead><tbody>${overview}</tbody></table>`,
      "Fiscal year start month is set in Settings → Advanced.");
}

/* ========================================================================
   MANAGEMENT
   ======================================================================== */

/* ---------- Invoice Analysis ---------- */
function rpInvoiceAnalysis(){
  repInit();
  const inv = repState.kind !== "purchases";
  const list = (inv ? invoices : purchaseOrders).filter(d => { const dt = inv ? d.invoiceDate : d.poDate; return dt && dt >= repState.from && dt <= repState.to && inView(d.currency || (inv ? "£" : "$")); })
    .map(d => { const st = effectiveStatus(d); return { d, st, total:vamt(d.currency, docTotal(d.items)), party:inv ? (d.billTo || {}).company : (d.vendor || {}).name, date:inv ? d.invoiceDate : d.poDate }; });
  const done = x => x.st === "paid";
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const total = sum(list, x => x.total), settled = sum(list.filter(done), x => x.total), open = total - settled, overdue = sum(list.filter(x => x.st === "overdue"), x => x.total);
  const L = inv ? { done:"Received", open:"Outstanding", noun:"invoices", party:"Customer" } : { done:"Paid", open:"Unpaid", noun:"purchase orders", party:"Vendor" };
  const extra = `<div class="field"><label>Analyse</label><select onchange="repSet('kind',this.value)"><option value="sales" ${inv ? "selected" : ""}>Sales invoices</option><option value="purchases" ${!inv ? "selected" : ""}>Purchase orders</option></select></div>`;
  const cards = `<div class="cards">
      <div class="card"><div class="label">${inv ? "Invoiced" : "Ordered"} (${list.length} ${L.noun})</div><div class="value" style="font-size:19px;">${nf(total)}</div><div class="foot">Average ${nf(list.length ? total / list.length : 0)}</div></div>
      <div class="card gold"><div class="label">${L.done}</div><div class="value" style="font-size:19px;">${nf(settled)}</div><div class="foot">${pct(settled, total)} of total</div></div>
      <div class="card amber"><div class="label">${L.open}</div><div class="value amber" style="font-size:19px;">${nf(open)}</div><div class="foot">${pct(open, total)} of total</div></div>
      <div class="card red"><div class="label">Overdue</div><div class="value red" style="font-size:19px;">${nf(overdue)}</div><div class="foot">${list.filter(x => x.st === "overdue").length} ${L.noun}</div></div></div>`;
  const grp = (keyFn) => { const m = new Map(); list.forEach(x => { const k = keyFn(x); const e = m.get(k) || { n:0, total:0, done:0 }; e.n++; e.total += x.total; if(done(x)) e.done += x.total; m.set(k, e); }); return m; };
  const byParty = [...grp(x => x.party).entries()].sort((a, b) => b[1].total - a[1].total);
  const partyTable = panel("By " + L.party.toLowerCase(), `<table class="grid"><thead><tr><th>${L.party}</th><th class="right">Documents</th><th class="right">Total</th><th class="right">${L.done}</th><th class="right">${L.open}</th><th class="right">Share</th></tr></thead><tbody>
      ${byParty.map(([k, e]) => `<tr><td>${escHtml(k)}</td><td class="right mono">${e.n}</td>${tdn(e.total)}${tdn(e.done)}${tdn(e.total - e.done)}<td class="right mono">${pct(e.total, total)}</td></tr>`).join("") || emptyRow(6)}</tbody></table>`);
  // products
  const pm = new Map();
  list.forEach(x => (x.d.items || []).forEach(it => { const k = it.name || "—"; const e = pm.get(k) || { qty:0, amt:0, uom:it.uom || "" }; e.qty += Number(it.qty) || 0; e.amt += vamt(x.d.currency, lineAmount(it)); pm.set(k, e); }));
  const prod = [...pm.entries()].sort((a, b) => b[1].amt - a[1].amt);
  const prodTable = panel("By product", `<table class="grid"><thead><tr><th>Product</th><th class="right">Quantity</th><th class="right">Average unit price</th><th class="right">Amount</th><th class="right">Share</th></tr></thead><tbody>
      ${prod.map(([k, e]) => `<tr><td>${escHtml(k)}</td><td class="right mono">${e.qty.toLocaleString()} ${escHtml(e.uom)}</td>${tdn(e.qty ? e.amt / e.qty : 0)}${tdn(e.amt)}<td class="right mono">${pct(e.amt, total)}</td></tr>`).join("") || emptyRow(5)}</tbody></table>`);
  // months
  const mm = grp(x => monthKey(x.date)); const mk = [...mm.keys()].sort();
  const chart = mk.length ? svgBarChart(mk.map(monthLabel), [{ label:L.done, data:mk.map(k => round2(mm.get(k).done)), color:"#2CA01C" }, { label:L.open, data:mk.map(k => round2(mm.get(k).total - mm.get(k).done)), color:"#ff8000" }]) : "";
  const monthTable = panel("By month", (chart ? `<div class="panel-body pad">${chart}</div>` : "") + `<table class="grid"><thead><tr><th>Month</th><th class="right">Documents</th><th class="right">Total</th><th class="right">${L.done}</th><th class="right">${L.open}</th></tr></thead><tbody>
      ${mk.map(k => { const e = mm.get(k); return `<tr><td>${monthLabel(k)}</td><td class="right mono">${e.n}</td>${tdn(e.total)}${tdn(e.done)}${tdn(e.total - e.done)}</tr>`; }).join("") || emptyRow(5)}</tbody></table>`);
  return rpTools({ range:true, extra }) + rpMeta(rpPeriodText()) + cards + partyTable + prodTable + monthTable;
}

/* ---------- Cashflow Analysis ---------- */
function rpCashflowAnalysis(){
  repInit();
  const lines = viewLines(), from = repState.from, to = repState.to, today = toISO(new Date());
  const bank = lines.filter(l => accInfo(l.acc).sub === "bank");
  const open = bank.filter(l => l.date < from).reduce((s, l) => s + l.dr - l.cr, 0);
  const mm = new Map();
  bank.filter(l => l.date >= from && l.date <= to).forEach(l => { const k = monthKey(l.date); const e = mm.get(k) || { inn:0, out:0 }; e.inn += l.dr; e.out += l.cr; mm.set(k, e); });
  const ks = [...mm.keys()].sort(); let run = open;
  const rows = ks.map(k => { const e = mm.get(k); run += e.inn - e.out; return `<tr><td>${monthLabel(k)}</td>${tdn(e.inn)}${tdn(-e.out)}${tdn(e.inn - e.out)}${tdn(run)}</tr>`; }).join("") || emptyRow(5, "No bank movements in this period.");
  const tIn = ks.reduce((s, k) => s + mm.get(k).inn, 0), tOut = ks.reduce((s, k) => s + mm.get(k).out, 0);
  const chart = ks.length ? svgBarChart(ks.map(monthLabel), [{ label:"Money in", data:ks.map(k => round2(mm.get(k).inn)), color:"#2CA01C" }, { label:"Money out", data:ks.map(k => round2(mm.get(k).out)), color:"#0077C5" }]) : "";
  const actual = panel("Actual cash movement", (chart ? `<div class="panel-body pad">${chart}</div>` : "") + `<table class="grid"><thead><tr><th>Month</th><th class="right">Money in</th><th class="right">Money out</th><th class="right">Net</th><th class="right">Closing cash</th></tr></thead><tbody>
      <tr class="rp-sec"><td colspan="4">Opening cash</td>${tdn(open)}</tr>${rows}</tbody><tfoot><tr class="rp-grand"><td>Total</td>${tdn(tIn)}${tdn(-tOut)}${tdn(tIn - tOut)}${tdn(open + tIn - tOut)}</tr></tfoot></table>`);
  // forecast from outstanding documents, by due month
  const H = Number(repState.horizon) || 6;
  const keys = []; for(let i = 0; i < H; i++) keys.push(monthKey(addMonthsISO(today.slice(0, 8) + "01", i)));
  const inF = keys.map(() => 0), outF = keys.map(() => 0);
  const place = (arr, d) => { let k = monthKey(d.due); if(k < keys[0]) k = keys[0]; const i = keys.indexOf(k); if(i >= 0) arr[i] += d.amount; };
  outstandingDocs("invoice", today).forEach(d => place(inF, d)); outstandingDocs("po", today).forEach(d => place(outF, d));
  let cash = bank.filter(l => l.date <= today).reduce((s, l) => s + l.dr - l.cr, 0); const startCash = cash;
  const frows = keys.map((k, i) => { cash += inF[i] - outF[i]; return `<tr><td>${monthLabel(k)}${i === 0 ? ' <span style="font-size:10.5px;color:var(--muted)">(incl. overdue)</span>' : ""}</td>${tdn(inF[i])}${tdn(-outF[i])}${tdn(inF[i] - outF[i])}${tdn(cash)}</tr>`; }).join("");
  const fchart = svgBarChart(keys.map(monthLabel), [{ label:"Expected in", data:inF.map(round2), color:"#2CA01C" }, { label:"Expected out", data:outF.map(round2), color:"#0077C5" }]);
  const extra = `<div class="field"><label>Forecast horizon</label><select onchange="repSet('horizon',this.value)">${[3, 6, 12].map(n => `<option value="${n}" ${n === H ? "selected" : ""}>${n} months</option>`).join("")}</select></div>`;
  const forecast = panel("Forecast — outstanding invoices and unpaid purchase orders by due month", `<div class="panel-body pad">${fchart}</div><table class="grid"><thead><tr><th>Due month</th><th class="right">Expected in (customers)</th><th class="right">Expected out (vendors)</th><th class="right">Net</th><th class="right">Projected cash</th></tr></thead><tbody>
      <tr class="rp-sec"><td colspan="4">Cash today</td>${tdn(startCash)}</tr>${frows}</tbody></table>`,
      "Assumes every outstanding invoice is received, and every unpaid purchase order is paid, in its due month (overdue items fall into the current month).");
  return rpTools({ range:true, extra }) + rpMeta(rpPeriodText()) + actual + forecast;
}

/* ---------- Analytic Report ---------- */
function rpAnalytic(){
  repInit();
  const lines = viewLines().filter(l => isPL(l.acc) && l.date >= repState.from && l.date <= repState.to);
  const m = new Map();
  lines.forEach(l => { const k = l.analytic || ""; const e = m.get(k) || { inc:0, exp:0, acc:new Map() }; const t = accInfo(l.acc).type;
    const v = t === "income" ? l.cr - l.dr : l.dr - l.cr; if(t === "income") e.inc += v; else e.exp += v; e.acc.set(l.acc, (e.acc.get(l.acc) || 0) + (t === "income" ? v : -v)); m.set(k, e); });
  const keys = [...m.keys()].sort((a, b) => analyticName(a).localeCompare(analyticName(b)));
  const T = { inc:0, exp:0 };
  const rows = keys.map(k => { const e = m.get(k); T.inc += e.inc; T.exp += e.exp; return `<tr><td>${escHtml(analyticName(k))}</td>${tdn(e.inc)}${tdn(-e.exp)}${tdn(e.inc - e.exp)}<td class="right mono">${pct(e.inc - e.exp, e.inc)}</td></tr>`; }).join("") || emptyRow(5, "No income or expenses in this period.");
  const detail = keys.map(k => { const e = m.get(k); return panel(escHtml(analyticName(k)), `<table class="grid"><tbody>${[...e.acc.entries()].sort().map(([c, v]) => `<tr><td class="mono" style="width:90px">${c}</td><td>${escHtml(accInfo(c).name)}</td>${tdn(v)}</tr>`).join("")}</tbody>
      <tfoot><tr class="rp-total"><td colspan="2">Balance (income − expenses)</td>${tdn(e.inc - e.exp)}</tr></tfoot></table>`); }).join("");
  return rpTools({ range:true }) + rpMeta(rpPeriodText())
    + panel("Profitability by analytic account", `<table class="grid"><thead><tr><th>Analytic account</th><th class="right">Income</th><th class="right">Expenses</th><th class="right">Balance</th><th class="right">Margin</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="rp-grand"><td>Total</td>${tdn(T.inc)}${tdn(-T.exp)}${tdn(T.inc - T.exp)}<td class="right mono">${pct(T.inc - T.exp, T.inc)}</td></tr></tfoot></table>`,
      "Tag invoices, purchase orders, fixed assets and journal lines with an analytic account (cost centre / shipment / project) — manage them under Accounting → Analytic Accounts.")
    + detail;
}

/* ---------- Executive Summary ---------- */
function rpExecutive(){
  repInit();
  const lines = viewLines(), from = repState.from, to = repState.to, today = toISO(new Date());
  const pl = plSummary(lines, from, to), pos = positionAt(lines, to), cf = cfCompute(lines, from, to);
  const days = Math.max(1, Math.round((parseDate(to) - parseDate(from)) / 86400000) + 1);
  const dso = pl.rev ? pos.recv / pl.rev * days : 0, dpo = pl.cogs ? pos.pay / pl.cogs * days : 0;
  const recvCash = [...cf.cats.op.entries()].filter(([l]) => l.includes("customers")).reduce((s, [, v]) => s + v, 0);
  const cur = ratio => pos.curLiab ? ratio / pos.curLiab : 0;
  const oi = outstandingDocs("invoice", today).filter(d => d.due < today), op = outstandingDocs("po", today).filter(d => d.due < today);
  const kpi = (label, val, foot, cls) => `<div class="card ${cls || ""}"><div class="label">${label}</div><div class="value ${cls === "red" ? "red" : ""}" style="font-size:19px;">${val}</div>${foot ? `<div class="foot">${foot}</div>` : ""}</div>`;
  const grid = (title, items) => `<div class="panel"><div class="panel-head"><h2>${title}</h2></div><div class="panel-body pad"><div class="cards" style="margin-bottom:0;">${items.join("")}</div></div></div>`;
  return rpTools({ range:true }) + rpMeta(rpPeriodText())
    + grid("Performance", [kpi("Revenue", nf(pl.rev)), kpi("Gross profit", nf(pl.gross), "Margin " + pct(pl.gross, pl.rev), "gold"), kpi("Operating expenses", nf(pl.opex)), kpi("Net profit", nf(pl.net), "Margin " + pct(pl.net, pl.rev), pl.net < 0 ? "red" : "")])
    + grid("Cash", [kpi("Cash at start", nf(cf.open)), kpi("Net cash movement", nf(cf.change), "", cf.change < 0 ? "red" : "gold"), kpi("Cash at end", nf(cf.close)), kpi("Received from customers", nf(recvCash))])
    + grid("Position at " + fmtDate(to), [kpi("Receivable (outstanding)", nf(pos.recv)), kpi("Payable (unpaid)", nf(pos.pay), "", "gold"), kpi("Total assets", nf(pos.assets)), kpi("Net assets (equity)", nf(pos.equity))])
    + grid("Ratios & alerts", [kpi("Current ratio", cur(pos.curAssets).toFixed(2), "current assets ÷ current liabilities"), kpi("Days sales outstanding", dso.toFixed(0) + " days", "average time customers take to pay"), kpi("Days payables outstanding", dpo.toFixed(0) + " days", "average time we take to pay vendors"),
      kpi("Overdue", oi.length + " invoices · " + op.length + " POs", nf(oi.reduce((s, d) => s + d.amount, 0)) + " outstanding overdue from customers", oi.length ? "red" : "")]);
}

/* ---------- Loans Analysis ---------- */
function rpLoans(){
  repInit();
  const today = toISO(new Date());
  const list = loans.filter(l => inView(l.currency || baseCur()));
  const info = list.map(l => { const s = loanSchedule(l), taken = l.type !== "given", cur = l.currency || baseCur();
    const paid = s.rows.filter(r => (l.paid || {})[r.k]), unpaid = s.rows.filter(r => !(l.paid || {})[r.k]);
    const outstanding = round2((Number(l.principal) || 0) - paid.reduce((a, r) => a + r.principal, 0));
    const overdue = unpaid.filter(r => r.due < today), next = unpaid[0];
    return { l, s, taken, cur, paid, unpaid, outstanding, overdue, next, intPaid:paid.reduce((a, r) => a + r.interest, 0), intLeft:unpaid.reduce((a, r) => a + r.interest, 0) }; });
  const Σ = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const taken = info.filter(x => x.taken), given = info.filter(x => !x.taken);
  const nxt = taken.filter(x => x.next).sort((a, b) => a.next.due < b.next.due ? -1 : 1)[0];
  const cards = `<div class="cards">
      <div class="card"><div class="label">Loans taken — outstanding</div><div class="value" style="font-size:19px;">${nf(Σ(taken, x => vamt(x.cur, x.outstanding)))}</div><div class="foot">${taken.length} loan(s) · principal ${nf(Σ(taken, x => vamt(x.cur, Number(x.l.principal) || 0)))}</div></div>
      <div class="card gold"><div class="label">Loans given — outstanding</div><div class="value" style="font-size:19px;">${nf(Σ(given, x => vamt(x.cur, x.outstanding)))}</div><div class="foot">${given.length} loan(s)</div></div>
      <div class="card"><div class="label">Interest paid / received to date</div><div class="value" style="font-size:19px;">${nf(Σ(info, x => vamt(x.cur, x.intPaid)))}</div><div class="foot">still to come: ${nf(Σ(info, x => vamt(x.cur, x.intLeft)))}</div></div>
      <div class="card ${Σ(info, x => x.overdue.length) ? "red" : ""}"><div class="label">Next instalment (loans taken)</div><div class="value" style="font-size:19px;">${nxt ? nf(vamt(nxt.cur, nxt.next.installment)) : "—"}</div><div class="foot">${nxt ? fmtDate(nxt.next.due) + " · " + escHtml(nxt.l.party) : "nothing due"}${Σ(info, x => x.overdue.length) ? " · <b>" + Σ(info, x => x.overdue.length) + " overdue</b>" : ""}</div></div></div>`;
  const rows = info.map(x => `<tr><td>${escHtml(x.l.party)}</td><td>${x.taken ? "Taken (we owe)" : "Given (owed to us)"}</td><td class="mono">${fmtDate(x.l.startDate)}</td><td class="right mono">${nf(Number(x.l.principal) || 0)} ${escHtml(curCode(x.cur))}</td><td class="right mono">${Number(x.l.rate) || 0}%</td>
      <td class="right mono">${x.l.termMonths} mo</td><td class="right mono">${nf(x.s.emi)}</td><td class="right mono">${x.paid.length}/${x.s.rows.length}</td>${tdn(vamt(x.cur, x.outstanding))}${tdn(vamt(x.cur, x.intPaid))}
      <td>${x.overdue.length ? `<span class="pill overdue">${x.overdue.length} overdue</span>` : x.next ? fmtDate(x.next.due) : '<span class="pill paid">Settled</span>'}</td></tr>`).join("") || emptyRow(11, "No loans yet — add them under Accounting → Loans.");
  const summary = panel("Loans", `<table class="grid"><thead><tr><th>Counterparty</th><th>Type</th><th>Start</th><th class="right">Principal</th><th class="right">Rate p.a.</th><th class="right">Term</th><th class="right">Instalment</th><th class="right">Paid</th><th class="right">Outstanding</th><th class="right">Interest paid</th><th>Next due</th></tr></thead><tbody>${rows}</tbody></table>`,
    "Outstanding and interest columns are shown in the report currency; principal and instalment in the loan's own currency. Mark instalments as paid in Accounting → Loans — that posts the bank, loan and interest entries.");
  const sched = info.map(x => panel(escHtml(x.l.party) + " — " + (x.taken ? "repayment" : "collection") + " schedule (" + escHtml(curCode(x.cur)) + ")", `<table class="grid"><thead><tr><th>#</th><th>Due</th><th class="right">Opening</th><th class="right">Principal</th><th class="right">Interest</th><th class="right">Instalment</th><th class="right">Closing</th><th>Status</th></tr></thead><tbody>
      ${x.s.rows.map(r => { const pd = (x.l.paid || {})[r.k]; return `<tr><td class="mono">${r.k}</td><td class="mono">${fmtDate(r.due)}</td>${tdn(r.opening)}${tdn(r.principal)}${tdn(r.interest)}${tdn(r.installment)}${tdn(r.closing)}
        <td>${pd ? '<span class="pill paid">' + (x.taken ? "Paid " : "Received ") + fmtDate(pd) + '</span>' : r.due < today ? '<span class="pill overdue">Overdue</span>' : '<span class="pill unpaid">Scheduled</span>'}</td></tr>`; }).join("")}</tbody></table>`)).join("");
  return rpTools({ cur:true }) + rpMeta("As of " + fmtDate(today)) + cards + summary + sched;
}

defReport("rep_partner", "Partner Ledger", "Receivable and payable entries per customer / vendor", rpPartnerLedger);
defReport("rep_custstmt", "Customer Statement", "Invoices, receipts and outstanding balance for one customer", rpCustomerStatement);
defReport("rep_agedrec", "Aged Receivable", "Outstanding customer invoices by days overdue", () => rpAged("invoice"));
defReport("rep_agedpay", "Aged Payable", "Unpaid vendor purchase orders by days overdue", () => rpAged("po"));
defReport("rep_tax", "Tax Report", "Output and input tax by rate, and the net tax position", rpTax);
defReport("rep_fiscal", "Fiscal Report", "Quarter-by-quarter results and year-end position", rpFiscal);
defReport("rep_invanalysis", "Invoice Analysis", "Sales (or purchases) by customer, product and month", rpInvoiceAnalysis);
defReport("rep_cfanalysis", "Cashflow Analysis", "Actual cash movement and a forecast from due dates", rpCashflowAnalysis);
defReport("rep_analytic", "Analytic Report", "Income and expenses per analytic account (cost centre)", rpAnalytic);
defReport("rep_exec", "Executive Summary", "Key figures, ratios and alerts on one page", rpExecutive);
defReport("rep_loans", "Loans Analysis", "Loans taken and given: schedules, interest and what is due", rpLoans);
