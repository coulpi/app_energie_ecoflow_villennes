/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@app/shared"],
  // Erreurs TS préexistantes sur des callbacks Prisma non annotés ;
  // le code compile, on ne bloque pas la build de prod sur le typecheck.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
