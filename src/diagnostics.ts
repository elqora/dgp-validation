// SPDX-License-Identifier: GPL-3.0-only

import type {
  DiagnosticSeverity,
  ProductDefinitionDiagnostic,
  ProductDefinitionDiagnosticCode,
} from "@elqora/dgp-spec";

export function diagnostic(
  code: ProductDefinitionDiagnosticCode,
  severity: DiagnosticSeverity,
  path: string,
  message: string,
  meta: ProductDefinitionDiagnostic["meta"] = {},
  relatedPaths: string[] = [],
): ProductDefinitionDiagnostic {
  return { code, severity, path, message, related_paths: relatedPaths, meta };
}

export function escapePointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function sortDiagnostics(
  diagnostics: readonly ProductDefinitionDiagnostic[],
): ProductDefinitionDiagnostic[] {
  const compare = (left: string, right: string): number => left === right ? 0 : left < right ? -1 : 1;
  return [...diagnostics].sort((left, right) =>
    compare(left.path, right.path)
    || compare(left.code, right.code)
    || compare(left.message, right.message),
  );
}
