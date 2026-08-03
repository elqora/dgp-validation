// SPDX-License-Identifier: GPL-3.0-only

import type {
  HandlerService,
  ProductDefinition,
  ProductDefinitionValidationResult,
} from "@elqora/dgp-spec";
import { createProductIndex } from "@elqora/dgp-core";

import type { HostPublicationDiagnostic, HostPublicationPolicy } from "./policy.js";
import { validateProductDefinitionSemantics } from "./semantic.js";
import { validateProductDefinitionStructure } from "./structural.js";

export interface ProductDefinitionValidationOptions {
  services?: readonly HandlerService[];
}

export interface PublicationValidationOptions extends ProductDefinitionValidationOptions {
  policies?: readonly HostPublicationPolicy[];
}

export interface PublicationValidationResult {
  protocol: ProductDefinitionValidationResult;
  policyDiagnostics: HostPublicationDiagnostic[];
  publishable: boolean;
}

export function validateProductDefinition(
  input: unknown,
  options: ProductDefinitionValidationOptions = {},
): ProductDefinitionValidationResult {
  const structural = validateProductDefinitionStructure(input);
  if (structural.length > 0) return { valid: false, diagnostics: structural };

  const semantic = validateProductDefinitionSemantics(input as ProductDefinition, options);
  return {
    valid: !semantic.some((item) => item.severity === "error"),
    diagnostics: semantic,
  };
}

export function validateForPublication(
  input: unknown,
  options: PublicationValidationOptions = {},
): PublicationValidationResult {
  const protocol = validateProductDefinition(input, options);
  if (!protocol.valid) return { protocol, policyDiagnostics: [], publishable: false };

  const definition = input as ProductDefinition;
  const context = { definition, index: createProductIndex(definition) };
  const policyDiagnostics = (options.policies ?? []).flatMap((policy) =>
    policy.evaluate(context).map((item) => ({
      ...item,
      meta: { policy_id: policy.id, ...(item.meta ?? {}) },
    })));

  return {
    protocol,
    policyDiagnostics,
    publishable: !policyDiagnostics.some((item) => item.severity === "error"),
  };
}
