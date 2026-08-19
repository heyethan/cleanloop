/** Shared domain types (spec §5 data model). Imported by ai.ts, routes, and components. */

export type WasteType =
  | "mixed"
  | "plastic"
  | "organic"
  | "construction"
  | "hazardous"
  | "other";

export type ReportStatus = "open" | "claimed" | "verified_resolved";

export type VerificationResult = "verified_clean" | "ambiguous" | "not_clean";

export interface Classification {
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
