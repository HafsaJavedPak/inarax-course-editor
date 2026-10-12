import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (EDITOR_DATABASE_URL=pglite:…, local work) loads its own WebAssembly files; don't bundle it.
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    // The lesson preview (vendor/inara-player) shows author-supplied images
    // from any host with next/image, as inara-next does; serve them as-is.
    unoptimized: true,
  },
};

export default nextConfig;
