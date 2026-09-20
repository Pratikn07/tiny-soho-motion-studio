import { fileURLToPath } from "node:url";

const hostedRoot = fileURLToPath(new URL(".", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: hostedRoot,
  reactStrictMode: true,
};

export default nextConfig;
