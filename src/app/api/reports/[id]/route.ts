/**
 * GET /api/reports/[id] — one case in full, for the case card: the row, its real GBA ward / zone /
 * corporation, the responsible official (pickOfficial) and its SLA state.
 *
 * Importers/callers: src/components/ResolveSheet.tsx (on open). The map list (GET /api/reports)
 * only carries slim pins.
 * Affected API: { report, ward: {id, name, name_kn, zone, corporation} | null,
 *   official: {name, role, photo_url, source_url} | null, sla: {resolveDue, resolveOverdue} | null }.
 * Data schemas: reads reports, officials, sla_config. Explicit columns: no reporter fields and no
 * provenance columns (source, source_attribution, source_url, photo_* attribution).
 */
import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { wardMeta } from "@/lib/gbaWards";
import { pickOfficial, type Official } from "@/lib/officials";
import { slaState } from "@/lib/sla";
import { isOverdue, type CaseRow } from "@/lib/areas";

const CASE_COLUMNS =
  "id, photo_before_url, lat, lng, waste_type, severity, is_recurring, status, complaint_text, ai_description, " +
  "created_at, is_seed, category, road_issue, gba_ward_id, corporation, zone, description, sent_at, acknowledged_at, " +
  "assigned_to, eta_at, verified_at, confirm_due_at, closed_at, reopen_count, source";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const db = serverClient();
    const [{ data: row, error }, { data: officials }, { data: cfgRows }] = await Promise.all([
      db.from("reports").select(CASE_COLUMNS).eq("id", id).single(),
      db.from("officials").select("*").order("id"),
      db.from("sla_config").select("*"),
    ]);
    if (error || !row) return NextResponse.json({ error: "not found" }, { status: 404 });
    const r = row as unknown as CaseRow & { id: string; is_seed: boolean };
    const ward = r.gba_ward_id ? wardMeta(r.gba_ward_id) : null;
    const official = ward ? pickOfficial((officials ?? []) as Official[], ward, r.category ?? "waste") : null;
    const cfg = Object.fromEntries((cfgRows ?? []).map((c) => [c.category, c]));
    // Deadlines are ours: imported cases get none.
    const sla = r.source === "cleanloop"
      ? { resolveDue: slaState(r, cfg[r.category ?? "waste"] ?? cfg.waste).resolveDue, resolveOverdue: isOverdue(r, cfg) }
      : null;
    const { source: _source, ...report } = row as unknown as Record<string, unknown>;
    void _source;
    return NextResponse.json({
      report,
      ward: ward && { id: ward.id, name: ward.name, name_kn: ward.name_kn, zone: ward.zone_name, corporation: ward.corporation },
      official: official && { name: official.name, role: official.role, photo_url: official.photo_url, source_url: official.source_url },
      sla,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
