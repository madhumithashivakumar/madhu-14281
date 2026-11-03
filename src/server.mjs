/**
 * @file server.mjs
 * @description Vercel Serverless Function & ESM entrypoint for TierTracker.
 * Exports the app handler as the default export for Vercel serverless runtime:
 *   export default app;
 * Supports both Vercel serverless deployment and direct local execution:
 *   node src/server.mjs
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import app, {
  createRequestHandler,
  createServer,
  startServer,
  resolvePathWithFallback,
} from './server.js';

export {
  createRequestHandler,
  createServer,
  startServer,
  resolvePathWithFallback,
};

export default app;

// Support running locally directly with: node src/server.mjs
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  startServer(process.env.PORT || 3000);
}
