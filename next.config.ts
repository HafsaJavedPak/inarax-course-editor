import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (EDITOR_DATABASE_URL=pglite:…, local work) loads its own WebAssembly files; don't bundle it.
  serverExternalPackages: [
    "@electric-sql/pglite",
    // The collaboration gateway (embedded in the dev server with COLLAB_EMBEDDED=1).
    // Yjs must be loaded once per process: a bundled second copy breaks its type checks.
    "@hocuspocus/server",
    "@hocuspocus/common",
    "yjs",
    "lib0",
    "y-protocols",
    "crossws",
  ],
  images: {
    // The lesson preview (vendor/inara-player) shows author-supplied images
    // from any host with next/image, as inara-next does; serve them as-is.
    unoptimized: true,
  },
};

export default nextConfig;
