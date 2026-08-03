// SPDX-License-Identifier: GPL-3.0-only

import type { DiagnosticSeverity, ProductDefinition } from "@elqora/dgp-spec";
import type { ProductIndex } from "@elqora/dgp-core";

export interface HostPublicationDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  path: string;
  message: string;
  relatedPaths?: string[];
  meta?: Record<string, unknown>;
}

export interface HostPublicationPolicyContext {
  definition: ProductDefinition;
  index: ProductIndex;
}

export interface HostPublicationPolicy {
  id: string;
  evaluate(context: HostPublicationPolicyContext): readonly HostPublicationDiagnostic[];
}
