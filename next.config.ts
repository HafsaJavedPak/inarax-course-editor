import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // The lesson preview (vendor/inara-player) shows author-supplied images
    // from any host with next/image, as inara-next does; serve them as-is.
    unoptimized: true,
  },
};

export default nextConfig;
