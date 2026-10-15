/* UKME ERP local server — keeps your data either
     (a) in MongoDB   — set MONGODB_URI (in a .env file next to this file, or as an environment variable), or
     (b) in ONE file on this computer (like a QuickBooks company file): UKME-ERP-Data/company.json
         — used automatically when MONGODB_URI is not set (zero dependencies, only Node.js).
   Run:  node server.js   then open  http://127.0.0.1:3000
   MongoDB mode needs one-time:  npm install   (installs the official "mongodb" driver). */
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const PORT = Number(process.env.PORT) || 3000, HOST = "127.0.0.1";
const ROOT = __dirname;
/* tiny .env reader (no dependency): KEY=VALUE lines in ./.env, real environment variables win */
try{
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if(!m || l.trim().startsWith("#")) return;
    const v = m[2].replace(/^(["'])(.*)\1$/, "$2"); if(process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
}catch(e){ /* no .env — fine */ }
const MONGO_URI = (process.env.MONGODB_URI || "").trim(), MONGO_DB = (process.env.MONGODB_DB || "ukme_erp").trim();
/* Data lives OUTSIDE the code folder (C:\Users\<you>\UKME-ERP-Data by default), so unzipping a new
   version of the app anywhere never touches or loses your company file. Override with UKME_DATA_DIR. */
const DATA_DIR = process.env.UKME_DATA_DIR || path.join(os.homedir(), "UKME-ERP-Data"), BACKUP_DIR = path.join(DATA_DIR, "backups");
const FILE = path.join(DATA_DIR, "company.json"), KEEP_BACKUPS = 60;
fs.mkdirSync(BACKUP_DIR, { recursive: true });
// one-time move: if an older version kept its data inside the app folder (./data), bring it over
const OLD = path.join(ROOT, "data");
if(!fs.existsSync(FILE) && fs.existsSync(path.join(OLD, "company.json")) && path.resolve(OLD) !== path.resolve(DATA_DIR)){
  fs.copyFileSync(path.join(OLD, "company.json"), FILE);
  const ob = path.join(OLD, "backups"); if(fs.existsSync(ob)) fs.readdirSync(ob).forEach(f => fs.copyFileSync(path.join(ob, f), path.join(BACKUP_DIR, f)));
  console.log("Moved your existing data from ./data to " + DATA_DIR);
}
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".txt":"text/plain", ".md":"text/plain; charset=utf-8" };

/* ---------- storage: file (default) or MongoDB ---------- */
const fileStore = {
  name: "File: " + FILE,
  async init(){},
  async raw(){ return fs.existsSync(FILE) ? fs.readFileSync(FILE) : null; },
  async save(parsed, body){ fs.writeFileSync(FILE + ".tmp", body); fs.renameSync(FILE + ".tmp", FILE); },   // atomic write: never a half-written file
  async remove(){ if(fs.existsSync(FILE)) fs.unlinkSync(FILE); }
};
/* MongoDB layout:  invoices / purchase_orders = one document per record (_id = record id),
                    meta = ONE document (_id "company") with everything else (settings, journal entries, assets, loans, …). */
const mongoStore = {
  name: "MongoDB: " + MONGO_DB,
  client: null, db: null,
  async init(){
    let MongoClient;
    try{ ({ MongoClient } = require("mongodb")); }
    catch(e){ throw new Error('MongoDB driver not installed. Run  npm install  in this folder, then start again.'); }
    this.client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    await this.client.connect();
    this.db = this.client.db(MONGO_DB);
    await this.db.command({ ping: 1 });
    // first run: if MongoDB is empty but an old company.json exists, import it once
    const has = await this.db.collection("meta").findOne({ _id: "company" });
    if(!has && fs.existsSync(FILE)){
      try{ const old = JSON.parse(fs.readFileSync(FILE, "utf8")); await this.save(old); console.log("Imported your existing company.json into MongoDB."); }catch(e){ console.warn("Could not import company.json:", e.message); }
    }
  },
  async snapshot(){
    const meta = await this.db.collection("meta").findOne({ _id: "company" });
    if(!meta) return null;
    const invoices = await this.db.collection("invoices").find({}).toArray(), purchaseOrders = await this.db.collection("purchase_orders").find({}).toArray();
    const strip = d => { const { _id, ...rest } = d; return rest; };       // records keep their own "id" field
    const { _id, ...m } = meta;
    return Object.assign(m, { invoices: invoices.map(strip), purchaseOrders: purchaseOrders.map(strip) });
  },
  async raw(){ const snap = await this.snapshot(); return snap ? Buffer.from(JSON.stringify(snap)) : null; },
  async save(parsed){
    const { invoices, purchaseOrders, ...rest } = parsed;
    const sync = async (name, list) => {
      const col = this.db.collection(name), ids = [];
      const ops = list.map(d => {
        if(!d || !d.id) throw new Error("A record in " + name + " has no id");
        ids.push(d.id);
        return { replaceOne: { filter: { _id: d.id }, replacement: Object.assign({}, d, { _id: d.id }), upsert: true } };
      });
      for(let i = 0; i < ops.length; i += 1000) await col.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      await col.deleteMany({ _id: { $nin: ids } });                        // records deleted in the app are deleted here too
    };
    await sync("invoices", invoices); await sync("purchase_orders", purchaseOrders);
    await this.db.collection("meta").replaceOne({ _id: "company" }, Object.assign({}, rest, { _id: "company", savedAt: new Date().toISOString() }), { upsert: true });
  },
  async remove(){ await Promise.all(["invoices", "purchase_orders", "meta"].map(n => this.db.collection(n).deleteMany({}))); }
};
const store = MONGO_URI ? mongoStore : fileStore;

async function backup(tag){                 // keep a JSON copy in the backups folder (one per day + before any reset)
  const cur = await store.raw();
  if(!cur) return;
  const stamp = new Date().toISOString().slice(0,10), name = tag ? `company-${tag}-${Date.now()}.json` : `company-${stamp}.json`;
  const dest = path.join(BACKUP_DIR, name);
  if(!tag && fs.existsSync(dest)) return;
  fs.writeFileSync(dest, cur);
  const all = fs.readdirSync(BACKUP_DIR).sort();
  all.slice(0, Math.max(0, all.length - KEEP_BACKUPS)).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
}
function send(res, code, body, type){ res.writeHead(code, { "Content-Type": type || "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" }); res.end(body); }

const MAX_BODY = 100e6;                     // 100 MB is far more than any company file (was 500 MB held in memory)
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
async function handle(req, res){
  // DNS-rebinding guard: only answer requests addressed to this machine's own address
  if(!ALLOWED_HOSTS.has(String(req.headers.host||"").toLowerCase())) return send(res, 403, "Forbidden", "text/plain");
  // a web page on ANOTHER site must not be able to read or overwrite the company file
  const origin = req.headers.origin;
  if(origin && !ALLOWED_HOSTS.has(String(origin).replace(/^https?:\/\//,"").toLowerCase())) return send(res, 403, "Forbidden", "text/plain");
  let url;
  try{ url = decodeURIComponent(req.url.split("?")[0]); }
  catch(e){ return send(res, 400, "Bad request", "text/plain"); }
  if(url === "/api/data"){
    if(req.method === "GET"){
      const cur = await store.raw();
      return cur ? send(res, 200, cur) : send(res, 404, '{"empty":true}');
    }
    if(req.method === "PUT"){
      const chunks = []; let size = 0;
      let tooBig = false;
      req.on("data", c => { size += c.length; if(size > MAX_BODY){ tooBig = true; } else if(!tooBig) chunks.push(c); });
      req.on("end", async () => {
        if(tooBig) return send(res, 413, '{"error":"Payload too large"}');
        try{
          const body = Buffer.concat(chunks);
          const parsed = JSON.parse(body);                                 // refuse anything that isn't valid JSON
          // ...and anything that isn't a real company file (an empty/garbage PUT must never overwrite good data)
          if(!parsed || typeof parsed !== "object" || !Array.isArray(parsed.invoices) || !Array.isArray(parsed.purchaseOrders)) throw new Error("Not a valid company file");
          await backup();
          await store.save(parsed, body);
          send(res, 200, '{"ok":true}');
        }catch(e){ send(res, 400, JSON.stringify({ error: String(e.message) })); }
      });
      return;
    }
    if(req.method === "DELETE"){ await backup("before-reset"); await store.remove(); return send(res, 200, '{"ok":true}'); }
    return send(res, 405, "{}");
  }
  // static files — only index.html and /assets, never data/ or server.js
  const rel = url === "/" ? "/index.html" : url;
  if(rel !== "/index.html" && !rel.startsWith("/assets/")) return send(res, 404, "Not found", "text/plain");
  const fp = path.resolve(ROOT, "." + rel), ASSETS = path.join(ROOT, "assets") + path.sep;
  if(!(fp === path.join(ROOT, "index.html") || fp.startsWith(ASSETS)) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(res, 404, "Not found", "text/plain");
  send(res, 200, fs.readFileSync(fp), TYPES[path.extname(fp)] || "application/octet-stream");
}
function start(){
  http.createServer((req, res) => {
    handle(req, res).catch(e => { console.error(e); try{ send(res, 500, '{"error":"Server error"}'); }catch(_){} });   // one bad request can never stop the server
  }).listen(PORT, HOST, () => {
    console.log(`\nUKME ERP running:  http://${HOST}:${PORT}\nData stored in:    ${store.name}\nBackups (JSON):    ${BACKUP_DIR}\n\nKeep this window open while working. Ctrl+C to stop.\n`);
  }).on("error", e => { console.error(e.code === "EADDRINUSE" ? `Port ${PORT} is busy — the app may already be running at http://${HOST}:${PORT}` : e); process.exit(1); });
}
store.init().then(start).catch(e => { console.error("\nCould not start:", e.message, "\n"); process.exit(1); });
