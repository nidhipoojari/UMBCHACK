import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: the landing page has no server features (no route handlers,
  // server actions, or next/headers), so it ships as plain files to a CDN.
  output: "export",
  images: { unoptimized: true },
  // Pin the workspace root. Without this Turbopack walks up and finds the stray
  // package-lock.json in the home directory, then warns on every build.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
