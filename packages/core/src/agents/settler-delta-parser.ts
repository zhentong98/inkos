import { settlementSchemaIssues, sanitizeSettlementSchemaIssues } from "./settlement-schema-contract.js";
import {
  RuntimeStateDeltaSchema,
  type RuntimeStateDelta,
} from "../models/runtime-state.js";

export type SettlementFormatFailure = "missing_delta" | "invalid_json" | "invalid_schema";

/** Public diagnostics must never retain model values, parser messages or causes. */
export class SettlerDeltaParseError extends Error {
  readonly schemaIssues: readonly string[];

  constructor(readonly code: SettlementFormatFailure, schemaIssues: readonly string[] = []) {
    super(`Runtime state delta format failure: ${code}`);
    this.name = "SettlerDeltaParseError";
    this.schemaIssues = sanitizeSettlementSchemaIssues(schemaIssues);
  }
}

export interface SettlerDeltaOutput {
  readonly postSettlement: string;
  readonly runtimeStateDelta: RuntimeStateDelta;
}

function sanitizeJSON(str: string): string {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/,\s*([}\]])/g, "$1");
}

export function parseSettlerDeltaOutput(content: string): SettlerDeltaOutput {
  const extract = (tag: string): string => {
    const regex = new RegExp(
      `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
    );
    const match = content.match(regex);
    return match?.[1]?.trim() ?? "";
  };

  const rawDelta = extract("RUNTIME_STATE_DELTA");
  if (!rawDelta) {
    throw new SettlerDeltaParseError("missing_delta");
  }

  const jsonPayload = stripCodeFence(rawDelta);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizeJSON(jsonPayload));
  } catch {
    throw new SettlerDeltaParseError("invalid_json");
  }

  const result = RuntimeStateDeltaSchema.safeParse(parsed);
  if (!result.success) {
    throw new SettlerDeltaParseError("invalid_schema", settlementSchemaIssues(result.error.issues));
  }
  return {
    postSettlement: extract("POST_SETTLEMENT"),
    runtimeStateDelta: result.data,
  };
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}
