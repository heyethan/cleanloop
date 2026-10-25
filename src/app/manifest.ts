import type { MetadataRoute } from "next";

/** Installable "Add to home screen" metadata. Icons are the linked-rings mark (public/icon-*.png). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CleanLoop",
    short_name: "CleanLoop",
    description: "Report a garbage dump in Bengaluru. A cleanup only counts when an after photo, taken at the spot, proves it.",
    start_url: "/",
    display: "standalone",
    background_color: "#070a0f",
    theme_color: "#070a0f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
