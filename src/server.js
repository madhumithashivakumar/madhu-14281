/**
 * @file server.js
 * @description Zero-dependency HTTP Gateway, Static Asset Server, and REST Controller for TierTracker.
 * Strictly adheres to S-Tier Engineering: Pure Node.js ESM, bounded memory, defensive I/O.
 * Fully compatible with Vercel Serverless Functions (export default app) and local node execution.
 */

import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, extname, normalize, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AtomicFileVenueRepository } from './infra/file-repository.js';
import { SlidingWindowPresenceStore } from './infra/presence-store.js';
import { CampusWifiTelemetryService } from './infra/campus-wifi-telemetry.js';
import { createApiHandler, sendJson } from './api/routes.js';

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
});

const MAX_PAYLOAD_BYTES = 1024 * 1024; // 1MB payload ceiling
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolves path candidate across working directory, parent directory, and module location.
 *
 * @param {string|undefined} relativeOrAbsolute
 * @param {string} defaultRelative
 * @returns {string}
 */
export function resolvePathWithFallback(relativeOrAbsolute, defaultRelative) {
  if (relativeOrAbsolute && isAbsolute(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }
  const rel = relativeOrAbsolute || defaultRelative;
  const candidates = [
    resolve(process.cwd(), rel),
    resolve(__dirname, '../', rel),
    resolve(__dirname, rel),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

/**
 * Safely parses request body with bounded payload ceiling to prevent memory exhaustion attacks.
 * Supports both raw streams (local Node) and pre-parsed bodies (Vercel Serverless / Express).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [maxBytes=MAX_PAYLOAD_BYTES]
 * @returns {Promise<any>}
 */
async function readBoundedRequestBody(req, maxBytes = MAX_PAYLOAD_BYTES) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return req.body;
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return new Promise((resolvePromise, rejectPromise) => {
    let bytesRead = 0;
    const chunks = [];
    let exceeded = false;

    req.on('data', (chunk) => {
      if (exceeded) return;
      bytesRead += chunk.length;
      if (bytesRead > maxBytes) {
        exceeded = true;
        req.pause();
        const error = new Error('Payload Too Large: maximum allowed body is 1MB');
        error.statusCode = 413;
        rejectPromise(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (exceeded) return;
      if (chunks.length === 0) {
        resolvePromise(null);
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolvePromise(null);
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        resolvePromise(parsed);
      } catch (err) {
        const error = new Error(`Malformed JSON in request body: ${err.message}`);
        error.statusCode = 400;
        rejectPromise(error);
      }
    });

    req.on('error', (err) => {
      if (!exceeded) {
        rejectPromise(err);
      }
    });
  });
}

/**
 * Serves static files safely from the designated public directory,
 * preventing directory traversal attacks.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 * @param {string} publicDir
 * @returns {Promise<boolean>} True if handled, false if not found
 */
async function serveStaticFile(req, res, pathname, publicDir) {
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (decodeErr) {
    console.warn(`[TierTracker] URI decoding failed for "${pathname}":`, decodeErr?.message);
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request: Malformed URI path');
    return true;
  }

  let relativePath = decodedPath;

  // Route alias mappings
  if (relativePath === '/favicon.ico' || relativePath === '/favicon.svg') {
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#6366f1"/><path d="M16 6 L26 12 L16 18 L6 12 Z M6 15 L16 21 L26 15 M6 20 L16 26 L26 20" stroke="#ffffff" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    res.end(svgIcon);
    return true;
  }

  // Direct route resolution without redirects (guarantees instant loading on Vercel and mobile networks)
  if (
    relativePath === '/app' ||
    relativePath === '/app/' ||
    relativePath === '/student' ||
    relativePath === '/student/' ||
    relativePath === '/mobile' ||
    relativePath === '/mobile/' ||
    relativePath === '/navigator' ||
    relativePath === '/navigator/' ||
    relativePath === '/participant' ||
    relativePath === '/participant/'
  ) {
    relativePath = '/app/index.html';
  } else if (
    relativePath === '/' ||
    relativePath === '' ||
    relativePath === '/admin' ||
    relativePath === '/admin/' ||
    relativePath === '/ops' ||
    relativePath === '/ops/'
  ) {
    relativePath = '/admin/index.html';
  } else if (relativePath === '/admin.js') {
    relativePath = '/admin/admin.js';
  } else if (relativePath === '/app.js') {
    relativePath = '/app/app.js';
  } else if (relativePath === '/styles.css') {
    const referer = req.headers.referer || '';
    relativePath = (referer.includes('/app') || referer.includes('/student') || referer.includes('/mobile'))
      ? '/app/styles.css'
      : '/admin/styles.css';
  }

  // Canonical path resolution and strict directory jail verification
  const resolvedPublicDir = resolve(publicDir);
  const normalizedPath = normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const filePath = resolve(resolvedPublicDir, `.${normalizedPath}`);

  const relFromRoot = relative(resolvedPublicDir, filePath);
  if (relFromRoot.startsWith('..') || isAbsolute(relFromRoot)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Directory traversal prevented');
    return true;
  }

  try {
    let fileStats = await stat(filePath);

    let finalPath = filePath;
    if (fileStats.isDirectory()) {
      finalPath = join(filePath, 'index.html');
      fileStats = await stat(finalPath);
    }

    const ext = extname(finalPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await readFile(finalPath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return false;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`500 Internal Server Error: ${err.message}`);
    return true;
  }
}

/**
 * Factory creating an HTTP request listener compatible with Node.js http.createServer
 * and Vercel Serverless Function entrypoints.
 *
 * @param {Object} [options={}]
 * @returns {((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>) & Object}
 */
export function createRequestHandler(options = {}) {
  const dbPath = resolvePathWithFallback(options.dbPath, 'data/db.json');
  const publicDir = resolvePathWithFallback(options.publicDir, 'public');
  const windowSec = typeof options.windowSec === 'number' ? options.windowSec : 60;

  const repository = options.repository || new AtomicFileVenueRepository(dbPath);
  const presenceStore = options.presenceStore || new SlidingWindowPresenceStore(windowSec);

  const enableWifiTelemetry = options.enableWifiTelemetry ?? false;
  let wifiTelemetryService = options.wifiTelemetryService || null;

  if (enableWifiTelemetry && !wifiTelemetryService) {
    wifiTelemetryService = new CampusWifiTelemetryService({
      presenceStore,
      repository,
    }, {
      updateIntervalMs: options.wifiUpdateIntervalMs || 8000,
      profile: options.wifiProfile || 'NORMAL',
    });
    wifiTelemetryService.start().catch((err) => {
      console.warn('[Server] Campus Wi-Fi telemetry init failed:', err?.message);
    });
  }

  const apiHandler = createApiHandler({ repository, presenceStore, wifiTelemetryService });

  const handler = async function app(req, res) {
    // 1. CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (req.method?.toUpperCase() === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      // 2. Body ingestion with bounds (supports raw stream and pre-parsed Vercel bodies)
      let body = null;
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        body = await readBoundedRequestBody(req);
      }

      // 3. Dispatch to REST API handler
      const handledByApi = await apiHandler(req, res, parsedUrl, body);
      if (handledByApi) {
        return;
      }

      // 4. Static file serving
      const handledStatic = await serveStaticFile(req, res, parsedUrl.pathname, publicDir);
      if (handledStatic) {
        return;
      }

      // 5. 404 Fallback
      sendJson(res, 404, {
        error: 'Not Found',
        path: parsedUrl.pathname,
      });
    } catch (err) {
      const statusCode = typeof err.statusCode === 'number'
        ? err.statusCode
        : (err instanceof URIError ? 400 : 500);

      if (!res.headersSent) {
        if (statusCode === 413) {
          res.setHeader('Connection', 'close');
        }
        sendJson(res, statusCode, {
          error: err.message || 'Internal Server Error',
        });
      }

      if (statusCode === 413) {
        req.destroy();
      }
    }
  };

  handler.repository = repository;
  handler.presenceStore = presenceStore;
  handler.wifiTelemetryService = wifiTelemetryService;
  handler.apiHandler = apiHandler;

  return handler;
}

/**
 * Factory creating the TierTracker HTTP server.
 *
 * @param {Object} [options={}]
 * @returns {import('node:http').Server & { repository: AtomicFileVenueRepository, presenceStore: SlidingWindowPresenceStore }}
 */
export function createServer(options = {}) {
  const handler = createRequestHandler(options);
  const server = createHttpServer(handler);

  server.repository = handler.repository;
  server.presenceStore = handler.presenceStore;
  server.wifiTelemetryService = handler.wifiTelemetryService;
  server.apiHandler = handler.apiHandler;

  return server;
}

// Lazy singleton handler for Vercel Serverless Function execution
let defaultAppInstance = null;
function getDefaultApp() {
  if (!defaultAppInstance) {
    defaultAppInstance = createRequestHandler({
      enableWifiTelemetry: true,
    });
  }
  return defaultAppInstance;
}

/**
 * Default HTTP application handler for Vercel Serverless Function deployment.
 * Compatible with Vercel's Node.js runtime (`export default app`).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
export default async function app(req, res) {
  const handler = getDefaultApp();
  return handler(req, res);
}

/**
 * Starts the server on the specified port.
 *
 * @param {number|string} [port=3000]
 * @param {string} [host='0.0.0.0']
 * @param {Object} [options={}]
 * @returns {Promise<import('node:http').Server>}
 */
export async function startServer(port = process.env.PORT || 3000, host = '0.0.0.0', options = {}) {
  const server = createServer({
    enableWifiTelemetry: options.enableWifiTelemetry !== false,
    ...options,
  });

  return new Promise((resolvePromise) => {
    server.listen(Number(port), host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`[TierTracker] HTTP Gateway listening on http://${host}:${actualPort}`);

      const shutdown = () => {
        console.log('\n[TierTracker] Initiating graceful shutdown...');
        if (server.wifiTelemetryService) {
          server.wifiTelemetryService.stop();
        }
        server.close(() => {
          console.log('[TierTracker] Server shutdown complete.');
          process.exit(0);
        });
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      resolvePromise(server);
    });
  });
}

// Direct execution entrypoint
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  startServer(process.env.PORT || 3000);
}
