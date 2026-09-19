/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
  poweredByHeader: false,
};

export default nextConfig;
