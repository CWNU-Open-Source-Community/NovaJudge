import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/cli/install": ["./tools/contestant-cli/install-macos.sh", "./tools/contestant-cli/install-windows.ps1"],
    "/api/cli/download": ["./tools/contestant-cli/submit-macos", "./tools/contestant-cli/submit.ps1", "./tools/contestant-cli/submit.cmd", "./tools/contestant-cli/submit.bat"],
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
