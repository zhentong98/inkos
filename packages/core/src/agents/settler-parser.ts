import type { GenreProfile } from "../models/genre-profile.js";

export interface SettlementOutput {
  readonly postSettlement: string;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly chapterSummary: string;
  readonly updatedSubplots: string;
  readonly updatedEmotionalArcs: string;
  readonly updatedCharacterMatrix: string;
}

export function parseSettlementOutput(
  content: string,
  genreProfile: GenreProfile,
): SettlementOutput {
  const extract = (tag: string): string => {
    const regex = new RegExp(
      `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
    );
    const match = content.match(regex);
    return match?.[1]?.trim() ?? "";
  };

  return {
    postSettlement: extract("POST_SETTLEMENT"),
    updatedState: extract("UPDATED_STATE") || "(状态卡未更新)",
    updatedLedger: genreProfile.numericalSystem
      ? (extract("UPDATED_LEDGER") || "(账本未更新)")
      : "",
    updatedHooks: extract("UPDATED_HOOKS") || "(伏笔池未更新)",
    chapterSummary: extract("CHAPTER_SUMMARY"),
    updatedSubplots: extract("UPDATED_SUBPLOTS"),
    updatedEmotionalArcs: extract("UPDATED_EMOTIONAL_ARCS"),
    updatedCharacterMatrix: extract("UPDATED_CHARACTER_MATRIX"),
  };
}

/** A legacy projection must actually contain both core truth payloads. Tags
 * containing the parser's missing-output sentinels are not usable truth. An
 * explicit empty hook table / "none" remains valid legacy output.
 */
export function hasUsableLegacySettlement(settlement: SettlementOutput): boolean {
  const usable = (value: string) => {
    const normalized = value.trim().replace(/^[（(]|[）)]$/g, "").trim();
    return normalized.length > 0
      && !/^(?:状态卡未更新|伏笔池未更新|文件尚未创建|state(?: card)? (?:not updated|unchanged)|hooks?(?: pool)? (?:not updated|unchanged))$/i.test(normalized);
  };
  return usable(settlement.updatedState) && usable(settlement.updatedHooks);
}
