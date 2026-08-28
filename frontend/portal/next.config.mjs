/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Local dev machine runs tight on free memory (Docker Desktop's VM alone
  // claims ~4GB of 8GB total) — Next's default multi-process compile worker
  // pool can fail to spawn a child under that pressure, surfacing as
  // "Jest worker encountered N child process exceptions, exceeding retry
  // limit" (jest-worker is Next's internal compile-worker library, unrelated
  // to actual Jest tests). Capping to a single worker avoids the extra
  // child-process spawns that trigger it.
  experimental: {
    cpus: 1,
  },
};

export default nextConfig;
