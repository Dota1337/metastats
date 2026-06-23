import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    root: path.resolve(__dirname),
  },
  async redirects() {
    return [
      {
        source: '/tft',
        destination: '/tft/comps',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
