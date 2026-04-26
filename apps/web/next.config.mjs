/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    typedRoutes: false,
  },
  transpilePackages: ["@app/shared"],
};

export default nextConfig;
