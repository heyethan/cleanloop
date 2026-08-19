"use client";

/**
 * Public map of reports — spec §3 Flow C, red / yellow / green pins.
 *
 * Importers/callers: src/app/page.tsx.
 * Affected API: exports MapView (default), filterReports, useReports,
 * STATUS_COLOUR, STATUS_LABEL; calls GET /api/reports over HTTP.
 * Data schemas: consumes the Report shape from src/lib/types.ts; created_at is ISO-8601.
 * User instruction, verbatim: "just proceed with building, we'll handle the API part later"
 *
 * Leaflet touches window on import, so it is loaded dynamically with ssr:false by the
 * parent. Tiles are OpenStreetMap — no API key, no signup friction (§7).
 */

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import type { Report, ReportStatus } from "@/lib/types";

/** Bengaluru city centre — opening view. */
const CENTRE: [number, number] = [12.9716, 77.5946];

const STATUS_COLOUR: Record<ReportStatus, string> = {
  open: "#dc2626", // red — reported, nothing has happened
  claimed: "#eab308", // yellow — someone says it's clean, AI is not convinced
  verified_resolved: "#16a34a", // green — AI verified
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  open: "Open",
  claimed: "Claimed, unverified",
  verified_resolved: "Verified clean",
};

export default function MapView({
  reports,
  onSelect,
}: {
  reports: Report[];
  onSelect: (r: Report) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-full w-full bg-neutral-100" />;

  return (
    <MapContainer center={CENTRE} zoom={12} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {reports.map((r) => (
        <CircleMarker
          key={r.id}
          center={[r.lat, r.lng]}
          // Severity drives radius so a big dump reads as a big dot.
          radius={5 + r.severity * 1.6}
          pathOptions={{
            color: STATUS_COLOUR[r.status],
            fillColor: STATUS_COLOUR[r.status],
            fillOpacity: 0.7,
            weight: 2,
          }}
        >
          <Popup>
            <div className="min-w-[200px] text-sm">
              <div className="font-semibold">
                {STATUS_LABEL[r.status]} · severity {r.severity}/5
              </div>
              <div className="mt-1 capitalize text-neutral-600">{r.waste_type} waste</div>
              {r.is_recurring && (
                <div className="mt-1 font-medium text-orange-600">
                  Recurring spot — reported here before
                </div>
              )}
              {r.is_seed && (
                <div className="mt-1 text-xs text-neutral-400">Synthetic seed data</div>
              )}
              <button
                onClick={() => onSelect(r)}
                className="mt-2 w-full rounded bg-neutral-900 px-2 py-1 text-white"
              >
                {r.status === "verified_resolved" ? "View" : "Submit after photo"}
              </button>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

export { STATUS_COLOUR, STATUS_LABEL };

// NOTE: useReports/filterReports deliberately live in src/lib/useReports.ts, not here.
// Anything page.tsx imports statically from this module pulls react-leaflet into the
// server bundle and breaks the prerender with "window is not defined".
