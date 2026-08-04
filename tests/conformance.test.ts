// SPDX-License-Identifier: GPL-3.0-only

import suite from "@elqora/dgp-spec/fixtures/semantic/product-definition-validation.json" with { type: "json" };
import type { ProductDefinitionValidationConformanceSuite } from "@elqora/dgp-spec";
import { describe, expect, it } from "vitest";

import { validateProductDefinition } from "../src/index.js";

const cases = (suite as ProductDefinitionValidationConformanceSuite).cases;

describe("ratified product-definition semantic conformance suite", () => {
  for (const item of cases) {
    it(item.id, () => {
      const result = validateProductDefinition(item.definition, {
        services: item.context.services,
        field_registry: item.context.field_registry,
        rate_policy: item.context.rate_policy,
        fallback_policy: item.context.fallback_policy,
      });
      expect([...new Set(result.diagnostics.map(({ code }) => code))].sort()).toEqual(
        item.expected.diagnostic_codes,
      );
      expect(result.valid).toBe(item.expected.valid);
    });
  }
});
