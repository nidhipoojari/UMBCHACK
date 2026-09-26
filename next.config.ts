import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No static export: sign-in reads the URL on the server and /api/users talks
  // to Cloud SQL, so the app needs a Next.js server to run.
  images: { unoptimized: true },
  // Pin the workspace root. Without this Turbopack walks up and finds the stray
  // package-lock.json in the home directory, then warns on every build.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
