# UKME ERP — Complete Audit Report
Date of audit: 28–29 September 2026
Scope: full codebase (`index.html`, `assets/app.js`, `assets/styles.css`, `server.js`,
`start-ukme.bat`, `package.json`). No font, color, or layout was changed anywhere
in the app — every fix below is behavior/logic/security only.

---

## 1. The reported bug — PDF breaking on page 2 (FIXED)

**What was wrong:** the old "Download PDF" always squeezed the *entire* document
onto one PDF page — if the content was too tall, it shrank the whole page down
until it fit. For anything with more line items than that shrink could handle,
or for reports (Statement, Payment Tracker, etc.), the app fell back to a second
export path that captured the document as one tall image and sliced it into
fixed-height pages **without knowing where the rows were** — so a row, a box, the
totals block, or the signature block could be cut right through the middle,
exactly as reported.

**What changed:** `assets/app.js` — the entire PDF pipeline was rewritten
(`downloadReportPDF`, plus a new `exportNodePDF` / `pdfCrop` / `pdfLastInkRow`
helpers). The new engine:

1. Renders the document once, at high resolution.
2. Records the pixel position of every row, box, card, totals block, terms
   block, and signature block *before* slicing.
3. **A document that already fits on one page** (roughly up to ~10 line items)
   is still output exactly as before — one page, scaled to hug the content, no
   wasted white space. This preserves the existing look for the normal case.
4. **A longer document** is split across multiple real A4 pages, and a page
   break is only ever allowed to land *between* two of the recorded blocks —
   never inside one. If the natural page limit falls in the middle of a row,
   the cut is pulled back to the end of the previous row/box.
5. The branded header (logo + green title bar) and the green contact-details
   footer are re-drawn on **every** page.
6. A table's column-heading row is re-drawn at the top of every continuation
   page, so a multi-page item table is still readable without scrolling back.
7. A heading is never left stranded alone at the bottom of a page (it's kept
   together with what follows it), and a table's TOTAL row is never left
   stranded alone at the top of a new page (it's kept with the last item row).
8. Pages are numbered ("Page 2 of 4").

This is used by **every** "Download PDF" in the app — the invoice/PO preview
button, the Statement of Accounts, Revised Documents, and the generic
"Download PDF" on every other screen (Dashboard, Receivable, Payable, Payment
Tracker, Chart of Accounts, Trial Balance, Clients & Vendors) — since they all
funnelled through the same broken code path before.

**Verified with:** a real, unmodified Chromium browser (Playwright), not a
visual guess — invoices with 1, 14, and 30 line items, a PO with 26 items, the
full Statement of Accounts, Payment Tracker, and Dashboard (with its charts)
were each downloaded as real PDFs and inspected page-by-page as images. No row,
box, totals block, or signature block is cut on any page in any of these.

**Side-effect fixed along the way:** the dashboard's charts (Sales, Cash flow,
Expenses by vendor) rendered as **blank** in the old "Download PDF" for the
Dashboard screen, because `<canvas>` elements don't survive being copied via
`innerHTML`. The new export converts each chart to a picture first, so the
charts now appear correctly in the PDF.

---

## 2. Server crash — a single bad request could take down the whole app (FIXED)

`server.js` decoded the request URL with no error handling. A malformed URL
(anything that isn't valid percent-encoding — this can happen from a stray
browser extension, a bad bookmark, or literally anyone poking at the port)
threw an uncaught exception and **crashed the Node process**, taking the whole
local server down until someone manually restarted `start-ukme.bat`.

Confirmed by reproduction: sent one malformed request to the original
`server.js` — the process printed a stack trace and exited; every request
after that failed to connect at all.

**Fix:** the URL decode is now wrapped in `try/catch` (returns a plain 400),
and the entire request handler is wrapped so *no* single bad request can ever
stop the server again.

## 3. Server had no request validation at all (FIXED)

Three gaps, all in `server.js`:

- **Cross-site access:** any web page open in the same browser (a malicious ad,
  a compromised site, or a browser extension) could call
  `fetch('http://127.0.0.1:3000/api/data')` and read or **overwrite** the whole
  company file, because the server didn't check where a request came from.
  Now it only answers requests addressed to `127.0.0.1`/`localhost` on its own
  port, and rejects any request whose `Origin` header is a different site
  (a classic DNS-rebinding / CSRF hole for anything running a local server).
- **No content validation on save:** a `PUT /api/data` with `{}` (or any
  syntactically-valid-but-empty JSON) was accepted and would have overwritten
  every invoice and PO in the company file. It now checks that a save actually
  looks like a real company file (has `invoices`/`purchaseOrders` arrays)
  before accepting it.
- **Unbounded upload size:** the request body limit was 500&nbsp;MB, held
  entirely in memory — lowered to a much more reasonable 100&nbsp;MB, with an
  explicit `413` response instead of silently truncating.

Basic security response headers (`X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`) were also added.

---

## 4. Data-integrity bugs

### 4.1 Names/values printed on documents were not escaped (FIXED)
`renderInvoiceDoc`, `renderPODoc`, the invoice/PO/vendor lists, Chart of
Accounts, Trial Balance, Clients & Vendors, and the Settings sign-in field all
printed certain fields (item name/description/packing/UOM, company bank
details, vendor/customer names, account names) **directly into the page's
HTML** with no escaping. An item name or company field containing `<` or `&`
(easy to type by accident — "Grapes < 6kg", "R&D sample") would corrupt the
printed layout; this is also the standard way stored data ends up executing as
HTML/script in a browser-based app. All of these are now passed through the
app's own `escHtml()` helper, which was already used elsewhere but had been
missed in these places.

### 4.2 Totals could be off by a fraction of a penny (FIXED)
`lineAmount()` multiplied quantity × unit price with no rounding, and the
"live total" shown while editing an invoice/PO summed raw floating-point
values. Floating-point multiplication of two decimals (e.g. `33.33 × 26.35`)
routinely produces values like `878.2493999999999`, so — depending on
`.toFixed(2)` rounding at each stage — the sum of the printed line amounts
could differ from the printed grand total by a penny on some invoices. All
money math now rounds to the nearest cent (`round2()`) at the point each line
amount and total is computed, so what's printed always adds up exactly.

### 4.3 Payment date validation didn't match what the app told the user (FIXED)
The "Mark paid" dialog's own help text says the payment date can't be before
the invoice/PO date — but the code only checked that it wasn't in the future.
It's now actually enforced (checked both in "Mark paid" and when editing a
paid invoice/PO directly).

### 4.4 A purchase order with a missing currency defaulted to the wrong one (FIXED)
`normalizeRecords()` filled in a missing `currency` on *both* invoices and
purchase orders with `"£"` — but every PO in the app is in `$`. A hand-edited
or partially-imported PO with no currency field would have silently shown as
GBP. Now defaults to `$` for POs.

### 4.5 No validation on the invoice/PO forms (FIXED)
`saveInvoice`/`savePO` accepted a blank due/delivery date paired with any
invoice/PO date (so a due date before the invoice date was possible with no
warning), accepted negative quantities or prices, and accepted a blank
customer/vendor name (silently stored as `"—"`, making the Bill To/Vendor box
blank on the printed document with no warning at save time). Basic checks were
added for all of the above.

---

## 5. Smaller fixes

- **Language consistency:** the "Mark paid" dialog's helper text and error
  messages were in Roman Urdu while every other string in the app is in
  English — changed to English so the UI doesn't switch languages mid-flow.
- **Signature/stamp upload had no limits:** any file could be selected via
  Settings → Document images, including non-images or multi-megabyte photos
  straight from a phone. A large image gets embedded as base64 in *every*
  invoice/PO PDF and in every save/backup, slowing the whole app down over
  time. Now checked for image type and capped at 1.5&nbsp;MB, with a clear
  message if rejected.
- **PDF libraries no longer depend on the internet.** `html2canvas`, `jsPDF`,
  and `Chart.js` were loaded from a CDN (`cdnjs.cloudflare.com`) — if that
  request failed (no internet, a captive portal, a strict firewall — common
  on an office network), "Download PDF" failed outright and the dashboard
  fell back to a plainer chart. All three are now bundled in
  `assets/vendor/` and load from disk.

---

## 6. Things this audit did *not* change — worth your attention separately

These are real limitations, but changing them would mean redesigning parts of
the app rather than fixing a bug, so they were left alone pending your
decision:

- **The sign-in screen is a client-side-only gate.** Anyone with the file can
  open browser dev tools and bypass it, or read the source to see how the
  password hash works. This was already disclosed in the app's own Settings
  page — it's fine as a "keep a casual visitor out" measure, not real
  multi-user security. A real login needs a server with actual auth, which
  is a bigger project than this audit's scope.
- **The Trial Balance always balances by construction**, not because the app
  posts real double-entry transactions. It's a helpful summary view, not a
  bookkeeping ledger — an accountant should not treat it as one.
- **No multi-currency support.** Every invoice is £ and every PO is $,
  hard-coded. Since UKME's trade lanes include AED/OMR, this may not match
  reality.
- **A Purchase Order's "overdue" status is based on delivery date, not a
  payment due date** — the two are conflated because a PO has no separate
  payment-terms field.
- **Deleting an invoice/PO is permanent** — no undo, no audit trail, and no
  gap-tracking on invoice numbers (which some VAT regimes care about for
  sequential numbering).
- **Two browser tabs/computers open at once will silently overwrite each
  other's changes** — there's no locking or merge, "last save wins." This is
  inherent to the current one-file, no-real-backend design (`server.js`
  itself is one small file with no database), not something a small patch can
  safely fix.

---

## 7. How this was verified

- `node --check` on both `assets/app.js` and `server.js` after every change.
- A real headless Chromium (via Playwright) was used to actually run the app:
  logged in, populated invoices/POs of varying sizes, and generated real PDF
  files from every export button in the app (invoice, PO, statement,
  dashboard, payment tracker), then rasterized every page of every PDF to an
  image and inspected them directly — not inferred from the code.
- The server crash was reproduced against the *original* `server.js` first,
  to confirm the bug was real, then confirmed fixed on the patched version.
- The cross-site / bad-payload server protections were tested with live HTTP
  requests (wrong `Host` header, oversized/empty PUT body).
- A smoke test exercised every screen in the app (Dashboard through Settings)
  for console errors, checked HTML-escaping against a script-injection-style
  input, and checked the payment-date validation against both an
  out-of-range future date and a date before the document date.

---

## Addendum — 30 Sept 2026 (payment terms + document styling audit)
Tested in real Chromium (Playwright) against the running `server.js`.

**Payment terms (debtor / creditor days)** — 37 automated checks, all pass: every dropdown
value (0–120 days) and Custom (incl. negative / empty clamped to 0), recalculation when the
invoice/PO date changes, month-end and leap-year rollover, save + edit + reload persistence,
legacy records without `termsDays`, PO delivery date unaffected, AP / Payment Tracker /
Dashboard use the payment due date. No console or page errors.

**PDF** — invoices with 1, 4, 10, 14, 30 items and POs with 1, 5, 10, 26 items downloaded via the
real button and inspected page by page: no cut rows/boxes/totals/signatures, header + footer +
column headings repeat, page numbers correct. All 11 report PDFs (Dashboard, Receivable,
Payable, Payment Tracker, Statement, Revised, Trial Balance, CoA, Clients & Vendors, lists) generate.

**Fixed in this pass**
- Hairline seam between the label and amount cells of the Grand Total row (PDF anti-aliasing).
- Invoices created before payment terms existed now show their computed "Payment Terms" on the PDF.

**Server** — bad Host (403), cross-site Origin (403), malformed URL (400), empty save (400),
path traversal (404): all still rejected, server stays up.

**Known, non-blocking:** a legacy PO opened for editing shows "Custom" days (calculated from its old
delivery-date-as-due-date); 10-item invoices are shrunk to fit one page (small print by design).

### Addendum 2 — short PDFs cut on the right (FIXED)
**Bug:** when a report's content was shorter than an A4 page's *width* (about 595 pt) — e.g. a Statement of Accounts
or Revised Documents list with only a few rows — jsPDF silently swapped the page's width and height, producing
a page only ~350–530 pt wide, so the **right side of the PDF was cut off** (Revised Documents: 349 pt wide;
Statement: 464–534 pt). The same happened to the Invoices list, Purchase Orders list, Accounts Receivable,
Accounts Payable, Payment Tracker and Clients & Vendors PDFs whenever they were short.
**Fix (`downloadReportPDF`, single-page branch):** such short reports now go on a normal full A4 portrait page;
taller single pages keep the original hugging size. Invoice/PO PDFs are unaffected.
**Verified:** all 13 PDFs (11 reports + invoice + PO) and a sweep of Statement/Revised with 1–45 rows are exactly
595.28 pt wide; multi-page breaks still land between rows.

### Addendum 3 — every PDF is a true A4 sheet
Invoice, PO and all report PDFs are now exactly A4 (595.28 x 841.89 pt). Short documents are stretched to the
full page height so the card border and the green contact bar sit at the bottom edge (no floating box, no gap).
Slightly-too-tall invoices/POs are still scaled to one page; longer ones paginate on A4 with the header,
footer and table headings repeated. Verified on 13 report/doc PDFs plus invoices of 1/4/10/14/30 items and
POs of 1/5/10/26 items: every page is A4, nothing is cut.

### Addendum 4 — A4 fit applied on the 30-09 build
Only the PDF page engine (`downloadReportPDF` in `assets/app.js`) was changed on top of `ukme-erp-audited-final30-09`.
HTML, CSS, data, server and every document's design are untouched. Result: every PDF (invoice, PO, all reports) is a true
A4 sheet; short documents fill the page with the green contact bar at the bottom edge. Compared with the 30-09 build,
invoice/PO content is identical (blurred diff ≈ 0, no shift beyond 1 px at 100 dpi).

### Addendum 5 — full-bleed A4 (no white page margins)
All PDFs (Invoice, Purchase Order, Dashboard, Invoices, Accounts Receivable, Purchase Orders, Accounts Payable, Payment Tracker,
Statement of Accounts, Revised Documents, Trial Balance, Chart of Accounts, Clients & Vendors) now fill the whole A4 sheet
edge to edge: the 18 pt white page margin and the on-screen card frame are gone, the green title bar and contact bar run
to the page edges. Short documents are stretched to the full sheet; an invoice/PO slightly too tall for one sheet is laid
out a little wider so it still fills one sheet (never below 70 % size); longer ones paginate with header, footer and table
headings repeated and "Page x of y" inside the green bar. Text keeps the same physical size as before.
Only `downloadReportPDF` in `assets/app.js` changed. Verified: 13 report/doc PDFs + invoices of 1/4/10/14/30 items +
POs of 1/5/10/26 items + Statement/Revised of 1–45 rows: every page is 595.28 x 841.89 pt, nothing cut.
