// SPDX-License-Identifier: GPL-3.0-only

import validProduct from "@elqora/dgp-spec/fixtures/valid/product-definition.json" with { type: "json" };
import invalidComponent from "@elqora/dgp-spec/fixtures/invalid/product-definition-component-property.json" with { type: "json" };
import type { HandlerService, ProductDefinition } from "@elqora/dgp-spec";
import { describe, expect, it } from "vitest";

import {
  validateForPublication,
  validateProductDefinition,
  validateProductDefinitionSemantics,
} from "../src/index.js";

function definition(): ProductDefinition {
  return structuredClone(validProduct) as ProductDefinition;
}

function codes(input: unknown): string[] {
  return validateProductDefinition(input).diagnostics.map((item) => item.code);
}

function service(
  id: HandlerService["id"],
  capabilities: Record<string, boolean> = {},
): HandlerService {
  return {
    id,
    name: `Service ${String(id)}`,
    description: null,
    category: null,
    rate: null,
    min: 1,
    max: 10000,
    capabilities: Object.fromEntries(Object.entries(capabilities).map(([capabilityId, enabled]) => [
      capabilityId,
      { id: capabilityId, enabled, description: null, meta: {} },
    ])),
    meta: {},
    state: "enabled",
    state_reason: null,
  };
}

describe("structural validation", () => {
  it("accepts the ratified ProductDefinition fixture", () => {
    expect(validateProductDefinition(validProduct)).toEqual({ valid: true, diagnostics: [] });
  });

  it("maps schema failures to stable diagnostics and rejects the removed property", () => {
    const result = validateProductDefinition(invalidComponent);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "schema_unknown_property",
      path: "/fields/0/component",
      severity: "error",
    }));
  });

  it("validates expression declarations without executing their bodies", () => {
    const source = definition();
    source.fields[0]!.quantity = {
      value_by: "eval",
      expression: { language: "javascript", body: "throw new Error('must not run');" },
    };
    expect(validateProductDefinition(source).valid).toBe(true);
  });
});

describe("identity, graph, and relationship validation", () => {
  it("reports duplicate identities, unknown bindings, and filter cycles", () => {
    const source = definition();
    source.filters.push(
      { id: "tag:child", label: "Instagram", bind_id: "tag:instagram" },
      { id: "tag:cycle", label: "Cycle", bind_id: "tag:child" },
    );
    source.filters[1]!.bind_id = "tag:cycle";
    source.fields.push({
      id: source.fields[0]!.id,
      type: "text",
      label: "Duplicate",
      bind_id: "tag:missing",
      name: "quantity",
    });

    const resultCodes = codes(source);
    expect(resultCodes).toEqual(expect.arrayContaining([
      "duplicate_node_id",
      "duplicate_filter_label",
      "duplicate_field_name",
      "field_binding_unknown",
      "filter_cycle",
    ]));
  });

  it("validates recursive effect ownership, conflicts, and dependency cycles", () => {
    const source = definition();
    source.fields.push(
      { id: "field:a", type: "button", label: "A", bind_id: "tag:instagram", button: true },
      { id: "field:b", type: "button", label: "B", bind_id: "tag:instagram", button: true },
    );
    source.includes_for_buttons["field:a"] = ["field:b"];
    source.includes_for_buttons["field:b"] = ["field:a"];
    source.option_effects_for_buttons["option:premium"] = {
      "field:package": { include: ["option:rush"], exclude: ["option:rush", "option:missing"] },
    };
    source.value_effects_for_triggers["field:a"] = { "field:b": { value: "a" } };
    source.value_effects_for_triggers["field:b"] = {
      "field:a": { value: "b" },
      "field:notes": { value: "first" },
    };
    source.value_effects_for_triggers["option:rush"]!["field:notes"] = { value: "second" };

    const resultCodes = codes(source);
    expect(resultCodes).toEqual(expect.arrayContaining([
      "effect_option_unknown",
      "option_effect_conflict",
      "visibility_dependency_cycle",
      "value_effect_conflict",
      "value_effect_cycle",
    ]));
  });

  it("reports ignored descendant capability overrides", () => {
    const source = definition();
    source.filters.push({
      id: "tag:child",
      label: "Child",
      bind_id: "tag:instagram",
      capabilities: { refill: false },
    });
    expect(codes(source)).toContain("capability_override_ignored");
  });
});

describe("service, fallback, and utility validation", () => {
  it("checks service references and capability requirements only when a catalog is supplied", () => {
    const source = definition();
    const diagnostics = validateProductDefinitionSemantics(source, {
      services: [service(101, { refill: false, cancel: false })],
    });
    expect(diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "service_reference_unknown",
      "capability_requirement_unsatisfied",
      "fallback_candidate_unknown",
    ]));
  });

  it("detects duplicate, self-referential, and cyclic fallbacks", () => {
    const source = definition();
    source.fallbacks!.nodes!["option:premium"] = [102, 102];
    expect(codes(source)).toEqual(expect.arrayContaining([
      "fallback_duplicate_candidate",
      "fallback_self_reference",
      "fallback_cycle",
    ]));
  });

  it("separates advisory utilities from handler service selection and requires a base", () => {
    const source = definition();
    const rush = source.fields[1]!.options![1]!;
    rush.service_id = 999;
    expect(codes(source)).toContain("utility_service_conflict");

    delete rush.service_id;
    delete source.filters[0]!.service_id;
    delete source.fields[1]!.options![0]!.service_id;
    expect(codes(source)).toContain("utility_base_missing");
  });
});

describe("publication policy separation", () => {
  it("keeps host policy diagnostics outside the canonical result", () => {
    const result = validateForPublication(definition(), {
      policies: [{
        id: "host.requires-description",
        evaluate: () => [{
          code: "host_description_review",
          severity: "warning",
          path: "/description",
          message: "Host requires manual description review.",
        }],
      }],
    });
    expect(result.protocol).toEqual({ valid: true, diagnostics: [] });
    expect(result.policyDiagnostics[0]).toEqual(expect.objectContaining({
      code: "host_description_review",
      meta: { policy_id: "host.requires-description" },
    }));
    expect(result.publishable).toBe(true);
  });
});
