/** @type {import('next').NextConfig} */
const POSTHOG_PROXY_PATH = "/matchbook-relay";

const nextConfig = {
  async rewrites() {
    return [
      {
        source: `${POSTHOG_PROXY_PATH}/static/:path*`,
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: `${POSTHOG_PROXY_PATH}/array/:path*`,
        destination: "https://us-assets.i.posthog.com/array/:path*",
      },
      {
        source: `${POSTHOG_PROXY_PATH}/:path*`,
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
