import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/cli/install": ["./tools/contestant-cli/install-macos.sh"],
    "/api/cli/download": ["./tools/contestant-cli/submit-macos"],
  },
  /* config options here */
  experimental: {
    serverActions: {
      bodySizeLimit: "1gb",
    },
    proxyClientMaxBodySize: "1gb",
  },
  serverExternalPackages: ["mathjax-full", "rehype-mathjax"],
};

export default nextConfig;
