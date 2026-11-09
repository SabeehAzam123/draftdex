import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // The SQLite driver is a native module: load it from node_modules at runtime instead of bundling it
    serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
