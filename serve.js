const express = require("express");
const path = require("path");
const fs = require("fs");

// ===== Config (edit these values directly) =====
const HOST = "0.0.0.0";
const PORT = 3000;
const STATIC_FOLDER_NAME = "dist";
const ENABLE_SPA_FALLBACK = true;
const TRUST_PROXY = "loopback";
const ENABLE_CACHE_HEADERS = true;
const CACHE_MAX_AGE_SECONDS = 86400;
const IMMUTABLE_ASSET_EXTENSIONS = [
  ".js",
  ".css",
  ".mjs",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
];
const ENABLE_PRECOMPRESSED_FILES = true;
// ===============================================

const app = express();
app.set("trust proxy", TRUST_PROXY);
const staticDir = path.resolve(__dirname, STATIC_FOLDER_NAME);
const immutableExtSet = new Set(IMMUTABLE_ASSET_EXTENSIONS);

function getCacheControlFor(filePath) {
  if (!ENABLE_CACHE_HEADERS) {
    return null;
  }

  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".html") {
    return "no-cache";
  }

  if (immutableExtSet.has(ext)) {
    return `public, max-age=${CACHE_MAX_AGE_SECONDS}, immutable`;
  }

  return `public, max-age=${CACHE_MAX_AGE_SECONDS}`;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return map[ext] || "application/octet-stream";
}

if (!fs.existsSync(staticDir)) {
  console.error(`[serve.js] Folder not found: ${staticDir}`);
  console.error(
    `[serve.js] Create it, or change STATIC_FOLDER_NAME in serve.js`,
  );
  process.exit(1);
}

if (ENABLE_PRECOMPRESSED_FILES) {
  app.get("*", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }

    const decodedPath = decodeURIComponent(req.path);
    if (decodedPath.endsWith("/")) {
      return next();
    }

    const relativePath = decodedPath.replace(/^\/+/, "");
    const resolvedFilePath = path.resolve(staticDir, relativePath);

    if (!resolvedFilePath.startsWith(staticDir + path.sep)) {
      return next();
    }

    if (
      !fs.existsSync(resolvedFilePath) ||
      !fs.statSync(resolvedFilePath).isFile()
    ) {
      return next();
    }

    const acceptEncoding = req.headers["accept-encoding"] || "";
    const brPath = `${resolvedFilePath}.br`;
    const gzPath = `${resolvedFilePath}.gz`;

    let selectedFilePath = null;
    let selectedEncoding = null;

    if (acceptEncoding.includes("br") && fs.existsSync(brPath)) {
      selectedFilePath = brPath;
      selectedEncoding = "br";
    } else if (acceptEncoding.includes("gzip") && fs.existsSync(gzPath)) {
      selectedFilePath = gzPath;
      selectedEncoding = "gzip";
    }

    if (!selectedFilePath) {
      return next();
    }

    res.setHeader("Content-Encoding", selectedEncoding);
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Type", getMimeType(resolvedFilePath));

    const cacheControl = getCacheControlFor(resolvedFilePath);
    if (cacheControl) {
      res.setHeader("Cache-Control", cacheControl);
    }

    return res.sendFile(selectedFilePath);
  });
}

app.use(
  express.static(staticDir, {
    setHeaders: (res, filePath) => {
      const cacheControl = getCacheControlFor(filePath);
      if (cacheControl) {
        res.setHeader("Cache-Control", cacheControl);
      }
    },
  }),
);

if (ENABLE_SPA_FALLBACK) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`[serve.js] Serving: ${staticDir}`);
  console.log(
    `[serve.js] URL: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`,
  );
});
