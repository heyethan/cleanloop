import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-mode indicator badge renders bottom-left, directly over the
  // "Report a dump spot" CTA and the leaderboard footnote. Off so a demo run
  // via `npm run dev` isn't showing a Next.js logo on top of the main button.
  devIndicators: false,
};

export default nextConfig;
