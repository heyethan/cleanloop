"use client";

/**
 * UI localisation — English (default) and Kannada.
 *
 * Importers/callers: src/app/page.tsx, src/components/ListView.tsx, ReportSheet.tsx,
 * ResolveSheet.tsx, Leaderboard.tsx.
 * Affected API: exports Lang, STRINGS, translate(), useLang().
 * Data schemas: reads/writes one localStorage key ("cleanloop_lang"), value "en" | "kn".
 * User instruction, verbatim: "Localization option with english or kannada, english by default"
 *
 * SCOPE: UI chrome only. AI-generated complaint text stays English on purpose — it is
 * produced at runtime by the model and goes into an official complaint, so machine
 * round-tripping it into Kannada would put unverified text in front of a ward office.
 *
 * ⚠️ KANNADA STRINGS NEED A NATIVE-SPEAKER REVIEW before the demo. They are a
 * best-effort translation and have NOT been verified by a Kannada speaker. Anything
 * wrong here is visible to Bengaluru judges, so treat this as draft copy.
 */

import { useCallback, useEffect, useState } from "react";

export type Lang = "en" | "kn";

const KEY = "cleanloop_lang";

type Dict = Record<string, string>;

export const STRINGS: Record<Lang, Dict> = {
  en: {
    // header
    city: "Bengaluru",
    verified_clean: "verified clean",
    median_to_verify: "median to verify",
    closure_rate: "closure rate",
    open_count: "open",
    held_count: "held",
    verified_short: "verified",
    wards: "Wards",
    filter: "filter",
    hide: "hide",
    // locality search + outline
    search_locality: "Search a locality",
    search_placeholder: "Jump to a locality…",
    search_hint: "↑↓ to move · ↵ to go",
    search_empty: "No locality matches",
    search_open: "Search",
    // views
    map_view: "Map",
    list_view: "List",
    dim_2d: "2D",
    dim_3d: "3D",
    // filters
    all_wards: "All wards",
    all_statuses: "All statuses",
    all_severities: "All severities",
    severity_label: "Severity",
    show_bins: "Show {n} public bins",
    sort_by_severity: "Worst first",
    sort_by_recent: "Newest first",
    // statuses
    status_open: "Open",
    status_claimed: "Held for review",
    status_verified: "Verified clean",
    // waste types (mirror the DB enum)
    waste_mixed: "Mixed",
    waste_plastic: "Plastic",
    waste_organic: "Organic",
    waste_construction: "Construction",
    waste_hazardous: "Hazardous",
    waste_other: "Other",
    // list
    no_reports: "No reports match these filters.",
    days_open: "{n}d open",
    days_ago: "reported {n}d ago",
    recurring: "Recurring",
    severity_of: "Severity {n}/5",
    // report flow
    report_cta: "Report a dump spot",
    new_report: "New report",
    reported: "Reported",
    on_the_map: "On the map",
    photo: "Photo",
    location: "Location",
    take_photo: "Take or choose a photo",
    camera_opens: "Camera opens directly",
    choose_file: "JPG or PNG from this device",
    needs_photo: "Add a photo to continue",
    needs_location: "Add a location to continue",
    location_outside: "That location is outside Bengaluru",
    after_submit:
      "Posts to the public map immediately and counts toward your ward's resolution time.",
    tap_to_change: "Tap to change",
    use_my_location: "Use my location",
    locating: "Locating…",
    submit_report: "Submit report",
    analysing: "Analysing…",
    done: "Done",
    waste_type: "Waste type",
    history: "History",
    recurring_spot: "Recurring spot",
    first_report: "First report here",
    draft_complaint: "Draft complaint",
    turn_green_promise: "You'll see this turn green when it's verified clean.",
    // verify flow
    close_the_loop: "Close the loop",
    verify_cleanup: "Verify cleanup",
    verification_result: "Verification result",
    held_for_review: "Held for review",
    after_photo: "Add the after photo",
    submit_for_verification: "Submit for verification",
    comparing: "Comparing…",
    pin_now_green: "Pin is now green",
    case_stays_open: "Case stays open",
    before: "Before",
    location_set: "Location set",
    certainty: "{n}% certain",
    proof_missing: "The cleanup photo for this case is unavailable.",
    self_resolved_flag: "Reported and cleaned by the same person.",
    not_genuine_pair:
      "Example pair — two different photos, not one spot before and after.",
    // leaderboard
    accountability: "Accountability",
    ward_performance: "Ward performance",
    fastest: "fastest",
    slowest: "slowest",
    showing_n: "Showing {n} cases",
    verified_of: "{a} of {b} verified",
    loading: "Loading…",
  },
  kn: {
    // header
    city: "ಬೆಂಗಳೂರು",
    verified_clean: "ಪರಿಶೀಲಿಸಿ ಸ್ವಚ್ಛ",
    median_to_verify: "ಪರಿಶೀಲನೆಗೆ ಸರಾಸರಿ",
    closure_rate: "ಇತ್ಯರ್ಥ ಪ್ರಮಾಣ",
    open_count: "ಬಾಕಿ",
    held_count: "ತಡೆಹಿಡಿದ",
    verified_short: "ಪರಿಶೀಲಿತ",
    wards: "ವಾರ್ಡ್‌ಗಳು",
    // locality search + outline — UNREVIEWED, see the file header
    search_locality: "ಪ್ರದೇಶ ಹುಡುಕಿ",
    search_placeholder: "ಪ್ರದೇಶಕ್ಕೆ ಹೋಗಿ…",
    search_hint: "↑↓ ಆಯ್ಕೆ · ↵ ಹೋಗಿ",
    search_empty: "ಯಾವ ಪ್ರದೇಶವೂ ಹೊಂದಿಕೆಯಾಗಲಿಲ್ಲ",
    search_open: "ಹುಡುಕಿ",
    filter: "ಶೋಧಿಸು",
    hide: "ಮರೆಮಾಡು",
    // views
    map_view: "ನಕ್ಷೆ",
    list_view: "ಪಟ್ಟಿ",
    dim_2d: "2D",
    dim_3d: "3D",
    // filters
    all_wards: "ಎಲ್ಲಾ ವಾರ್ಡ್‌ಗಳು",
    all_statuses: "ಎಲ್ಲಾ ಸ್ಥಿತಿಗಳು",
    all_severities: "ಎಲ್ಲಾ ತೀವ್ರತೆಗಳು",
    severity_label: "ತೀವ್ರತೆ",
    show_bins: "{n} ಸಾರ್ವಜನಿಕ ತೊಟ್ಟಿಗಳನ್ನು ತೋರಿಸು",
    sort_by_severity: "ತೀವ್ರವಾದವು ಮೊದಲು",
    sort_by_recent: "ಹೊಸದು ಮೊದಲು",
    // statuses
    status_open: "ಬಾಕಿ",
    status_claimed: "ಪರಿಶೀಲನೆಗೆ ತಡೆಹಿಡಿದ",
    status_verified: "ಸ್ವಚ್ಛ ಎಂದು ಪರಿಶೀಲಿಸಲಾಗಿದೆ",
    // waste types (mirror the DB enum)
    waste_mixed: "ಮಿಶ್ರ",
    waste_plastic: "ಪ್ಲಾಸ್ಟಿಕ್",
    waste_organic: "ಸಾವಯವ",
    waste_construction: "ಕಟ್ಟಡ ತ್ಯಾಜ್ಯ",
    waste_hazardous: "ಅಪಾಯಕಾರಿ",
    waste_other: "ಇತರೆ",
    // list
    no_reports: "ಈ ಶೋಧಕಗಳಿಗೆ ಯಾವುದೇ ವರದಿ ಹೊಂದಿಕೆಯಾಗಿಲ್ಲ.",
    days_open: "{n} ದಿನಗಳಿಂದ ಬಾಕಿ",
    days_ago: "{n} ದಿನಗಳ ಹಿಂದೆ ವರದಿ",
    recurring: "ಪುನರಾವರ್ತಿತ",
    severity_of: "ತೀವ್ರತೆ {n}/5",
    // report flow
    report_cta: "ಕಸದ ಸ್ಥಳವನ್ನು ವರದಿ ಮಾಡಿ",
    new_report: "ಹೊಸ ವರದಿ",
    reported: "ವರದಿಯಾಗಿದೆ",
    on_the_map: "ನಕ್ಷೆಯಲ್ಲಿ",
    photo: "ಫೋಟೋ",
    location: "ಸ್ಥಳ",
    take_photo: "ಫೋಟೋ ತೆಗೆಯಿರಿ ಅಥವಾ ಆಯ್ಕೆಮಾಡಿ",
    camera_opens: "ಕ್ಯಾಮೆರಾ ನೇರವಾಗಿ ತೆರೆಯುತ್ತದೆ",
    choose_file: "ಈ ಸಾಧನದಿಂದ JPG ಅಥವಾ PNG",
    needs_photo: "ಮುಂದುವರಿಯಲು ಫೋಟೋ ಸೇರಿಸಿ",
    needs_location: "ಮುಂದುವರಿಯಲು ಸ್ಥಳ ಸೇರಿಸಿ",
    location_outside: "ಆ ಸ್ಥಳ ಬೆಂಗಳೂರಿನ ಹೊರಗಿದೆ",
    after_submit:
      "ತಕ್ಷಣ ಸಾರ್ವಜನಿಕ ನಕ್ಷೆಯಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ ಮತ್ತು ನಿಮ್ಮ ವಾರ್ಡ್‌ನ ಇತ್ಯರ್ಥ ಸಮಯದಲ್ಲಿ ಎಣಿಸಲಾಗುತ್ತದೆ.",
    tap_to_change: "ಬದಲಾಯಿಸಲು ಟ್ಯಾಪ್ ಮಾಡಿ",
    use_my_location: "ನನ್ನ ಸ್ಥಳವನ್ನು ಬಳಸಿ",
    locating: "ಸ್ಥಳ ಪತ್ತೆ ಮಾಡಲಾಗುತ್ತಿದೆ…",
    submit_report: "ವರದಿ ಸಲ್ಲಿಸಿ",
    analysing: "ವಿಶ್ಲೇಷಿಸಲಾಗುತ್ತಿದೆ…",
    done: "ಮುಗಿದಿದೆ",
    waste_type: "ಕಸದ ಪ್ರಕಾರ",
    history: "ಇತಿಹಾಸ",
    recurring_spot: "ಪುನರಾವರ್ತಿತ ಸ್ಥಳ",
    first_report: "ಇಲ್ಲಿ ಮೊದಲ ವರದಿ",
    draft_complaint: "ದೂರಿನ ಕರಡು",
    turn_green_promise: "ಸ್ವಚ್ಛ ಎಂದು ಪರಿಶೀಲಿಸಿದಾಗ ಇದು ಹಸಿರು ಬಣ್ಣಕ್ಕೆ ತಿರುಗುತ್ತದೆ.",
    // verify flow
    close_the_loop: "ಪ್ರಕ್ರಿಯೆ ಪೂರ್ಣಗೊಳಿಸಿ",
    verify_cleanup: "ಸ್ವಚ್ಛತೆಯನ್ನು ಪರಿಶೀಲಿಸಿ",
    verification_result: "ಪರಿಶೀಲನೆಯ ಫಲಿತಾಂಶ",
    held_for_review: "ಪರಿಶೀಲನೆಗೆ ತಡೆಹಿಡಿದಿದೆ",
    after_photo: "ನಂತರದ ಫೋಟೋ ಸೇರಿಸಿ",
    submit_for_verification: "ಪರಿಶೀಲನೆಗೆ ಸಲ್ಲಿಸಿ",
    comparing: "ಹೋಲಿಸಲಾಗುತ್ತಿದೆ…",
    pin_now_green: "ಈಗ ಹಸಿರು ಗುರುತು",
    case_stays_open: "ಪ್ರಕರಣ ಬಾಕಿ ಉಳಿಯುತ್ತದೆ",
    before: "ಮೊದಲು",
    location_set: "ಸ್ಥಳ ನಿಗದಿಯಾಗಿದೆ",
    certainty: "{n}% ಖಚಿತ",
    proof_missing: "ಈ ಪ್ರಕರಣದ ಸ್ವಚ್ಛತೆಯ ಫೋಟೋ ಲಭ್ಯವಿಲ್ಲ.",
    self_resolved_flag: "ವರದಿ ಮಾಡಿದ ಅದೇ ವ್ಯಕ್ತಿಯಿಂದ ಸ್ವಚ್ಛಗೊಳಿಸಲಾಗಿದೆ.",
    not_genuine_pair:
      "ಉದಾಹರಣೆ ಜೋಡಿ — ಎರಡು ಬೇರೆ ಫೋಟೋಗಳು, ಒಂದೇ ಸ್ಥಳದ ಮೊದಲು-ನಂತರ ಅಲ್ಲ.",
    // leaderboard
    accountability: "ಜವಾಬ್ದಾರಿ",
    ward_performance: "ವಾರ್ಡ್ ಕಾರ್ಯಕ್ಷಮತೆ",
    fastest: "ಅತಿ ವೇಗ",
    slowest: "ಅತಿ ನಿಧಾನ",
    showing_n: "{n} ಪ್ರಕರಣಗಳು",
    verified_of: "{b} ರಲ್ಲಿ {a} ಪರಿಶೀಲಿಸಲಾಗಿದೆ",
    loading: "ಲೋಡ್ ಆಗುತ್ತಿದೆ…",
  },
};

/** Interpolates {name} placeholders. Falls back to English, then to the key itself. */
export function translate(
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
) {
  const raw = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    raw,
  );
}

export function useLang() {
  const [lang, setLangState] = useState<Lang>("en");

  // Read after mount, not during render — localStorage doesn't exist on the server
  // and reading it during render would desync hydration.
  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    if (stored === "en" || stored === "kn") setLangState(stored);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    window.localStorage.setItem(KEY, l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );

  return { lang, setLang, t };
}
