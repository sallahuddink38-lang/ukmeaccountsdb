/* =====================================================================
   ACCOUNTING ENGINE  (ledger.js)
   Turns invoices, purchase orders, payments, manual journal entries,
   fixed assets and loans into ONE double-entry ledger (every move has
   equal debits and credits). All reports (reports.js) read from here.
   ===================================================================== */

/* ---------- date helpers ---------- */
function addMonthsISO(iso, n){
  const d = parseDate(iso), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}
function fiscalStartMonth(){ return Math.min(12, Math.max(1, Number(settings.advanced.fiscalStartMonth) || 1)); }
function fyStartISO(iso){
  const fm = fiscalStartMonth(), d = parseDate(iso);
  let y = d.getFullYear(); if(d.getMonth() + 1 < fm) y--;
  return y + "-" + pad2(fm) + "-01";
}
function fyEndISO(iso){ return addDaysISO(addMonthsISO(fyStartISO(iso), 12), -1); }
function fyLabel(startIso){
  const y = Number(startIso.slice(0, 4));
  return fiscalStartMonth() === 1 ? "FY " + y : "FY " + y + "/" + String(y + 1).slice(2);
}
function monthKey(iso){ return iso.slice(0, 7); }
function monthLabel(key){ const [y, m] = key.split("-"); return MONTH_NAMES[Number(m) - 1].slice(0, 3) + " " + y; }

/* ---------- currency / FX ---------- */
function curCode(cur){
  const o = CURRENCY_OPTIONS.find(x => x[0] === cur);
  if(o){ const m = o[1].match(/^([A-Z]{3})/); if(m) return m[1]; }
  return String(cur || "").trim() || "—";
}
function baseCur(){ return (settings.fx && settings.fx.base) || "£"; }
function fxRate(cur){
  if(cur === baseCur()) return 1;
  const n = Number(((settings.fx || {}).rates || {})[cur]);
  return n > 0 ? n : 1;
}
function fxMissing(cur){ return cur !== baseCur() && !(Number(((settings.fx || {}).rates || {})[cur]) > 0); }
function usedCurrencies(){
  const set = [];
  const add = c => { if(c && !set.includes(c)) set.push(c); };
  add(baseCur());
  invoices.forEach(d => add(d.currency)); purchaseOrders.forEach(d => add(d.currency));
  journalEntries.forEach(j => add(j.currency)); fixedAssets.forEach(a => add(a.currency)); loans.forEach(l => add(l.currency));
  return set;
}

/* ---------- chart of accounts used by the ledger ---------- */
const ACC = {
  "1100": { name:"Accounts Receivable",            type:"asset",     sub:"receivable" },
  "1210": { name:"Input VAT (tax recoverable)",    type:"asset",     sub:"current" },
  "1300": { name:"Loans Given (receivable)",       type:"asset",     sub:"current" },
  "1500": { name:"Fixed Assets — Cost",            type:"asset",     sub:"fixed" },
  "1510": { name:"Accumulated Depreciation",       type:"asset",     sub:"fixed" },
  "2100": { name:"Accounts Payable",               type:"liability", sub:"payable" },
  "2210": { name:"Output VAT (tax payable)",       type:"liability", sub:"current" },
  "2300": { name:"Loans Taken (payable)",          type:"liability", sub:"noncurrent" },
  "3900": { name:"Retained Earnings (previous years)", type:"equity", sub:"equity" },
  "4000": { name:"Sales Revenue",                  type:"income",    sub:"income" },
  "4100": { name:"Interest Income",                type:"income",    sub:"other" },
  "5000": { name:"Purchases / Cost of Goods",      type:"expense",   sub:"cogs" },
  "6000": { name:"Depreciation Expense",           type:"expense",   sub:"opex" },
  "6100": { name:"Interest Expense",               type:"expense",   sub:"other" }
};
function bankCodeFor(cur){
  if(cur === "£") return "1000";
  if(cur === "$") return "1010";
  const i = CURRENCY_OPTIONS.findIndex(o => o[0] === cur);
  return i >= 0 ? "10" + (20 + i) : "1099";
}
function bankNameFor(code){
  if(code === "1000") return "Bank — GBP";
  if(code === "1010") return "Bank — USD";
  const o = CURRENCY_OPTIONS.find(x => bankCodeFor(x[0]) === code);
  return o ? "Bank — " + curCode(o[0]) : "Bank — other currency";
}
function accInfo(code){
  code = String(code);
  if(ACC[code]) return ACC[code];
  if(/^10\d\d$/.test(code)) return { name:bankNameFor(code), type:"asset", sub:"bank" };
  const m = manualAccounts.find(a => String(a.code) === code);
  if(m){
    const sub = { asset:"current", liability:"current", equity:"equity", income:"income", expense:"opex" }[m.type] || "current";
    return { name:m.name, type:m.type, sub };
  }
  return { name:"Account " + code, type:"asset", sub:"current" };
}
function accName(code){ return code + " " + accInfo(code).name; }
function isPL(code){ const t = accInfo(code).type; return t === "income" || t === "expense"; }
/* list used by the journal-entry form drop-downs */
function postingAccountList(){
  const out = [];
  Object.keys(ACC).filter(c => c !== "3900").forEach(c => out.push([c, ACC[c].name]));
  CURRENCY_OPTIONS.forEach(o => { const c = bankCodeFor(o[0]); if(!out.some(x => x[0] === c)) out.push([c, bankNameFor(c)]); });
  manualAccounts.forEach(a => { if(!out.some(x => x[0] === String(a.code))) out.push([String(a.code), a.name]); });
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

/* ---------- fixed assets & loans: schedules ---------- */
function taxPart(total, rate){ rate = Number(rate) || 0; return rate > 0 ? round2(total - total / (1 + rate / 100)) : 0; }

function assetSchedule(a){
  const cost = Number(a.cost) || 0, salv = Math.min(cost, Math.max(0, Number(a.salvage) || 0));
  const months = Math.max(1, Math.round((Number(a.lifeYears) || 1) * 12));
  if(!a.purchaseDate) return [];
  const d0 = parseDate(a.purchaseDate), out = [];
  let acc = 0;
  for(let k = 0; k < months; k++){
    const dt = new Date(d0.getFullYear(), d0.getMonth() + k + 1, 0);       // end of month k
    let dep;
    if(a.method === "declining"){
      const rate = (Number(a.rate) || (200 / Math.max(1, Number(a.lifeYears) || 1))) / 100;
      dep = round2((cost - acc) * rate / 12);
      if(cost - acc - dep < salv) dep = round2(Math.max(0, cost - acc - salv));
    } else {
      dep = round2((cost - salv) / months);
      if(k === months - 1) dep = round2(cost - salv - acc);                 // absorb rounding in the last month
    }
    acc = round2(acc + dep);
    out.push({ date:toISO(dt), dep, accum:acc, nbv:round2(cost - acc) });
  }
  return out;
}
function loanSchedule(l){
  const P = Number(l.principal) || 0, n = Math.max(1, parseInt(l.termMonths) || 1), i = (Number(l.rate) || 0) / 1200;
  const emi = i > 0 ? round2(P * i / (1 - Math.pow(1 + i, -n))) : round2(P / n);
  let bal = P; const rows = [];
  for(let k = 1; k <= n; k++){
    const interest = round2(bal * i);
    let principal = k === n ? bal : round2(emi - interest);
    if(principal > bal) principal = bal;
    const closing = round2(bal - principal);
    rows.push({ k, due:addMonthsISO(l.startDate, k), opening:bal, principal, interest, installment:round2(principal + interest), closing });
    bal = closing;
  }
  return { emi, rows };
}

/* ---------- the ledger ---------- */
function aeMoves(){
  const out = []; let n = 0;
  const today = toISO(new Date());
  const mk = (date, ref, label, cur, src, partner, lines) => {
    const ls = lines.map(l => ({ acc:l[0], debit:round2(l[1] || 0), credit:round2(l[2] || 0), partner:(l[3] !== undefined ? l[3] : partner), analytic:l[4] || "" }))
                    .filter(l => l.debit || l.credit);
    if(ls.length) out.push({ mid:"m" + (n++), date, ref, label, cur, src, lines:ls });
  };
  invoices.forEach(d => {
    if(!d.invoiceDate) return;
    const total = docTotal(d.items), tax = taxPart(total, d.taxRate), base = round2(total - tax), cur = d.currency || "£", party = (d.billTo || {}).company || "—";
    mk(d.invoiceDate, d.invoiceNo, "Customer invoice", cur, "invoice", party, [["1100", total, 0], ["4000", 0, base, party, d.analytic], ["2210", 0, tax]]);
    if(d.status === "paid" && d.paidDate) mk(d.paidDate, d.invoiceNo, "Payment received", cur, "payment_in", party, [[bankCodeFor(cur), total, 0], ["1100", 0, total]]);
  });
  purchaseOrders.forEach(d => {
    if(!d.poDate) return;
    const total = docTotal(d.items), tax = taxPart(total, d.taxRate), base = round2(total - tax), cur = d.currency || "$", party = (d.vendor || {}).name || "—";
    mk(d.poDate, d.poNo, "Vendor purchase order", cur, "po", party, [["5000", base, 0, party, d.analytic], ["1210", tax, 0], ["2100", 0, total]]);
    if(d.status === "paid" && d.paidDate) mk(d.paidDate, d.poNo, "Payment made", cur, "payment_out", party, [["2100", total, 0], [bankCodeFor(cur), 0, total]]);
  });
  journalEntries.forEach(j => {
    mk(j.date, j.ref || "JE", j.label || "Journal entry", j.currency || baseCur(), "manual", "",
       (j.lines || []).map(l => [String(l.account), Number(l.debit) || 0, Number(l.credit) || 0, l.partner || "", l.analytic || ""]));
  });
  fixedAssets.forEach(a => {
    const cur = a.currency || baseCur(), cost = Number(a.cost) || 0;
    if(!a.purchaseDate) return;
    mk(a.purchaseDate, "ASSET", "Purchase of " + a.name, cur, "asset", "", [["1500", cost, 0], [bankCodeFor(cur), 0, cost]]);
    assetSchedule(a).forEach(s => {
      if(s.date <= today && s.dep > 0) mk(s.date, "DEP", "Depreciation — " + a.name, cur, "depreciation", "", [["6000", s.dep, 0, "", a.analytic], ["1510", 0, s.dep]]);
    });
  });
  loans.forEach(l => {
    const cur = l.currency || baseCur(), P = Number(l.principal) || 0, taken = l.type !== "given";
    if(!l.startDate) return;
    mk(l.startDate, "LOAN", (taken ? "Loan received — " : "Loan granted — ") + l.party, cur, "loan", l.party,
       taken ? [[bankCodeFor(cur), P, 0], ["2300", 0, P]] : [["1300", P, 0], [bankCodeFor(cur), 0, P]]);
    const sch = loanSchedule(l);
    sch.rows.forEach(r => {
      const pd = (l.paid || {})[r.k];
      if(!pd) return;
      mk(pd, "LOAN", (taken ? "Loan repayment #" : "Loan collection #") + r.k + " — " + l.party, cur, "loan", l.party,
         taken ? [["2300", r.principal, 0], ["6100", r.interest, 0], [bankCodeFor(cur), 0, r.installment]]
               : [[bankCodeFor(cur), r.installment, 0], ["1300", 0, r.principal], ["4100", 0, r.interest]]);
    });
  });
  return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

/* ---------- report view state (period, currency, filters) ---------- */
const repState = { preset:"fy", from:"", to:"", asOf:"", cur:"ALL", compare:false, partner:"all", ptype:"both", account:"all",
                   fy:"", details:true, kind:"sales", horizon:6, customer:"", analytic:"all" };
function repInit(){
  if(repState.to) return;
  const t = toISO(new Date());
  repState.to = t; repState.asOf = t; repState.from = fyStartISO(t); repState.fy = fyStartISO(t);
}
function viewLines(){
  repInit();
  const out = [];
  aeMoves().forEach(m => {
    if(repState.cur !== "ALL" && m.cur !== repState.cur) return;
    const f = repState.cur === "ALL" ? fxRate(m.cur) : 1;
    m.lines.forEach(l => out.push({ mid:m.mid, date:m.date, ref:m.ref, label:m.label, cur:m.cur, src:m.src,
      acc:l.acc, partner:l.partner, analytic:l.analytic, dr:l.debit * f, cr:l.credit * f }));
  });
  return out;
}
function vsym(){ return repState.cur === "ALL" ? baseCur() : repState.cur; }
function vamt(cur, x){ return repState.cur === "ALL" ? x * fxRate(cur) : x; }
function inView(cur){ return repState.cur === "ALL" || repState.cur === cur; }

/* balances: Map acc -> net (debit - credit) at a date; income/expense accounts reset at each fiscal-year start
   and the earlier years' result is carried in 3900 "Retained Earnings (previous years)" */
function tbAt(lines, date){
  const fs = fyStartISO(date), m = new Map();
  let prior = 0;
  lines.forEach(l => {
    if(l.date > date) return;
    if(isPL(l.acc) && l.date < fs){ prior += l.dr - l.cr; return; }
    m.set(l.acc, (m.get(l.acc) || 0) + l.dr - l.cr);
  });
  if(Math.abs(prior) > 0.0049) m.set("3900", (m.get("3900") || 0) + prior);
  return m;
}
function moveAgg(lines, from, to){
  const m = new Map();
  lines.forEach(l => {
    if(l.date < from || l.date > to) return;
    const e = m.get(l.acc) || { dr:0, cr:0 };
    e.dr += l.dr; e.cr += l.cr; m.set(l.acc, e);
  });
  return m;
}
/* natural sign: assets/expenses +debit; liabilities/equity/income +credit */
function natural(code, net){ const t = accInfo(code).type; return (t === "asset" || t === "expense") ? net : -net; }
function sumNat(map, pred){
  let s = 0; map.forEach((net, code) => { if(pred(code, accInfo(code))) s += natural(code, net); });
  return s;
}

/* ---------- outstanding documents as of a date (aged reports, statements) ---------- */
function outstandingDocs(kind, asOf){
  const list = kind === "invoice" ? invoices : purchaseOrders;
  return list.filter(d => {
    const dt = kind === "invoice" ? d.invoiceDate : d.poDate;
    if(!dt || dt > asOf) return false;
    if(d.status === "paid" && d.paidDate && d.paidDate <= asOf) return false;
    return inView(d.currency || (kind === "invoice" ? "£" : "$"));
  }).map(d => ({
    doc:d, kind, no:kind === "invoice" ? d.invoiceNo : d.poNo,
    party:kind === "invoice" ? (d.billTo || {}).company : (d.vendor || {}).name,
    date:kind === "invoice" ? d.invoiceDate : d.poDate, due:dueFieldOf(d) || (kind === "invoice" ? d.invoiceDate : d.poDate),
    cur:d.currency, amount:vamt(d.currency, docTotal(d.items))
  }));
}
const AGE_BUCKETS = [["Not due", null], ["1–30", 30], ["31–60", 60], ["61–90", 90], ["91–120", 120], ["Older", Infinity]];
function ageBucketIndex(due, asOf){
  const days = Math.round((parseDate(asOf) - parseDate(due)) / 86400000);
  if(days <= 0) return 0;
  for(let i = 1; i < AGE_BUCKETS.length; i++) if(days <= AGE_BUCKETS[i][1]) return i;
  return AGE_BUCKETS.length - 1;
}
