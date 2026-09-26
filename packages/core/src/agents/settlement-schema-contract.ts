import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodIssue } from "zod";
import { RuntimeStateDeltaSchema } from "../models/runtime-state.js";

// One source for the parser's input contract and schema-owned diagnostic paths.
export const settlementInputSchema = zodToJsonSchema(RuntimeStateDeltaSchema, {
  $refStrategy: "none",
  target: "jsonSchema7",
});

type SchemaNode = { properties?: Record<string, SchemaNode>; items?: SchemaNode };
const paths = new Set<string>();
function collectPaths(node: SchemaNode, path: string): void {
  paths.add(path || "$root");
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    collectPaths(child, path ? `${path}.${key}` : key);
  }
  if (node.items) collectPaths(node.items, `${path}.*`);
  // Dynamic record keys and arbitrary additionalProperties never become paths.
}
collectPaths(settlementInputSchema as SchemaNode, "");
const codes = new Set(["invalid_type", "invalid_literal", "invalid_enum_value", "too_small", "too_big", "not_multiple_of", "not_finite"]);

/** Recheck at public feedback boundaries as callers need not be well typed. */
export function sanitizeSettlementSchemaIssues(issues: unknown): string[] {
  if (!Array.isArray(issues)) return [];
  return [...new Set(issues.filter((issue): issue is string => {
    if (typeof issue !== "string") return false;
    const [path, code, extra] = issue.split(": ");
    return extra === undefined && paths.has(path ?? "") && codes.has(code ?? "");
  }))].slice(0, 12);
}

export function settlementSchemaIssues(issues: readonly ZodIssue[]): string[] {
  return sanitizeSettlementSchemaIssues(issues.map((issue) => {
    const path = issue.path.map((part) => typeof part === "number" ? "*" : part).join(".") || "$root";
    return `${path}: ${issue.code}`;
  }));
}
