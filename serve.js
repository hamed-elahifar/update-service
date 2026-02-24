import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ===== Config (edit these values directly) =====
const HOST = "0.0.0.0";
const PORT = 3000;
const STATIC_FOLDER_NAME = "dist";
const ENABLE_SPA_FALLBACK = true;
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function safeDecode(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function isPathInside(baseDir, targetPath) {
  const relative = path.relative(baseDir, targetPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sendError(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
}

function setCommonHeaders(res, filePath) {
  res.setHeader("Content-Type", getMimeType(filePath));

  const cacheControl = getCacheControlFor(filePath);
  if (cacheControl) {
    res.setHeader("Cache-Control", cacheControl);
  }
}

function streamFile(req, res, filePath, extraHeaders = {}) {
  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }

  setCommonHeaders(res, filePath);
  res.statusCode = 200;

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    sendError(res, 500, "Internal Server Error");
  });
  stream.pipe(res);
}

function tryServePrecompressed(req, res, decodedPath, resolvedFilePath) {
  if (!ENABLE_PRECOMPRESSED_FILES) {
    return false;
  }

  if (decodedPath.endsWith("/")) {
    return false;
  }

  if (
    !fs.existsSync(resolvedFilePath) ||
    !fs.statSync(resolvedFilePath).isFile()
  ) {
    return false;
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
    return false;
  }

  streamFile(req, res, resolvedFilePath, {
    "Content-Encoding": selectedEncoding,
    Vary: "Accept-Encoding",
  });

  return true;
}

function tryServeStaticFile(req, res, resolvedFilePath) {
  if (!fs.existsSync(resolvedFilePath)) {
    return false;
  }

  const stat = fs.statSync(resolvedFilePath);
  if (!stat.isFile()) {
    return false;
  }

  streamFile(req, res, resolvedFilePath);
  return true;
}

if (!fs.existsSync(staticDir)) {
  console.error(`[serve.js] Folder not found: ${staticDir}`);
  console.error(
    `[serve.js] Create it, or change STATIC_FOLDER_NAME in serve.js`,
  );
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendError(res, 405, "Method Not Allowed");
    return;
  }

  const requestUrl = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const decodedPath = safeDecode(requestUrl.pathname);

  if (decodedPath === null) {
    sendError(res, 400, "Bad Request");
    return;
  }

  const normalizedPath = decodedPath.replace(/^\/+/, "");
  const resolvedFilePath = path.resolve(staticDir, normalizedPath);

  if (normalizedPath !== "" && !isPathInside(staticDir, resolvedFilePath)) {
    sendError(res, 403, "Forbidden");
    return;
  }

  if (tryServePrecompressed(req, res, decodedPath, resolvedFilePath)) {
    return;
  }

  if (tryServeStaticFile(req, res, resolvedFilePath)) {
    return;
  }

  if (ENABLE_SPA_FALLBACK) {
    const indexPath = path.join(staticDir, "index.html");
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      streamFile(req, res, indexPath);
      return;
    }
  }

  sendError(res, 404, "Not Found");
});

server.listen(PORT, HOST, () => {
  console.log(`[serve.js] Serving: ${staticDir}`);
  console.log(
    `[serve.js] URL: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`,
  );
});
