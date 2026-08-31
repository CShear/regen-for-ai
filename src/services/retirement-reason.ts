/**
 * Retirement reason builder.
 *
 * Produces HUMAN-READABLE reason strings for MsgRetire and MsgSend
 * retirement fields.
 *
 * History: issue #101 (Phase A) originally wrote JSON-LD structured
 * metadata into the reason field. That JSON rendered as raw code on
 * Regen Marketplace retirement certificates ("Reason" showing
 * {"@context":...}), which buyers flagged (Aug 2026). The reason field
 * is buyer-facing; machine attribution now lives in the tool name in
 * the sentence. Legacy JSON reasons are cleaned for display via
 * humanizeRetirementReason().
 */

const BRAND = "Regen Compute";

export interface RetirementReasonOptions {
  /** Fully custom reason — used verbatim when provided. */
  note?: string;
  /** Subscriber display name for personalized subscription retirements. */
  displayName?: string;
  /** Billing period (e.g. "2026-03") */
  period?: string;
  /** Source context: "mcp_tool" for direct retirements, "subscription" for scheduled */
  source?: "mcp_tool" | "subscription";
}

/**
 * Build a plain-language retirement reason string.
 *
 * Examples:
 *   "Monthly ecological contribution by Jane Doe via Regen Compute (2026-03)"
 *   "Regenerative contribution via Regen Compute"
 */
export function buildRetirementReason(options: RetirementReasonOptions = {}): string {
  if (options.note) {
    return options.period ? `${options.note} (${options.period})` : options.note;
  }

  let base: string;
  if (options.source === "subscription") {
    base = options.displayName
      ? `Monthly ecological contribution by ${options.displayName} via ${BRAND}`
      : `Monthly ecological contribution via ${BRAND}`;
  } else {
    base = `Regenerative contribution via ${BRAND}`;
  }

  return options.period ? `${base} (${options.period})` : base;
}

/**
 * Clean a retirement reason for display. Legacy retirements (pre Aug 2026)
 * carry JSON-LD in the reason field — extract the human `note` (+ period)
 * from those; pass every other reason through untouched.
 */
export function humanizeRetirementReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const trimmed = reason.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return reason;
  try {
    const parsed = JSON.parse(trimmed);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    if (obj && typeof obj === "object") {
      const note = typeof obj.note === "string" ? obj.note : null;
      const period = typeof obj.period === "string" ? obj.period : null;
      if (note) return period ? `${note} (${period})` : note;
      if (typeof obj.tool === "string") return `Retired via ${obj.tool}`;
    }
  } catch {
    // not JSON after all — fall through
  }
  return reason;
}
