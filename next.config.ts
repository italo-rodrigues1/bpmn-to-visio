import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/convert": ["./converter/**/*"],
  },
};

export default nextConfig;
