// SPDX-License-Identifier: GPL-3.0-only

import validProduct from "@elqora/dgp-spec/fixtures/valid/product-definition.json" with { type: "json" };
import type { HandlerService, ProductDefinition, ProductField } from "@elqora/dgp-spec";
import { describe, expect, it } from "vitest";

import { validateProductDefinition, validateProductDefinitionSemantics } from "../src/index.js";

function definition(): ProductDefinition {
  const source = structuredClone(validProduct) as ProductDefinition;
  source.fallbacks = null;
  return source;
}

function codes(source: ProductDefinition): string[] {
  return validateProductDefinition(source).diagnostics.map((item) => item.code);
}

function service(id: number, rate: number, capabilities = { refill: true, cancel: false }): HandlerService {
  return {
    id, name: `Service ${id}`, description: null, category: null, rate, min: 1, max: 1000,
    capabilities: Object.fromEntries(Object.entries(capabilities).map(([capabilityId, enabled]) => [
      capabilityId, { id: capabilityId, enabled, description: null, meta: {} },
    ])),
    meta: {}, state: "enabled", state_reason: null,
  };
}

function button(id: string, bindId = "tag:instagram"): ProductField {
  return { id, type: "button", label: id, bind_id: bindId, button: true };
}

describe("legacy graph and visibility parity", () => {
  it("does not reject harmless mutual revelation", () => {
    const source = definition();
    source.fields.push(button("field:a"), button("field:b"));
    source.includes_for_buttons["field:a"] = ["field:b"];
    source.includes_for_buttons["field:b"] = ["field:a"];
    expect(codes(source)).not.toContain("visibility_dependency_cycle");
  });

  it("validates combined reachable selections rather than only one trigger at a time", () => {
    const source = definition();
    source.fields.push(
      button("field:a"), button("field:b"),
      { id: "field:x", type: "text", label: "Conditional", name: "x" },
      { id: "field:y", type: "text", label: "Conditional", name: "y" },
    );
    source.includes_for_buttons["field:a"] = ["field:x"];
    source.includes_for_buttons["field:b"] = ["field:y"];
    expect(codes(source)).toContain("duplicate_visible_field_label");
  });

  it("detects reveal paths that invalidate an activating owner", () => {
    const source = definition();
    source.fields.push(button("field:a"), button("field:b"));
    source.includes_for_buttons["field:a"] = ["field:b"];
    source.excludes_for_buttons["field:b"] = ["field:a"];
    expect(codes(source)).toContain("visibility_dependency_cycle");
  });

  it("detects recursive-option narrowing that invalidates an activating option", () => {
    const source = definition();
    source.fields.push({
      id: "field:chooser", type: "select", label: "Chooser", bind_id: "tag:instagram",
      options: [{ id: "option:a", label: "A" }, { id: "option:b", label: "B" }],
    }, button("field:revealed"));
    source.includes_for_buttons["option:a"] = ["field:revealed"];
    source.option_effects_for_buttons["field:revealed"] = {
      "field:chooser": { include: ["option:b"] },
    };
    expect(codes(source)).toContain("visibility_dependency_cycle");
  });

  it("distinguishes real option activation cycles from plain string assignments", () => {
    const source = definition();
    source.fields.push(
      { id: "field:a", type: "select", label: "A", bind_id: "tag:instagram", options: [{ id: "option:a", label: "A" }] },
      { id: "field:b", type: "select", label: "B", bind_id: "tag:instagram", options: [{ id: "option:b", label: "B" }] },
    );
    source.value_effects_for_triggers["option:a"] = { "field:b": { value: "plain" } };
    source.value_effects_for_triggers["option:b"] = { "field:a": { value: "plain" } };
    expect(codes(source)).not.toContain("value_effect_cycle");
    source.value_effects_for_triggers["option:a"]["field:b"] = { value: "option:b" };
    source.value_effects_for_triggers["option:b"]["field:a"] = { value: "option:a" };
    expect(codes(source)).toContain("value_effect_cycle");
  });
});

describe("legacy field, input, and rule parity", () => {
  it("reports only labels that collide in a reachable context and finds unreachable fields", () => {
    const source = definition();
    source.filters.push({ id: "tag:other", label: "Other" });
    source.fields.push(
      { id: "field:duplicate", type: "text", label: "Notes", bind_id: "tag:other", name: "other" },
      { id: "field:lost", type: "text", label: "Lost", name: "lost" },
    );
    expect(codes(source)).toContain("field_unreachable");
    expect(codes(source)).not.toContain("duplicate_visible_field_label");
    source.fields[3]!.bind_id = "tag:instagram";
    expect(codes(source)).toContain("duplicate_visible_field_label");
  });

  it("preserves customer-input/service-selector separation and configured trigger fields", () => {
    const source = definition();
    source.fields[1]!.name = "package";
    source.fields.push(button("field:action"));
    source.includes_for_buttons["field:action"] = ["field:notes"];
    expect(codes(source)).toContain("customer_input_service_conflict");
    expect(codes(source)).not.toContain("service_selector_unconfigured");
    delete source.includes_for_buttons["field:action"];
    expect(codes(source)).toContain("service_selector_unconfigured");
  });

  it("checks registry variant fallback and multiple support", () => {
    const source = definition();
    source.fields[1]!.variant = "compact";
    source.fields[1]!.multiple = true;
    let result = validateProductDefinitionSemantics(source, {
      field_registry: [{ type: "select", variants: ["default"], multiple: false }],
    });
    expect(result.map((item) => item.code)).toContain("field_multiple_unsupported");
    expect(result.some((item) => item.code === "field_registry_entry_unknown"
      && item.meta?.field_id === "field:package")).toBe(false);
    result = validateProductDefinitionSemantics(source, {
      field_registry: [{ type: "number", variants: ["default"], multiple: false }],
    });
    expect(result.map((item) => item.code)).toContain("field_registry_entry_unknown");
  });

  it("checks every declared customer-validation operand shape without executing eval", () => {
    const source = definition();
    source.fields[2]!.validation = [
      { op: "eq" }, { op: "gt", value: "not-number" }, { op: "between", min: 4, max: 2 },
      { op: "nin", values: [] }, { op: "match", pattern: "[", pattern_flags: "z" },
      { op: "truthy", value_by: "eval", expression: { language: "javascript", body: "throw new Error('never');" } },
    ];
    expect(codes(source).filter((code) => code === "field_validation_rule_invalid")).toHaveLength(5);
  });

  it("reports contextual quantity-source conflicts", () => {
    const source = definition();
    source.fields[2]!.quantity_default = 2;
    expect(codes(source)).toContain("quantity_source_conflict");
  });
});

describe("legacy catalog, rate, fallback, and utility parity", () => {
  it("does not compare mutually exclusive single-select alternatives", () => {
    const source = definition();
    const diagnostics = validateProductDefinitionSemantics(source, {
      services: [service(101, 10), service(102, 100)], rate_policy: { kind: "eq_primary" },
    });
    expect(diagnostics.map((item) => item.code)).not.toContain("service_rate_incoherent");
  });

  it("does compare co-selectable multiple options and co-visible service fields", () => {
    const source = definition();
    source.fields[1]!.multiple = true;
    source.fields[1]!.options![1]!.service_id = 103;
    source.fields[1]!.options![1]!.pricing_role = "base";
    delete source.fields[1]!.options![1]!.utility;
    const diagnostics = validateProductDefinitionSemantics(source, {
      services: [service(101, 10), service(102, 10), service(103, 30)],
      rate_policy: { kind: "eq_primary" },
    });
    expect(diagnostics.map((item) => item.code)).toContain("service_rate_incoherent");
  });

  it("checks disabled services, quantity bounds, and false capability requirements", () => {
    const source = definition();
    const catalog = [service(101, 10), service(102, 10)];
    catalog[0]!.state = "disabled";
    catalog[0]!.min = 10;
    catalog[0]!.max = 1;
    catalog[0]!.capabilities.cancel!.enabled = true;
    const resultCodes = validateProductDefinitionSemantics(source, { services: catalog }).map((item) => item.code);
    expect(resultCodes).toEqual(expect.arrayContaining([
      "service_state_unavailable", "service_quantity_bounds_incoherent", "capability_requirement_unsatisfied",
    ]));
  });

  it("checks fallback capability and exact rate eligibility independently", () => {
    const source = definition();
    source.fallbacks = { nodes: { "option:premium": [103] } };
    const catalog = [service(101, 10), service(102, 10), service(103, 25, { refill: false, cancel: false })];
    const resultCodes = validateProductDefinitionSemantics(source, {
      services: catalog,
      fallback_policy: { require_capability_fit: true, rate_policy: { kind: "eq_primary" } },
    }).map((item) => item.code);
    expect(resultCodes).toEqual(expect.arrayContaining([
      "fallback_capability_ineligible", "fallback_rate_ineligible",
    ]));
  });

  it("requires a base only in contexts where advisory utilities are reachable", () => {
    const source = definition();
    source.filters.push({ id: "tag:base", label: "Base", service_id: 101 });
    source.fields[1]!.bind_id = "tag:instagram";
    delete source.filters[0]!.service_id;
    delete source.fields[1]!.options![0]!.service_id;
    expect(codes(source)).toContain("utility_base_missing");
    source.fields[1]!.bind_id = "tag:base";
    expect(codes(source)).not.toContain("utility_base_missing");
  });
});
