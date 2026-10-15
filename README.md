# UKME Fruit Trading — Accounts & Documents

A self-contained mini ERP for invoices, purchase orders, and payment tracking,
styled to match UKME's official Invoice / PO template (green + gold branding).

## Folder structure

```
ukme-erp/
├── index.html          → the app itself, open this in any browser
├── README.md            → this file
└── assets/
    ├── styles.css        → all styling (colors, layout, document/PDF template)
    └── app.js            → all logic (data, views, forms, PDF export)
```

## How to run it

Just double-click `index.html` (or open it with your browser: File → Open).
No install, no server, no build step needed. It needs an internet connection
once, to load two small libraries (html2canvas + jsPDF) used for the
"Download PDF" button.

## Signing in

The app opens to a sign-in screen so a casual visitor can't open it and
start editing. Default login:

- **Username:** `admin`
- **Password:** `ukme@2026`

Change both any time from **Settings** once you're signed in. Be aware
this is a simple local access gate, not real security — there's no
server behind it, so anyone who opens the HTML file itself can read its
source. Treat it like a screen lock, not a vault.

## What's inside

- **Dashboard** — receivable / payable totals, overdue count, and a
  reminders table for anything due within 2 days or already overdue.
- **Payment terms** — pick Debtor days (invoices) / Creditor days (POs) from a dropdown (or Custom); the due date is calculated automatically. Defaults live in Settings.
- **Invoices** — create, view, download as PDF, mark as paid, delete.
- **Purchase Orders** — same, for vendor-facing POs.
- **Accounts Receivable** — open invoices grouped by customer, with an
  ageing breakdown (current / 1–30 / 31–60 / 60+ days overdue).
- **Accounts Payable** — same, grouped by vendor, for purchase orders.
- **Payment Tracker** — every invoice + PO in one sortable list by due date.
- **Chart of Accounts** — six accounts (Bank GBP/USD, Accounts
  Receivable, Accounts Payable, Sales Revenue, Purchases) update
  automatically from your invoices/POs, plus any accounts you add
  yourself (freight, equity, VAT, etc.) with a manual balance.
- **Trial Balance** — the automatic accounts as a proper debit/credit
  trial balance (one for the GBP sales ledger, one for the USD purchase
  ledger — each provably balances), plus your manual accounts listed
  separately for reference.
- **Clients & Vendors** — auto-built from your invoices/POs.
- **Settings** — upload your real signature and company stamp (replacing
  the sample placeholders on every PDF), change the sign-in username/
  password, and reset all data back to the sample invoices/POs.

## Data persists in your browser

Everything you add, edit, mark paid, or delete — including your uploaded
signature/stamp and sign-in details — is saved to your browser's local
storage as you work, and is still there next time you open `index.html`,
including after closing the tab or restarting your computer. It's tied
to this file in this browser only (not shared between browsers/
computers, and not a real server-side database). To wipe everything and
start over from the sample data, use the **Reset all data to sample
data** button in Settings.

## PDF template

The Invoice and Purchase Order documents (`renderInvoiceDoc` /
`renderPODoc` in `app.js`) reproduce your original design: logo + company
reg./VAT header, green title bar, cream information boxes with gold
borders, green item table header, gold-topped totals box, signature/
stamp block, and the green contact-details footer bar. A short invoice
or PO (roughly up to 10 items) still gets the original single "hugging"
PDF page, scaled to fit exactly — no wasted white space below it.

A longer document (many items, or a long Statement of Accounts /
Payment Tracker / any report) now spans **multiple real PDF pages**
instead of being squeezed onto one:

- the logo/title header and the green contact-details footer are
  repeated on every page;
- a table's column-heading row repeats at the top of every continuation
  page;
- the page is only ever cut between rows/boxes — never through the
  middle of a row, a box, the totals block, or the signature block;
- a heading is never left alone at the bottom of a page, and the TOTAL
  row never lands alone at the top of a new one;
- every page is numbered ("Page 2 of 4").

This applies to every "Download PDF" in the app — invoices, POs, the
Statement of Accounts, Revised Documents, and the generic report button
on every other screen (Dashboard, Receivable, Payable, Payment Tracker,
Chart of Accounts, Trial Balance, Clients & Vendors). Files are named
after the invoice/PO number (or the report name + today's date).

The three PDF libraries (html2canvas, jsPDF, Chart.js) now ship inside
`assets/vendor/` instead of loading from the internet, so "Download PDF"
and the dashboard charts work even with no internet connection — the
README's older "needs an internet connection once" note no longer
applies.

## Signature & company stamp

Every invoice and PO ships with UKME's real company stamp already in
place. The two signature boxes — **Prepared By** and **Authorised
Signature / Approved By Director** — still show sample squiggles until
you replace them. Replace any of the three from **Settings → Document
images**: upload a photo or scan of your real signatures (PNG with a
transparent background looks best) and every future PDF uses them
instead, immediately.

## Customizing

- **Company details** (name, reg. no, VAT, address, bank details) are set
  once at the top of `app.js` in the `COMPANY` object.
- **Colors** are CSS variables at the top of `styles.css` (`--green`,
  `--gold`, `--cream`, etc.) — change them once and the whole app,
  including the PDF output, updates.
- **Starting invoice/PO numbers** are set in `app.js` in the `seq` object.

## Latest update — Full audit: multi-page PDFs, security, data-integrity fixes

See `AUDIT-REPORT.md` for the complete list. Highlights:

- **PDF export rewritten.** Any invoice, PO or report that runs longer than one page now prints as a proper multi-page PDF (repeated header/footer, repeated table headings, nothing cut through a row) instead of the old single-page version, which either cut a row in half or shrank everything down to fit. Documents that already fit on one page look exactly the same as before.
- **PDF libraries are now bundled** in `assets/vendor/` — no internet connection is needed for "Download PDF" or the dashboard charts.
- **Local server hardened**: a malformed request could crash the whole server (you'd have to restart it) — fixed. It also now refuses requests from other websites / other hostnames, and refuses to save anything that isn't a real company file, so a bad request can never wipe your data.
- **Every name printed on a document is now escaped** (customer, vendor, item names, company details) — an item name typed with `<` or `&` in it could previously break the printed layout.
- **Line/grand totals are rounded to the exact penny**, so the printed line items always add up to the printed total.
- **Payment date validation**: a payment date before the invoice/PO date is now also rejected (previously only a future date was blocked, even though this help text always said both).
- Basic checks added when saving an invoice or PO: a due date can't be empty or before the invoice date, quantities/prices can't be negative, and the customer/vendor name can't be blank.
- Signature/stamp image uploads are now checked for file type and capped at 1.5&nbsp;MB (an oversized image made every save and backup slower).
- A purchase order with no currency set now correctly defaults to $ instead of £.

## Earlier update — Payment date + statement PDF fix

- **Mark paid** now asks for the date the payment was actually received / made (defaults to today, cannot be in the future or before the document date). Statement, Payment Tracker and Cash flow use this date.
- **Statement of Accounts PDF** (and other report PDFs): fixed oversized fonts in the shared document CSS, and pages now break between rows instead of cutting a row in half.

## Earlier update — Edit documents + QuickBooks-style dashboard & settings

- **Edit** button on every invoice and purchase order (Invoices list, PO list, Accounts Receivable/Payable, Revised Documents, dashboard reminders, and inside the document preview). Editing keeps the document's id/currency, can change the payment status (paid / unpaid + paid date), and warns if the number is already used.
- **Message / notes** box on invoices and POs (printed on the document only when filled in).
- **Dashboard** rebuilt as a QuickBooks-style "Business overview": period selector, sales vs purchases with % change, Invoices / Purchase-orders status widgets (overdue vs not due yet, paid last 30 days), sales chart, top customers, expenses by vendor, cash flow, payment reminders. Charts fall back to built-in SVG when the Chart.js CDN can't load.
- **Sidebar** grouped like QuickBooks (Sales / Expenses / Reports / Accounting / Admin) with a green **+ New** menu.
- **Settings** now follows QuickBooks "Account and settings": Company (name, reg/VAT, contact, address, bank details, signatures & stamp), Sales (invoice numbering, default due days, incoterms, default message), Expenses (PO numbering, delivery defaults, message), Payments (reminder window), Advanced (fiscal year start, auto sign-out, sign-in, backup/restore/reset).
- Invoice / PO / report PDFs keep the original UKME green & gold design.

## Company file (QuickBooks Desktop style storage)

Run the app through the local server so your data lives in **one file on this computer**,
outside the app folder:  `C:\Users\<your name>\UKME-ERP-Data\company.json`

1. Install Node.js once (nodejs.org, LTS).
2. Double-click **start-ukme.bat** (or run `node server.js`) and keep that window open.
3. Always use `http://127.0.0.1:3000`. Any browser, any tab — same data.

- **Updating the app is safe:** unzip a new version into any folder (new or old) and run it — it finds the same data file. Never put `UKME-ERP-Data` inside the zip you send for changes.
- Every change is saved to the file automatically (atomic write, never half-written).
- Dated copies go to `UKME-ERP-Data\backups\` (one per day, last 60 kept, plus one before any reset).
- To move to another computer: copy the `UKME-ERP-Data` folder to the same place there.
- Use a different location with the `UKME_DATA_DIR` environment variable.
- If an older version kept data in `./data` inside the app folder, it is moved to the new location automatically on first start.
- If the server isn't running (opening index.html directly), the app falls back to browser storage as before.
- The sign-in username/password are still stored per browser (default admin / ukme@2026).

## Forgot the password?
Your data is not affected. In the browser press F12 → Console, run
`localStorage.removeItem("ukme_erp_auth_v1")` and reload — the login goes back to **admin / ukme@2026**.
(Repeated wrong passwords also lock the form for up to 3 minutes; wait it out or run the line above.)

## Update — Odoo-style accounting reports + Received / Outstanding

- **Customers (invoices):** *Paid* is now **Received** and *Unpaid* is now **Outstanding**
  (status badges, buttons "Mark received", forms, statement, dashboard). Vendors / purchase
  orders keep *Paid / Unpaid*.
- **Sidebar → Accounting Reports** (collapsible): Statement Reports (Balance Sheet, Profit and Loss,
  Cash Flow Statement, Depreciation Schedule), Ledgers (Trial Balance, General Ledger),
  Partner Reports (Partner Ledger, Customer Statement, Aged Receivable, Aged Payable),
  Taxes & Fiscal (Tax Report, Fiscal Report), Management (Invoice Analysis, Cashflow Analysis,
  Analytic Report, Executive Summary, Loans Analysis). Each has period / currency filters,
  Export CSV and Download PDF.
- **Sidebar → Accounting:** Journal Entries, Fixed Assets (depreciation), Loans, Analytic Accounts.
- **Invoices / POs** now have a *Tax / VAT rate %* and an *Analytic account* field.
- **Settings → Tax & Currency:** default tax rates, reporting currency and exchange rates
  (set the USD→GBP rate there so consolidated reports are correct).
- Everything posts to one double-entry ledger (assets/ledger.js) and is saved/backed up with the rest of the data.

## Storing data in MongoDB

1. Install Node.js, then in this folder run `npm install` (installs the official `mongodb` driver).
2. Copy `.env.example` to `.env` and paste your connection string into `MONGODB_URI`
   (MongoDB Atlas `mongodb+srv://…` or local `mongodb://127.0.0.1:27017`).
3. Start with `start-ukme.bat` (or `node server.js`). The console shows `Data stored in: MongoDB: ukme_erp`.

Collections: `invoices`, `purchase_orders` (one document per record) and `meta` (settings, journal
entries, fixed assets, loans, analytic accounts, signatures). If MongoDB is empty on the first run and
an old `company.json` exists, it is imported automatically. A JSON backup is still written daily to
`UKME-ERP-Data/backups`. Without `MONGODB_URI` the app keeps using the local `company.json` file.
Note: the sign-in screen is a local gate only — do not expose this server to the internet as it is.
