/** Shared domain types (spec §5 data model). Imported by ai.ts, routes, and components. */

export type WasteType =
  | "mixed"
  | "plastic"
  | "organic"
  | "construction"
  | "hazardous"
  | "other";

export type ReportStatus = "open" | "claimed" | "awaiting_confirmation" | "verified_resolved";

export type VerificationResult = "verified_clean" | "ambiguous" | "not_clean";

export interface Classification {
  /**
   * False when the photo does not show waste at all. The intake rejects these before
   * anything is uploaded, stored, or drafted into a complaint.
   */
  is_waste: boolean;
  waste_type: WasteType;
  severity: number; // 1-5
  confidence: number; // 0-1
  one_line_description: string;
}

export interface Verification {
  result: VerificationResult;
  confidence: number; // 0-1
  reasoning: string;
}

export interface ComplaintInput {
  waste_type: WasteType;
  severity: number;
  /**
   * The classifier's own sentence about the photo. Passed so the complaint describes what
   * was actually observed instead of inferring prose from a type and a number — a photo of a
   * flowchart once produced "accumulated construction debris ... has been observed".
   */
  description: string;
  is_recurring: boolean;
  ward_name: string | null;
  lat: number;
  lng: number;
}

export interface Report {
  id: string;
  photo_before_url: string;
  lat: number;
  lng: number;
  ward_id: string | null;
  waste_type: WasteType;
  severity: number;
  is_recurring: boolean;
  recurring_of_report_id: string | null;
  status: ReportStatus;
  complaint_text: string | null;
  ai_description: string | null;
  ai_confidence: number | null;
  created_at: string; // ISO-8601, from Postgres timestamptz
  reporter_session_id: string | null;
  is_seed: boolean;
  /* schema v3 (optional so older rows and the seed script keep type-checking) */
  category?: "waste" | "road";
  road_issue?: string | null;
  gba_ward_id?: string | null;
  corporation?: string | null;
  zone?: string | null;
  description?: string | null;
  sent_at?: string | null;
  acknowledged_at?: string | null;
  assigned_to?: string | null;
  eta_at?: string | null;
  verified_at?: string | null;
  confirm_due_at?: string | null;
  closed_at?: string | null;
  reopen_count?: number;
  source?: string;
  source_attribution?: string | null;
  source_url?: string | null;
  is_public?: boolean;
}

/**
 * What the map and list need for one case — GET /api/reports. The full row (text, timeline
 * fields, the responsible official) loads on open from GET /api/reports/[id].
 */
export interface Pin {
  id: string;
  lat: number;
  lng: number;
  status: ReportStatus;
  severity: number;
  category: "waste" | "road";
  waste_type: WasteType | null;
  road_issue: string | null;
  is_recurring: boolean;
  created_at: string; // ISO-8601
  photo_before_url: string;
  ward_name: string | null;
  zone: string | null;
  /** Past its resolve deadline (src/lib/areas.ts isOverdue). Never true for imported cases. */
  overdue: boolean;
}

/** GET /api/areas — one GBA ward (MultiPolygon feature properties). */
export interface WardArea {
  id: string;
  ward_no: number;
  name: string;
  name_kn: string;
  zone: string;
  corporation: string;
  open: number;
  overdue: number;
}

/** GET /api/areas — one GBA zone (outline feature properties). bbox is [west, south, east, north]. */
export interface ZoneArea {
  zone: string;
  corporation: string;
  bbox: [number, number, number, number];
  open: number;
  overdue: number;
}

export interface Areas {
  wards: { type: "FeatureCollection"; features: { type: "Feature"; geometry: { type: "MultiPolygon"; coordinates: number[][][][] }; properties: WardArea }[] };
  zones: { type: "FeatureCollection"; features: { type: "Feature"; geometry: { type: "MultiLineString"; coordinates: number[][][] }; properties: ZoneArea }[] };
}

/** A zone or ward as the UI handles it: hover pill, tap card, search row, fly target. */
export interface AreaPick {
  kind: "zone" | "ward";
  /** Ward id ("south-28") or zone name. */
  id: string;
  name: string;
  name_kn: string | null;
  zone: string;
  corporation: string;
  open: number;
  overdue: number;
  bbox: [number, number, number, number];
}

export interface ReportEvent {
  id: number;
  report_id: string;
  kind: string;
  actor: "system" | "reporter" | "official" | "operator";
  data: Record<string, unknown>;
  created_at: string; // ISO-8601
}

export interface Resolution {
  id: string;
  report_id: string;
  photo_after_url: string;
  ai_verification_result: VerificationResult;
  ai_confidence: number;
  ai_reasoning: string | null;
  submitted_at: string; // ISO-8601
  verified_at: string | null; // ISO-8601
  resolver_session_id: string | null;
  is_self_resolved: boolean;
}
