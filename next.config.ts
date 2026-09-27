import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No static export: sign-in reads the URL on the server and /api/users talks
  // to Cloud SQL, so the app needs a Next.js server to run.
  images: { unoptimized: true },
  // Both of these reach node_modules at runtime — pg loads its native/optional
  // bits by dynamic require, and the Cloud SQL connector does the same. Left to
  // bundle them, Turbopack emits an "external module" reference under a hashed
  // name (pg-587764f78a6c7a9c) that resolves during a local build and does not
  // exist inside the deployed function, so /api/* died at import with
  // ERR_MODULE_NOT_FOUND before it ever opened a connection. Listing them here
  // makes the emitted code a plain require() against the node_modules the
  // function ships with.
  serverExternalPackages: ['pg', '@google-cloud/cloud-sql-connector'],
  // Pin the workspace root. Without this Turbopack walks up and finds the stray
  // package-lock.json in the home directory, then warns on every build.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
