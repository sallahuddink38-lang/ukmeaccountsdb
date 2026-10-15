const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.RENDER ? "0.0.0.0" : "127.0.0.1";
const ROOT = __dirname;

/* Load .env variables for local development. */
try {
  fs.readFileSync(path.join(ROOT, ".env"), "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      if (!line.trim() || line.trim().startsWith("#")) return;

      const match = line.match(
        /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/
      );

      if (!match) return;

      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");

      if (process.env[match[1]] === undefined) {
        process.env[match[1]] = value;
      }
    });
} catch (_) {
  // A .env file is optional.
}

const MONGO_URI = (process.env.MONGODB_URI || "").trim();
const MONGO_DB = (process.env.MONGODB_DB || "ukme_erp").trim();
const ERP_USERNAME = process.env.ERP_USERNAME || "";
const ERP_PASSWORD = process.env.ERP_PASSWORD || "";

/* Require MongoDB and authentication on Render. */
if (process.env.RENDER && !MONGO_URI) {
  console.error(
    "Startup blocked: set MONGODB_URI in Render Environment."
  );
  process.exit(1);
}

if (process.env.RENDER && (!ERP_USERNAME || !ERP_PASSWORD)) {
  console.error(
    "Startup blocked: set ERP_USERNAME and ERP_PASSWORD in Render Environment."
  );
  process.exit(1);
}

const DATA_DIR =
  process.env.UKME_DATA_DIR ||
  path.join(os.homedir(), "UKME-ERP-Data");

const BACKUP_DIR = path.join(DATA_DIR, "backups");
const FILE = path.join(DATA_DIR, "company.json");
const KEEP_BACKUPS = 60;

fs.mkdirSync(BACKUP_DIR, { recursive: true });

/* Migrate an existing local data file if available. */
const OLD = path.join(ROOT, "data");

if (
  !fs.existsSync(FILE) &&
  fs.existsSync(path.join(OLD, "company.json")) &&
  path.resolve(OLD) !== path.resolve(DATA_DIR)
) {
  fs.copyFileSync(path.join(OLD, "company.json"), FILE);

  const oldBackups = path.join(OLD, "backups");

  if (fs.existsSync(oldBackups)) {
    for (const name of fs.readdirSync(oldBackups)) {
      const from = path.join(oldBackups, name);
      const to = path.join(BACKUP_DIR, name);

      if (fs.statSync(from).isFile()) {
        fs.copyFileSync(from, to);
      }
    }
  }

  console.log("Moved existing local data from ./data to " + DATA_DIR);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8"
};

/* Local file storage fallback. */
const fileStore = {
  name: "File: " + FILE,

  async init() {},

  async raw() {
    return fs.existsSync(FILE)
      ? fs.readFileSync(FILE)
      : null;
  },

  async save(parsed, body) {
    const data = body || Buffer.from(JSON.stringify(parsed));

    fs.writeFileSync(FILE + ".tmp", data);
    fs.renameSync(FILE + ".tmp", FILE);
  },

  async remove() {
    if (fs.existsSync(FILE)) {
      fs.unlinkSync(FILE);
    }
  }
};

/*
 * MongoDB collections:
 * invoices
 * purchase_orders
 * meta
 */
const mongoStore = {
  name: "MongoDB: " + MONGO_DB,
  client: null,
  db: null,

  async init() {
    let MongoClient;

    try {
      ({ MongoClient } = require("mongodb"));
    } catch (_) {
      throw new Error(
        'MongoDB driver missing. Run "npm install" in the project folder.'
      );
    }

    this.client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 15000
    });

    await this.client.connect();

    this.db = this.client.db(MONGO_DB);

    await this.db.command({ ping: 1 });

    /*
     * Import company.json only when the MongoDB company
     * metadata record does not exist.
     */
    const existingMeta = await this.db
      .collection("meta")
      .findOne({ _id: "company" });

    if (!existingMeta && fs.existsSync(FILE)) {
      try {
        const oldData = JSON.parse(
          fs.readFileSync(FILE, "utf8")
        );

        if (
          oldData &&
          Array.isArray(oldData.invoices) &&
          Array.isArray(oldData.purchaseOrders)
        ) {
          await this.save(oldData);
          console.log("Imported company.json into MongoDB.");
        } else {
          console.warn(
            "company.json was not imported: unexpected data format."
          );
        }
      } catch (error) {
        console.warn(
          "Could not import company.json:",
          error.message
        );
      }
    }

    console.log("MongoDB connection verified.");
  },

  async snapshot() {
    const meta = await this.db
      .collection("meta")
      .findOne({ _id: "company" });

    if (!meta) return null;

    const invoices = await this.db
      .collection("invoices")
      .find({})
      .toArray();

    const purchaseOrders = await this.db
      .collection("purchase_orders")
      .find({})
      .toArray();

    const stripId = (doc) => {
      const { _id, ...rest } = doc;
      return rest;
    };

    const { _id, ...rest } = meta;

    return Object.assign(rest, {
      invoices: invoices.map(stripId),
      purchaseOrders: purchaseOrders.map(stripId)
    });
  },

  async raw() {
    const data = await this.snapshot();

    return data
      ? Buffer.from(JSON.stringify(data))
      : null;
  },

  async save(parsed) {
    const { invoices, purchaseOrders, ...rest } = parsed;

    const syncCollection = async (
      collectionName,
      records
    ) => {
      const collection = this.db.collection(collectionName);
      const ids = [];

      const operations = records.map((record) => {
        if (
          !record ||
          record.id === undefined ||
          record.id === null ||
          record.id === ""
        ) {
          throw new Error(
            "A record in " + collectionName + " has no id."
          );
        }

        ids.push(record.id);

        return {
          replaceOne: {
            filter: { _id: record.id },
            replacement: Object.assign({}, record, {
              _id: record.id
            }),
            upsert: true
          }
        };
      });

      for (let i = 0; i < operations.length; i += 500) {
        await collection.bulkWrite(
          operations.slice(i, i + 500),
          { ordered: true }
        );
      }

      await collection.deleteMany({
        _id: { $nin: ids }
      });
    };

    await syncCollection("invoices", invoices);

    await syncCollection(
      "purchase_orders",
      purchaseOrders
    );

    await this.db.collection("meta").replaceOne(
      { _id: "company" },
      Object.assign({}, rest, {
        _id: "company",
        savedAt: new Date().toISOString()
      }),
      { upsert: true }
    );
  },

  async remove() {
    await Promise.all(
      ["invoices", "purchase_orders", "meta"].map(
        (name) =>
          this.db.collection(name).deleteMany({})
      )
    );
  }
};

const store = MONGO_URI ? mongoStore : fileStore;

/* Create JSON backups before changes and resets. */
async function backup(tag) {
  const current = await store.raw();

  if (!current) return;

  const date = new Date().toISOString().slice(0, 10);

  const name = tag
    ? `company-${tag}-${Date.now()}.json`
    : `company-${date}.json`;

  const destination = path.join(BACKUP_DIR, name);

  if (!tag && fs.existsSync(destination)) return;

  fs.writeFileSync(destination, current);

  const files = fs.readdirSync(BACKUP_DIR)
    .filter((item) =>
      fs.statSync(path.join(BACKUP_DIR, item)).isFile()
    )
    .sort();

  files
    .slice(0, Math.max(0, files.length - KEEP_BACKUPS))
    .forEach((item) => {
      fs.unlinkSync(path.join(BACKUP_DIR, item));
    });
}

function send(res, status, body, contentType) {
  res.writeHead(status, {
    "Content-Type":
      contentType || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });

  res.end(body);
}

const MAX_BODY = 100 * 1024 * 1024;

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  return (
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

function isAuthenticated(req) {
  /*
   * Local mode works without login credentials.
   * Render requires the configured username and password.
   */
  if (!ERP_USERNAME || !ERP_PASSWORD) {
    return !process.env.RENDER;
  }

  const header = req.headers.authorization || "";

  if (!header.startsWith("Basic ")) {
    return false;
  }

  let decoded;

  try {
    decoded = Buffer.from(
      header.slice(6),
      "base64"
    ).toString("utf8");
  } catch (_) {
    return false;
  }

  const separator = decoded.indexOf(":");

  if (separator < 0) return false;

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  return (
    safeEqual(username, ERP_USERNAME) &&
    safeEqual(password, ERP_PASSWORD)
  );
}

async function handle(req, res) {
  /* Protect the ERP page and API. */
  if (!isAuthenticated(req)) {
    res.writeHead(401, {
      "WWW-Authenticate":
        'Basic realm="UKME ERP", charset="UTF-8"',
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    });

    return res.end("Authentication required.");
  }

  /* Reject cross-origin requests. */
  const origin = req.headers.origin;

  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();

      const requestHost = String(
        req.headers.host || ""
      ).toLowerCase();

      if (
        !requestHost ||
        originHost !== requestHost
      ) {
        return send(
          res,
          403,
          "Forbidden",
          "text/plain; charset=utf-8"
        );
      }
    } catch (_) {
      return send(
        res,
        403,
        "Forbidden",
        "text/plain; charset=utf-8"
      );
    }
  }

  let url;

  try {
    url = decodeURIComponent(
      (req.url || "/").split("?")[0]
    );
  } catch (_) {
    return send(
      res,
      400,
      "Bad request",
      "text/plain; charset=utf-8"
    );
  }

  /* ERP data API. */
  if (url === "/api/data") {
    if (req.method === "GET") {
      const current = await store.raw();

      return current
        ? send(res, 200, current)
        : send(res, 404, '{"empty":true}');
    }

    if (req.method === "PUT") {
      const chunks = [];
      let size = 0;
      let tooLarge = false;

      req.on("data", (chunk) => {
        size += chunk.length;

        if (size > MAX_BODY) {
          tooLarge = true;
        } else if (!tooLarge) {
          chunks.push(chunk);
        }
      });

      req.on("end", async () => {
        if (tooLarge) {
          return send(
            res,
            413,
            '{"error":"Payload too large"}'
          );
        }

        try {
          const body = Buffer.concat(chunks);

          const parsed = JSON.parse(
            body.toString("utf8")
          );

          if (
            !parsed ||
            typeof parsed !== "object" ||
            !Array.isArray(parsed.invoices) ||
            !Array.isArray(parsed.purchaseOrders)
          ) {
            throw new Error(
              "Not a valid company file: invoices and purchaseOrders must be arrays."
            );
          }

          await backup();

          await store.save(parsed, body);

          return send(res, 200, '{"ok":true}');
        } catch (error) {
          console.error(
            "Save failed:",
            error.message
          );

          return send(
            res,
            400,
            JSON.stringify({
              error: error.message
            })
          );
        }
      });

      return;
    }

    if (req.method === "DELETE") {
      await backup("before-reset");

      await store.remove();

      return send(res, 200, '{"ok":true}');
    }

    return send(
      res,
      405,
      '{"error":"Method not allowed"}'
    );
  }

  /*
   * Serve only index.html and assets.
   * Never expose server.js, .env, or data files.
   */
  const relative =
    url === "/" ? "/index.html" : url;

  if (
    relative !== "/index.html" &&
    !relative.startsWith("/assets/")
  ) {
    return send(
      res,
      404,
      "Not found",
      "text/plain; charset=utf-8"
    );
  }

  const filePath = path.resolve(
    ROOT,
    "." + relative
  );

  const assetsDir =
    path.join(ROOT, "assets") + path.sep;

  const isAllowedFile =
    filePath === path.join(ROOT, "index.html") ||
    filePath.startsWith(assetsDir);

  if (
    !isAllowedFile ||
    !fs.existsSync(filePath) ||
    !fs.statSync(filePath).isFile()
  ) {
    return send(
      res,
      404,
      "Not found",
      "text/plain; charset=utf-8"
    );
  }

  return send(
    res,
    200,
    fs.readFileSync(filePath),
    TYPES[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream"
  );
}

function start() {
  const server = http.createServer(
    (req, res) => {
      handle(req, res).catch((error) => {
        console.error(
          "Request failed:",
          error
        );

        if (!res.headersSent) {
          send(
            res,
            500,
            '{"error":"Internal server error"}'
          );
        } else {
          res.destroy();
        }
      });
    }
  );

  server.listen(PORT, HOST, () => {
    console.log(
      "\nUKME ERP running on " + HOST + ":" + PORT
    );

    console.log(
      "Data storage: " + store.name
    );

    console.log(
      "JSON backup directory: " + BACKUP_DIR
    );

    if (process.env.RENDER) {
      console.log(
        "Render deployment: port binding configured."
      );

      console.log(
        "ERP login protection: enabled."
      );
    }
  });

  server.on("error", (error) => {
    console.error(
      "Server failed to start:",
      error
    );

    process.exit(1);
  });
}

store.init()
  .then(start)
  .catch((error) => {
    console.error(
      "\nCould not start UKME ERP:",
      error.message,
      "\n"
    );

    process.exit(1);
  });
