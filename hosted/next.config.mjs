import { fileURLToPath } from "node:url";

const hostedRoot = fileURLToPath(new URL(".", import.meta.url));

const contentSecurityPolicy = [
  "default-src 'self'",
  "connect-src 'self' https://kukpvpklizsvedcmybhn.supabase.co blob:",
  "img-src 'self' blob: data: https://kukpvpklizsvedcmybhn.supabase.co",
  "media-src 'self' blob: https://kukpvpklizsvedcmybhn.supabase.co",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: hostedRoot,
  reactStrictMode: true,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    }];
  },
};

export default nextConfig;
