import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-mode indicator badge renders bottom-left, directly over the
  // "Report a dump spot" CTA and the leaderboard footnote. Off so a demo run
  // via `npm run dev` isn't showing a Next.js logo on top of the main button.
  devIndicators: false,
  // The image model is read from disk at request time, which the tracer can't see.
  // Without this the report/resolve functions deploy without it and every upload fails.
  outputFileTracingIncludes: {
    "/api/reports/**": ["./model/**/*"],
  },
};

export default nextConfig;
