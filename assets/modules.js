/* =====================================================================
   ACCOUNTING MODULES (modules.js)
   Journal Entries · Fixed Assets · Loans · Analytic Accounts ·
   Settings → Tax & Currency · reports menu · CSV export
   These feed the ledger (ledger.js) that every report reads from.
   ===================================================================== */

function defView(id, title, sub, render, actions){ EXTRA_VIEWS[id] = { title, sub, render, actions }; titles[id] = [title, sub]; }
function persistAndRender(){ saveMeta(); render(); }
function openModal(html){ document.getElementById("formModal").innerHTML = html; document.getElementById("formOverlay").classList.add("show"); }
function num2(id){ const el = document.getElementById(id); return el ? (parseFloat(el.value) || 0) : 0; }
function val(id){ const el = document.getElementById(id); return el ? el.value : ""; }

/* ---------- reports menu ---------- */
function toggleRepMenu(){ const m = document.getElementById("repMenu"); if(m) m.classList.toggle("collapsed"); const b = document.getElementById("repToggle"); if(b) b.classList.toggle("open"); }

/* ---------- CSV export of whatever report is on screen ---------- */
function exportViewCSV(){
  const rows = [];
  const [title] = titles[currentView] || ["report"];
  rows.push([title], [document.querySelector("#content .rp-meta") ? document.querySelector("#content .rp-meta").textContent : ""], []);
  document.querySelectorAll("#content table").forEach(t => {
    const h = t.closest(".panel") && t.closest(".panel").querySelector(".panel-head h2");
    if(h) rows.push([h.textContent.trim()]);
    t.querySelectorAll("tr").forEach(tr => {
      const r = [];
      tr.querySelectorAll("th,td").forEach(c => { r.push(c.textContent.trim().replace(/\s+/g, " ")); for(let i = 1; i < (c.colSpan || 1); i++) r.push(""); });
      rows.push(r);
    });
    rows.push([]);
  });
  const csv = rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type:"text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "UKME-" + title.replace(/[^a-z0-9]+/gi, "-") + "-" + toISO(new Date()) + ".csv";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ========================================================================
   JOURNAL ENTRIES
   ======================================================================== */
function renderJournal(){
  const rows = journalEntries.slice().sort((a, b) => a.date < b.date ? 1 : -1).map(j => {
    const tot = (j.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0);
    return `<tr><td class="mono">${fmtDate(j.date)}</td><td class="mono">${escHtml(j.ref || "")}</td><td>${escHtml(j.label || "")}</td>
      <td>${(j.lines || []).map(l => escHtml(accName(l.account))).join("<br>")}</td><td class="mono">${escHtml(curCode(j.currency))}</td><td class="right mono">${nf(tot)}</td>
      <td class="right"><button class="icon-btn" onclick="openJournalForm('${j.id}')">Edit</button><button class="icon-btn" onclick="deleteJournal('${j.id}')">Delete</button></td></tr>`;
  }).join("") || emptyRow(7, "No manual journal entries yet. Use “+ New Journal Entry” for expenses, owner capital, tax payments, opening balances and adjustments.");
  return panel("Manual journal entries", `<table class="grid"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Accounts</th><th>Currency</th><th class="right">Amount</th><th></th></tr></thead><tbody>${rows}</tbody></table>`,
    "Invoices, purchase orders, payments received/made, depreciation and loan instalments are posted to the ledger <b>automatically</b> — you do not enter those here. Every entry must balance (total debit = total credit). See the General Ledger report for all postings.");
}
function jeLineRow(l){
  l = l || {};
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><select class="je-acc" style="min-width:210px;">${postingAccountList().map(a => `<option value="${a[0]}" ${String(l.account) === a[0] ? "selected" : ""}>${escHtml(a[0] + " " + a[1])}</option>`).join("")}</select></td>
    <td><input class="je-partner" list="jePartners" value="${escHtml(l.partner || "")}" placeholder="optional" style="width:130px;"></td>
    <td><select class="je-an" style="width:130px;">${analyticOptionsHtml(l.analytic)}</select></td>
    <td><input class="je-dr" type="number" step="0.01" min="0" value="${l.debit || ""}" oninput="jeTotals()" style="width:100px;"></td>
    <td><input class="je-cr" type="number" step="0.01" min="0" value="${l.credit || ""}" oninput="jeTotals()" style="width:100px;"></td>
    <td><button class="icon-btn" onclick="this.closest('tr').remove();jeTotals()">✕</button></td>`;
  document.getElementById("jeBody").appendChild(tr);
}
function jeTotals(){
  let dr = 0, cr = 0;
  document.querySelectorAll("#jeBody tr").forEach(tr => { dr += parseFloat(tr.querySelector(".je-dr").value) || 0; cr += parseFloat(tr.querySelector(".je-cr").value) || 0; });
  const el = document.getElementById("jeTot"); if(!el) return;
  const ok = Math.abs(dr - cr) < 0.005 && dr > 0;
  el.innerHTML = `Debit <b>${nf(dr)}</b> · Credit <b>${nf(cr)}</b> · ` + (ok ? '<span style="color:var(--green)">✓ balanced</span>' : '<span style="color:var(--red)">difference ' + nf(dr - cr) + '</span>');
}
const JE_TEMPLATES = {
  expense:{ label:"Expense paid from bank", lines:[["5100", "d"], ["BANK", "c"]] },
  capital:{ label:"Owner capital introduced", lines:[["BANK", "d"], ["3000", "c"]] },
  drawings:{ label:"Owner drawings", lines:[["3000", "d"], ["BANK", "c"]] },
  taxpay:{ label:"Tax (VAT) paid to authority", lines:[["2210", "d"], ["BANK", "c"]] },
  bankfee:{ label:"Bank charges", lines:[["5100", "d"], ["BANK", "c"]] }
};
function jeApplyTemplate(key){
  const t = JE_TEMPLATES[key]; if(!t) return;
  document.getElementById("jeBody").innerHTML = "";
  const bank = bankCodeFor(val("je_cur"));
  t.lines.forEach(([a, side]) => jeLineRow({ account:a === "BANK" ? bank : a }));
  if(!val("je_label")) document.getElementById("je_label").value = t.label;
  jeTotals();
}
function openJournalForm(id){
  const ed = id ? journalEntries.find(x => x.id === id) : null;
  const v = ed || { date:toISO(new Date()), ref:"", label:"", currency:baseCur(), lines:[] };
  const partners = [...new Set([...invoices.map(d => (d.billTo || {}).company), ...purchaseOrders.map(d => (d.vendor || {}).name)].filter(Boolean))];
  openModal(`<div class="modal-head"><h3>${ed ? "Edit journal entry" : "New journal entry"}</h3><button class="modal-close" onclick="closeForm()">&times;</button></div>
    <div class="modal-body" style="max-width:100%;">
      <datalist id="jePartners">${partners.map(p => `<option value="${escHtml(p)}">`).join("")}</datalist>
      <div class="form-row three"><div class="field"><label>Date</label><input id="je_date" type="date" value="${escHtml(v.date)}"></div>
        <div class="field"><label>Reference</label><input id="je_ref" value="${escHtml(v.ref)}" placeholder="JE-001"></div>
        <div class="field"><label>Currency</label>${currencySelectHtml("je_cur", v.currency || baseCur(), "jeCurChange")}</div></div>
      <div class="form-row"><div class="field"><label>Description</label><input id="je_label" value="${escHtml(v.label)}" placeholder="e.g. Freight paid for shipment 607-54451913"></div>
        <div class="field"><label>Start from a template</label><select onchange="jeApplyTemplate(this.value)"><option value="">— choose —</option>${Object.entries(JE_TEMPLATES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("")}</select></div></div>
      <table class="items-edit-table"><thead><tr><th>Account</th><th>Partner</th><th>Analytic</th><th>Debit</th><th>Credit</th><th></th></tr></thead><tbody id="jeBody"></tbody></table>
      <button class="btn ghost small" style="margin-top:8px;" onclick="jeLineRow()">+ Add line</button>
      <div id="jeTot" style="text-align:right;margin-top:12px;font-size:13px;"></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" onclick="closeForm()">Cancel</button><button class="btn" onclick="saveJournal(${ed ? "'" + ed.id + "'" : "null"})">${ed ? "Save changes" : "Post entry"}</button></div>`);
  if(v.lines.length) v.lines.forEach(jeLineRow); else { jeLineRow(); jeLineRow(); }
  jeTotals();
}
function jeCurChange(){ /* bank account in templates is chosen when the template is applied */ }
function saveJournal(id){
  const lines = [...document.querySelectorAll("#jeBody tr")].map(tr => ({
    account:tr.querySelector(".je-acc").value, partner:tr.querySelector(".je-partner").value.trim(), analytic:tr.querySelector(".je-an").value,
    debit:round2(parseFloat(tr.querySelector(".je-dr").value) || 0), credit:round2(parseFloat(tr.querySelector(".je-cr").value) || 0)
  })).filter(l => l.debit || l.credit);
  const date = val("je_date");
  if(!date){ alert("Please choose a date."); return; }
  if(lines.length < 2){ alert("A journal entry needs at least two lines."); return; }
  if(lines.some(l => l.debit && l.credit)){ alert("A line can have a debit or a credit, not both."); return; }
  const dr = lines.reduce((s, l) => s + l.debit, 0), cr = lines.reduce((s, l) => s + l.credit, 0);
  if(Math.abs(dr - cr) > 0.005){ alert("The entry does not balance: debit " + nf(dr) + " vs credit " + nf(cr) + "."); return; }
  const rec = { date, ref:val("je_ref").trim(), label:val("je_label").trim(), currency:val("je_cur"), lines };
  if(id){ Object.assign(journalEntries.find(x => x.id === id), rec); }
  else{ journalEntries.push(Object.assign({ id:uid("je") }, rec)); if(!rec.ref) journalEntries[journalEntries.length - 1].ref = "JE-" + String(journalEntries.length).padStart(3, "0"); }
  closeForm(); persistAndRender();
}
function deleteJournal(id){ if(!confirm("Delete this journal entry? Reports will no longer include it.")) return; journalEntries = journalEntries.filter(x => x.id !== id); persistAndRender(); }

/* ========================================================================
   FIXED ASSETS
   ======================================================================== */
function renderAssets(){
  const today = toISO(new Date());
  const rows = fixedAssets.map(a => {
    const s = assetSchedule(a), acc = s.filter(x => x.date <= today).reduce((m, x) => x.accum, 0), cost = Number(a.cost) || 0;
    return `<tr><td>${escHtml(a.name)}<div style="font-size:11px;color:var(--muted)">${escHtml(a.category || "")}</div></td><td class="mono">${fmtDate(a.purchaseDate)}</td>
      <td class="right mono">${escHtml(curCode(a.currency))} ${nf(cost)}</td><td>${a.method === "declining" ? "Declining balance" : "Straight-line"} · ${a.lifeYears} yrs</td>
      <td class="right mono">${nf(acc)}</td><td class="right mono">${nf(cost - acc)}</td><td>${escHtml(analyticName(a.analytic))}</td>
      <td class="right"><button class="icon-btn" onclick="openAssetForm('${a.id}')">Edit</button><button class="icon-btn" onclick="deleteAsset('${a.id}')">Delete</button></td></tr>`;
  }).join("") || emptyRow(8, "No fixed assets yet — vehicles, cold-storage equipment, computers, etc.");
  return panel("Fixed assets register", `<table class="grid"><thead><tr><th>Asset</th><th>Purchased</th><th class="right">Cost</th><th>Depreciation</th><th class="right">Accumulated</th><th class="right">Net book value</th><th>Analytic</th><th></th></tr></thead><tbody>${rows}</tbody></table>`,
    "Buying an asset posts Debit <b>1500 Fixed Assets</b> / Credit <b>Bank</b>. Each month end posts Debit <b>6000 Depreciation</b> / Credit <b>1510 Accumulated Depreciation</b>. Reports: Balance Sheet, Profit and Loss, Depreciation Schedule.");
}
function openAssetForm(id){
  const ed = id ? fixedAssets.find(x => x.id === id) : null;
  const v = ed || { name:"", category:"", purchaseDate:toISO(new Date()), cost:"", salvage:0, lifeYears:5, method:"straight", rate:"", currency:baseCur(), analytic:"" };
  openModal(`<div class="modal-head"><h3>${ed ? "Edit fixed asset" : "New fixed asset"}</h3><button class="modal-close" onclick="closeForm()">&times;</button></div>
    <div class="modal-body">
      <div class="form-row"><div class="field"><label>Asset name</label><input id="fa_name" value="${escHtml(v.name)}" placeholder="Refrigerated van"></div><div class="field"><label>Category</label><input id="fa_cat" value="${escHtml(v.category)}" placeholder="Vehicles"></div></div>
      <div class="form-row three"><div class="field"><label>Purchase date</label><input id="fa_date" type="date" value="${escHtml(v.purchaseDate)}"></div>
        <div class="field"><label>Cost</label><input id="fa_cost" type="number" step="0.01" min="0" value="${v.cost}"></div>
        <div class="field"><label>Currency</label>${currencySelectHtml("fa_cur", v.currency || baseCur(), "jeCurChange")}</div></div>
      <div class="form-row three"><div class="field"><label>Residual (salvage) value</label><input id="fa_salv" type="number" step="0.01" min="0" value="${v.salvage}"></div>
        <div class="field"><label>Useful life (years)</label><input id="fa_life" type="number" step="0.5" min="0.5" value="${v.lifeYears}"></div>
        <div class="field"><label>Method</label><select id="fa_method" onchange="document.getElementById('fa_rate_f').style.display=this.value==='declining'?'block':'none'"><option value="straight" ${v.method !== "declining" ? "selected" : ""}>Straight-line</option><option value="declining" ${v.method === "declining" ? "selected" : ""}>Declining balance</option></select></div></div>
      <div class="form-row"><div class="field" id="fa_rate_f" style="display:${v.method === "declining" ? "block" : "none"}"><label>Declining rate % per year (blank = double-declining)</label><input id="fa_rate" type="number" step="0.01" min="0" value="${v.rate || ""}"></div>
        <div class="field"><label>Analytic account</label><select id="fa_an">${analyticOptionsHtml(v.analytic)}</select></div></div>
    </div>
    <div class="modal-foot"><button class="btn ghost" onclick="closeForm()">Cancel</button><button class="btn" onclick="saveAsset(${ed ? "'" + ed.id + "'" : "null"})">Save asset</button></div>`);
}
function saveAsset(id){
  const rec = { name:val("fa_name").trim(), category:val("fa_cat").trim(), purchaseDate:val("fa_date"), cost:num2("fa_cost"), salvage:num2("fa_salv"), lifeYears:num2("fa_life"),
    method:val("fa_method"), rate:num2("fa_rate") || "", currency:val("fa_cur"), analytic:val("fa_an") };
  if(!rec.name){ alert("Please enter the asset name."); return; }
  if(!rec.purchaseDate){ alert("Please choose the purchase date."); return; }
  if(rec.cost <= 0){ alert("Cost must be greater than zero."); return; }
  if(rec.salvage > rec.cost){ alert("Residual value cannot exceed the cost."); return; }
  if(rec.lifeYears <= 0){ alert("Useful life must be greater than zero."); return; }
  if(id) Object.assign(fixedAssets.find(x => x.id === id), rec); else fixedAssets.push(Object.assign({ id:uid("fa") }, rec));
  closeForm(); persistAndRender();
}
function deleteAsset(id){ if(!confirm("Delete this asset? Its purchase and depreciation postings disappear from the reports.")) return; fixedAssets = fixedAssets.filter(x => x.id !== id); persistAndRender(); }

/* ========================================================================
   LOANS
   ======================================================================== */
function renderLoans(){
  const today = toISO(new Date());
  const rows = loans.map(l => {
    const s = loanSchedule(l), paid = s.rows.filter(r => (l.paid || {})[r.k]), unpaid = s.rows.filter(r => !(l.paid || {})[r.k]);
    const out = round2((Number(l.principal) || 0) - paid.reduce((a, r) => a + r.principal, 0)), od = unpaid.filter(r => r.due < today).length;
    return `<tr><td>${escHtml(l.party)}</td><td>${l.type === "given" ? "Given (owed to us)" : "Taken (we owe)"}</td><td class="mono">${fmtDate(l.startDate)}</td>
      <td class="right mono">${escHtml(curCode(l.currency))} ${nf(Number(l.principal) || 0)}</td><td class="right mono">${Number(l.rate) || 0}%</td><td class="right mono">${l.termMonths} mo</td>
      <td class="right mono">${paid.length}/${s.rows.length}</td><td class="right mono">${nf(out)}</td>
      <td>${od ? `<span class="pill overdue">${od} overdue</span>` : unpaid[0] ? fmtDate(unpaid[0].due) : '<span class="pill paid">Settled</span>'}</td>
      <td class="right"><button class="icon-btn" onclick="openLoanSchedule('${l.id}')">Schedule</button><button class="icon-btn" onclick="openLoanForm('${l.id}')">Edit</button><button class="icon-btn" onclick="deleteLoan('${l.id}')">Delete</button></td></tr>`;
  }).join("") || emptyRow(10, "No loans yet. Add a loan you have taken (we owe) or given (owed to us).");
  return panel("Loans", `<table class="grid"><thead><tr><th>Counterparty</th><th>Type</th><th>Start</th><th class="right">Principal</th><th class="right">Rate</th><th class="right">Term</th><th class="right">Paid</th><th class="right">Outstanding</th><th>Next due</th><th></th></tr></thead><tbody>${rows}</tbody></table>`,
    "Equal monthly instalments (principal + interest). Receiving a loan posts Bank / 2300 Loans Taken; marking an instalment paid posts Loans Taken + 6100 Interest Expense / Bank (loans given are the mirror image). See <b>Loans Analysis</b> in Reports.");
}
function openLoanForm(id){
  const ed = id ? loans.find(x => x.id === id) : null;
  const v = ed || { type:"taken", party:"", principal:"", currency:baseCur(), rate:0, startDate:toISO(new Date()), termMonths:12 };
  openModal(`<div class="modal-head"><h3>${ed ? "Edit loan" : "New loan"}</h3><button class="modal-close" onclick="closeForm()">&times;</button></div>
    <div class="modal-body">
      <div class="form-row"><div class="field"><label>Type</label><select id="ln_type"><option value="taken" ${v.type !== "given" ? "selected" : ""}>Loan taken — we owe</option><option value="given" ${v.type === "given" ? "selected" : ""}>Loan given — owed to us</option></select></div>
        <div class="field"><label>Bank / counterparty</label><input id="ln_party" value="${escHtml(v.party)}" placeholder="Lloyds Bank"></div></div>
      <div class="form-row three"><div class="field"><label>Principal</label><input id="ln_p" type="number" step="0.01" min="0" value="${v.principal}"></div>
        <div class="field"><label>Currency</label>${currencySelectHtml("ln_cur", v.currency || baseCur(), "jeCurChange")}</div>
        <div class="field"><label>Interest rate % p.a.</label><input id="ln_rate" type="number" step="0.01" min="0" value="${v.rate}"></div></div>
      <div class="form-row"><div class="field"><label>Start (drawdown) date</label><input id="ln_start" type="date" value="${escHtml(v.startDate)}"></div>
        <div class="field"><label>Term (months)</label><input id="ln_term" type="number" min="1" step="1" value="${v.termMonths}"></div></div>
      ${ed ? '<div class="tb-note">Changing the amount, rate, term or date recalculates the schedule; instalments already marked paid keep their paid dates.</div>' : ""}
    </div>
    <div class="modal-foot"><button class="btn ghost" onclick="closeForm()">Cancel</button><button class="btn" onclick="saveLoan(${ed ? "'" + ed.id + "'" : "null"})">Save loan</button></div>`);
}
function saveLoan(id){
  const rec = { type:val("ln_type"), party:val("ln_party").trim(), principal:num2("ln_p"), currency:val("ln_cur"), rate:num2("ln_rate"), startDate:val("ln_start"), termMonths:Math.max(1, parseInt(val("ln_term")) || 0) };
  if(!rec.party){ alert("Please enter the bank / counterparty."); return; }
  if(rec.principal <= 0){ alert("Principal must be greater than zero."); return; }
  if(!rec.startDate){ alert("Please choose the start date."); return; }
  if(id) Object.assign(loans.find(x => x.id === id), rec); else loans.push(Object.assign({ id:uid("ln"), paid:{} }, rec));
  closeForm(); persistAndRender();
}
function deleteLoan(id){ if(!confirm("Delete this loan and all of its postings?")) return; loans = loans.filter(x => x.id !== id); persistAndRender(); }
function openLoanSchedule(id){
  const l = loans.find(x => x.id === id); if(!l) return;
  const s = loanSchedule(l), today = toISO(new Date()), taken = l.type !== "given", cur = curCode(l.currency);
  openModal(`<div class="modal-head"><h3>${escHtml(l.party)} — ${taken ? "repayment" : "collection"} schedule (${escHtml(cur)})</h3><button class="modal-close" onclick="closeForm()">&times;</button></div>
    <div class="modal-body" style="max-height:70vh;overflow:auto;"><div style="font-size:12.5px;color:var(--muted);margin-bottom:8px;">Instalment ${nf(s.emi)} · ${l.termMonths} months · ${Number(l.rate) || 0}% p.a.</div>
      <table class="grid"><thead><tr><th>#</th><th>Due</th><th class="right">Principal</th><th class="right">Interest</th><th class="right">Instalment</th><th class="right">Balance</th><th>${taken ? "Paid on" : "Received on"}</th></tr></thead><tbody>
      ${s.rows.map(r => { const pd = (l.paid || {})[r.k];
        return `<tr><td class="mono">${r.k}</td><td class="mono">${fmtDate(r.due)}</td>${tdn(r.principal)}${tdn(r.interest)}${tdn(r.installment)}${tdn(r.closing)}
        <td>${pd ? `<span class="pill paid">${fmtDate(pd)}</span> <button class="icon-btn" onclick="loanUnpay('${l.id}',${r.k})">Undo</button>`
          : `<input id="lp_${r.k}" type="date" value="${today > r.due ? today : r.due}" max="${today}" style="width:140px;padding:4px 6px;"> <button class="icon-btn" onclick="loanPay('${l.id}',${r.k})">${taken ? "Mark paid" : "Mark received"}</button>${r.due < today ? ' <span class="pill overdue">Overdue</span>' : ""}`}</td></tr>`; }).join("")}</tbody></table></div>
    <div class="modal-foot"><button class="btn" onclick="closeForm()">Close</button></div>`);
}
function loanPay(id, k){
  const l = loans.find(x => x.id === id), d = val("lp_" + k);
  if(!d){ alert("Choose the payment date."); return; }
  if(d > toISO(new Date())){ alert("The date cannot be in the future."); return; }
  if(d < l.startDate){ alert("The date cannot be before the loan start date."); return; }
  l.paid = l.paid || {}; l.paid[k] = d; saveMeta(); openLoanSchedule(id); render();
}
function loanUnpay(id, k){ const l = loans.find(x => x.id === id); if(l && l.paid){ delete l.paid[k]; saveMeta(); openLoanSchedule(id); render(); } }

/* ========================================================================
   ANALYTIC ACCOUNTS
   ======================================================================== */
function renderAnalyticAccounts(){
  const use = id => invoices.filter(d => d.analytic === id).length + purchaseOrders.filter(d => d.analytic === id).length
    + fixedAssets.filter(a => a.analytic === id).length + journalEntries.reduce((s, j) => s + (j.lines || []).filter(l => l.analytic === id).length, 0);
  const rows = analyticAccounts.map(a => `<tr><td>${escHtml(a.name)}</td><td class="right mono">${use(a.id)}</td>
      <td class="right"><button class="icon-btn" onclick="renameAnalytic('${a.id}')">Rename</button><button class="icon-btn" onclick="deleteAnalytic('${a.id}')">Delete</button></td></tr>`).join("")
    || emptyRow(3, "No analytic accounts yet. Create one per shipment, product line, customer project or cost centre.");
  return panel("Analytic accounts (cost centres)", `<table class="grid"><thead><tr><th>Name</th><th class="right">Used on</th><th></th></tr></thead><tbody>${rows}</tbody></table>`,
    "Pick an analytic account on an invoice, purchase order, fixed asset or journal line, then see income and expenses per account in <b>Reports → Analytic Report</b>.");
}
function newAnalytic(){
  const n = (prompt("Name of the new analytic account (e.g. “Avocado — Peru season”):") || "").trim();
  if(!n) return;
  if(analyticAccounts.some(a => a.name.toLowerCase() === n.toLowerCase())){ alert("That name already exists."); return; }
  analyticAccounts.push({ id:uid("an"), name:n }); persistAndRender();
}
function renameAnalytic(id){ const a = analyticAccounts.find(x => x.id === id); const n = (prompt("New name:", a.name) || "").trim(); if(n){ a.name = n; persistAndRender(); } }
function deleteAnalytic(id){
  const used = invoices.some(d => d.analytic === id) || purchaseOrders.some(d => d.analytic === id) || fixedAssets.some(a => a.analytic === id) || journalEntries.some(j => (j.lines || []).some(l => l.analytic === id));
  if(used && !confirm("This analytic account is used on existing records. Delete it anyway? Those records will show “(Deleted analytic account)”.")) return;
  if(!used && !confirm("Delete this analytic account?")) return;
  analyticAccounts = analyticAccounts.filter(a => a.id !== id); persistAndRender();
}

defView("journal", "Journal Entries", "Manual postings: expenses, owner capital, tax payments, opening balances", renderJournal, () => '<button class="btn" onclick="openJournalForm()">+ New Journal Entry</button>');
defView("assets", "Fixed Assets", "Assets that are depreciated over their useful life", renderAssets, () => '<button class="btn" onclick="openAssetForm()">+ New Asset</button>');
defView("loans", "Loans", "Loans taken from banks and loans given to others, with repayment schedules", renderLoans, () => '<button class="btn" onclick="openLoanForm()">+ New Loan</button>');
defView("analytic", "Analytic Accounts", "Cost centres used to tag invoices, purchases and entries", renderAnalyticAccounts, () => '<button class="btn" onclick="newAnalytic()">+ New Analytic Account</button>');

/* ========================================================================
   SETTINGS → TAX & CURRENCY
   ======================================================================== */
SETTINGS_SECTIONS.tax = [
  { id:"tx_rates", title:"Default tax rates", desc:"Pre-filled on each new invoice / purchase order (prices are tax-inclusive). Use 0 for zero-rated exports; you can still change it per document.",
    fields:[
      { key:"salesRate", label:"Sales tax rate % (output)", type:"number", min:0, get:() => settings.tax.salesRate, set:v => { settings.tax.salesRate = Math.max(0, parseFloat(v) || 0); } },
      { key:"purchaseRate", label:"Purchase tax rate % (input)", type:"number", min:0, get:() => settings.tax.purchaseRate, set:v => { settings.tax.purchaseRate = Math.max(0, parseFloat(v) || 0); } }
    ] },
  { id:"tx_base", title:"Reporting currency", desc:"Reports can show every currency converted into this one (“Consolidated”). Choose it first, then enter the exchange rates below.",
    fields:[ { key:"base", label:"Reporting (base) currency", type:"select", options:CURRENCY_OPTIONS.map(o => [o[0], o[1]]), get:() => settings.fx.base, set:v => { settings.fx.base = v; } } ] },
  { id:"tx_fx", title:"Exchange rates", desc:"How many units of the reporting currency one unit of each currency is worth. Leave blank for currencies you do not use. Reports use one fixed rate (no gain/loss accounting).",
    fields:CURRENCY_OPTIONS.map((o, i) => ({ key:"c" + i, label:"Value of 1 " + curCode(o[0]) + " in the reporting currency",
      type:"number", min:0, get:() => (settings.fx.rates[o[0]] != null ? settings.fx.rates[o[0]] : ""),
      set:v => { const n = parseFloat(v); if(n > 0) settings.fx.rates[o[0]] = n; else delete settings.fx.rates[o[0]]; } })) }
];
SETTINGS_TABS.splice(4, 0, ["tax", "Tax & Currency"]);


/* ========================================================================
   SIDEBAR → Accounting Reports menu (grouped like Odoo)
   ======================================================================== */
function buildReportsMenu(){
  const m = document.getElementById("repMenu"); if(!m) return;
  m.innerHTML = REPORT_GROUPS.map(([g, ids]) => `<div class="rep-group">${escHtml(g)}</div>` + ids.filter(id => REPORTS[id]).map(id => `<button data-view="${id}">${escHtml(REPORTS[id].title)}</button>`).join("")).join("");
}
buildReportsMenu();
