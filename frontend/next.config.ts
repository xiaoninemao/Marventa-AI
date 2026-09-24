import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.xiaohongshu.com" },
      { protocol: "https", hostname: "**.xhscdn.com" },
      { protocol: "http", hostname: "**.xhscdn.com" },
      { protocol: "https", hostname: "**.xhslink.com" },
      { protocol: "https", hostname: "**.douyin.com" },
      { protocol: "https", hostname: "**.douyinpic.com" },
      { protocol: "http", hostname: "localhost", port: "8765" },
      { protocol: "http", hostname: "127.0.0.1", port: "8765" },
    ],
  },
};

export default nextConfig;
