// SPDX-License-Identifier: GPL-3.0-only

import validProduct from "@elqora/dgp-spec/fixtures/valid/product-definition.json" with { type: "json" };
import type { HandlerService, ProductDefinition, ProductField, ServiceId, ServiceRatePolicy } from "@elqora/dgp-spec";
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

function service(id: ServiceId, rate: number, capabilities = { refill: true, cancel: false }): HandlerService {
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

  it("detects invalidation through an owner-field exclusion and nested child option", () => {
    const owner = definition();
    owner.fields.push({
      id: "field:package-two", type: "select", label: "Package two", bind_id: "tag:instagram",
      options: [{ id: "option:revealer", label: "Revealer" }],
    }, {
      id: "field:advanced", type: "select", label: "Advanced", name: "advanced",
      options: [{ id: "option:hide-owner", label: "Hide owner" }],
    });
    owner.option_effects_for_buttons["option:revealer"] = {
      "field:advanced": { force_visible: true },
    };
    owner.excludes_for_buttons["option:hide-owner"] = ["field:package-two"];
    expect(codes(owner)).toContain("visibility_dependency_cycle");

    const nested = definition();
    nested.fields.push({
      id: "field:nested-owner", type: "select", label: "Nested owner", bind_id: "tag:instagram",
      options: [{
        id: "option:parent", label: "Parent",
        children: [{ id: "option:child", label: "Child" }],
      }],
    }, {
      id: "field:nested-target", type: "select", label: "Nested target", name: "nested_target",
      options: [{ id: "option:remove-child", label: "Remove child" }],
    });
    nested.option_effects_for_buttons["option:child"] = {
      "field:nested-target": { force_visible: true },
    };
    nested.option_effects_for_buttons["option:remove-child"] = {
      "field:nested-owner": { exclude: ["option:child"] },
    };
    expect(codes(nested)).toContain("visibility_dependency_cycle");
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

  it("accepts filter, button, and recursive-option value triggers in their actual context", () => {
    const source = definition();
    source.fields.push(button("field:value-button"));
    source.value_effects_for_triggers["tag:instagram"] = { "field:notes": { value: "filter" } };
    source.value_effects_for_triggers["field:value-button"] = { "field:notes": { value: "button" } };
    source.value_effects_for_triggers["option:premium"] = { "field:notes": { value: "option" } };
    const resultCodes = codes(source);
    expect(resultCodes).not.toContain("trigger_unknown");
    expect(resultCodes).not.toContain("effect_target_unreachable");
  });

  it("reports every invalid value-effect trigger, target, value, cardinality, and context family", () => {
    const source = definition();
    source.filters.push({ id: "tag:other", label: "Other" });
    source.fields.push({
      id: "field:hidden", type: "text", label: "Hidden", bind_id: "tag:other", name: "hidden",
    });
    source.value_effects_for_triggers.ghost = {
      "field:missing": { value: "x" },
      "field:package": { value: "option:missing" },
    };
    source.value_effects_for_triggers["option:premium"] = {
      "field:package": { value: ["option:premium", "option:rush"] },
      "field:hidden": { value: "x" },
    };
    expect(codes(source)).toEqual(expect.arrayContaining([
      "trigger_unknown",
      "effect_target_unknown",
      "value_effect_value_invalid",
      "value_effect_cardinality_mismatch",
      "effect_target_unreachable",
    ]));
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

  it("requires nameless option selectors to actually select a service", () => {
    const source = definition();
    delete source.fields[1]!.options![0]!.service_id;
    expect(codes(source)).toContain("service_selector_unconfigured");
  });

  it("rejects the same trigger key in inclusion and exclusion maps even when targets differ", () => {
    const source = definition();
    source.excludes_for_buttons["option:rush"] = ["field:quantity"];
    expect(codes(source)).toContain("relationship_conflict");
  });

  it("treats duplicate filter labels as publication errors", () => {
    const source = definition();
    source.filters.push({ id: "tag:duplicate", label: "Instagram" });
    const diagnostic = validateProductDefinition(source).diagnostics.find(
      (item) => item.code === "duplicate_filter_label",
    );
    expect(diagnostic?.severity).toBe("error");

    source.filters[1]!.label = "instagram";
    expect(codes(source)).not.toContain("duplicate_filter_label");
  });

  it("checks registry variant fallback and multiple support", () => {
    const source = definition();
    source.fields[1]!.variant = "compact";
    source.fields[1]!.multiple = true;
    let result = validateProductDefinitionSemantics(source, {
      field_registry: [{ type: "select", variant: "default", options: true, recursive_options: true, multiple: false }],
    });
    expect(result.map((item) => item.code)).toContain("field_multiple_unsupported");
    expect(result.some((item) => item.code === "field_registry_entry_unknown"
      && item.meta?.field_id === "field:package")).toBe(false);
    result = validateProductDefinitionSemantics(source, {
      field_registry: [{ type: "number", variant: "default", options: false, recursive_options: false, multiple: false }],
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

  it("excludes utility service references from base-rate coherence", () => {
    const source = definition();
    source.fields[1]!.options![1]!.service_id = 103;
    const diagnostics = validateProductDefinitionSemantics(source, {
      services: [service(101, 10), service(102, 10), service(103, 1000)],
      rate_policy: { kind: "eq_primary" },
    });
    expect(diagnostics.map((item) => item.code)).not.toContain("service_rate_incoherent");
    expect(diagnostics.map((item) => item.code)).toContain("utility_service_conflict");
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

    const buttons = definition();
    buttons.fields.push(
      { id: "field:left", type: "button", label: "Left", bind_id: "tag:instagram", button: true, service_id: 103 },
      { id: "field:right", type: "button", label: "Right", bind_id: "tag:instagram", button: true, service_id: 104 },
    );
    const buttonDiagnostics = validateProductDefinitionSemantics(buttons, {
      services: [service(101, 10), service(102, 10), service(103, 10), service(104, 30)],
      rate_policy: { kind: "eq_primary" },
    });
    expect(buttonDiagnostics.map((item) => item.code)).toContain("service_rate_incoherent");
  });

  it("does not enumerate the power set of inert multiple-selection options", () => {
    const source = definition();
    source.fields[1]!.multiple = true;
    source.fields[1]!.options = Array.from({ length: 40 }, (_, index) => ({
      id: `option:inert-${index}`,
      label: `Inert ${index}`,
      service_id: index + 1000,
      pricing_role: "base" as const,
    }));
    source.includes_for_buttons = {};
    source.option_effects_for_buttons = {};
    source.value_effects_for_triggers = {};
    const catalog = [service(101, 10), ...source.fields[1]!.options.map(
      (option) => service(Number(option.service_id), 10),
    )];
    expect(validateProductDefinitionSemantics(source, {
      services: catalog,
      rate_policy: { kind: "eq_primary" },
    }).map((item) => item.code)).not.toContain("service_rate_incoherent");
  });

  it("fails explicitly instead of silently truncating an excessive effect-bearing state space", () => {
    const source = definition();
    for (let index = 0; index < 13; index += 1) {
      const id = `field:effect-${index}`;
      source.fields.push(button(id));
      source.includes_for_buttons[id] = [];
    }
    expect(codes(source)).toContain("validation_context_limit_exceeded");
  });

  it("suppresses mutually exclusive rate conflicts but retains other coexisting conflicts", () => {
    const source = definition();
    delete source.fields[1]!.options![0]!.service_id;
    source.fields.push(
      { id: "field:b", type: "button", label: "B", bind_id: "tag:instagram", button: true, service_id: 103 },
      { id: "field:c", type: "button", label: "C", bind_id: "tag:instagram", button: true, service_id: 104 },
    );
    source.excludes_for_buttons["field:b"] = ["field:c"];
    source.excludes_for_buttons["field:c"] = ["field:b"];
    const options = {
      services: [service(101, 10), service(102, 10), service(103, 30), service(104, 5)],
      rate_policy: { kind: "eq_primary" } as const,
    };
    expect(validateProductDefinitionSemantics(source, options).map((item) => item.code))
      .not.toContain("service_rate_incoherent");

    source.fields.push({
      id: "field:e", type: "button", label: "E", bind_id: "tag:instagram", button: true, service_id: 105,
    });
    options.services.push(service(105, 15));
    expect(validateProductDefinitionSemantics(source, options).map((item) => item.code))
      .toContain("service_rate_incoherent");
  });

  it("applies every ratified rate-policy boundary against the highest co-selectable primary", () => {
    const source = definition();
    delete source.fields[1]!.options![0]!.service_id;
    source.fields.push(
      { id: "field:primary", type: "button", label: "Primary", bind_id: "tag:instagram", button: true, service_id: 201 },
      { id: "field:candidate", type: "button", label: "Candidate", bind_id: "tag:instagram", button: true, service_id: 202 },
    );
    const run = (candidateRate: number, rate_policy: ServiceRatePolicy) =>
      validateProductDefinitionSemantics(source, {
        services: [service(101, 10), service(201, 100), service(202, candidateRate)], rate_policy,
      }).map((item) => item.code);

    expect(run(100, { kind: "eq_primary" })).not.toContain("service_rate_incoherent");
    expect(run(99.99, { kind: "eq_primary" })).toContain("service_rate_incoherent");
    expect(run(95, { kind: "lte_primary", pct: 5 })).not.toContain("service_rate_incoherent");
    expect(run(94.99, { kind: "lte_primary", pct: 5 })).toContain("service_rate_incoherent");
    expect(run(1, { kind: "within_pct", pct: 5 })).not.toContain("service_rate_incoherent");
    expect(run(90, { kind: "at_least_pct_lower", pct: 10 })).not.toContain("service_rate_incoherent");
    expect(run(90.01, { kind: "at_least_pct_lower", pct: 10 })).toContain("service_rate_incoherent");
  });

  it("preserves string service identities and affected node/service metadata in rate diagnostics", () => {
    const source = definition();
    delete source.fields[1]!.options![0]!.service_id;
    source.fields.push(
      { id: "field:string-a", type: "button", label: "String A", bind_id: "tag:instagram", button: true, service_id: "svc-a" },
      { id: "field:string-b", type: "button", label: "String B", bind_id: "tag:instagram", button: true, service_id: "svc-b" },
    );
    const diagnostic = validateProductDefinitionSemantics(source, {
      services: [service(101, 10), service("svc-a", 100), service("svc-b", 80)],
      rate_policy: { kind: "eq_primary" },
    }).find((item) => item.code === "service_rate_incoherent");
    expect(diagnostic?.meta.service_ids).toEqual(expect.arrayContaining(["svc-a", "svc-b"]));
    expect(diagnostic?.meta.node_ids).toEqual(expect.arrayContaining(["field:string-a", "field:string-b"]));
    expect(diagnostic?.related_paths.length).toBeGreaterThan(0);
  });

  it("finds rate conflicts introduced only in a deeper revealed context", () => {
    const source = definition();
    delete source.fields[1]!.options![0]!.service_id;
    source.fields.push(
      button("field:reveal-services"),
      { id: "field:deep-a", type: "button", label: "Deep A", button: true, service_id: 201 },
      { id: "field:deep-b", type: "button", label: "Deep B", button: true, service_id: 202 },
    );
    source.includes_for_buttons["field:reveal-services"] = ["field:deep-a", "field:deep-b"];
    const diagnostics = validateProductDefinitionSemantics(source, {
      services: [service(101, 10), service(201, 100), service(202, 80)],
      rate_policy: { kind: "lte_primary", pct: 5 },
    });
    const diagnostic = diagnostics.find((item) => item.code === "service_rate_incoherent");
    expect(diagnostic?.meta.trigger_ids).toEqual(expect.arrayContaining([
      "field:reveal-services", "field:deep-a", "field:deep-b",
    ]));
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

  it("checks capability requirements for service options reached only through relationships", () => {
    const source = definition();
    source.filters[0]!.includes = ["field:relationship-service"];
    source.fields.push({
      id: "field:relationship-service", type: "select", label: "Relationship service",
      options: [{ id: "option:relationship-service", label: "Relationship service", service_id: 103 }],
    });
    const resultCodes = validateProductDefinitionSemantics(source, {
      services: [
        service(101, 10), service(102, 10),
        service(103, 10, { refill: false, cancel: false }),
      ],
    }).map((item) => item.code);
    expect(resultCodes).toContain("capability_requirement_unsatisfied");
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

  it("accepts eligible fallbacks and reports availability plus canonical string-identity duplicates", () => {
    const source = definition();
    source.fallbacks = { nodes: { "option:premium": [103, "103", 104] } };
    const unavailable = service(104, 10);
    unavailable.state = "locked";
    const diagnostics = validateProductDefinitionSemantics(source, {
      services: [service(101, 10), service(102, 10), service(103, 10), unavailable],
      fallback_policy: { require_capability_fit: true, rate_policy: { kind: "eq_primary" } },
    });
    const duplicate = diagnostics.find((item) => item.code === "fallback_duplicate_candidate");
    expect(duplicate).toMatchObject({ severity: "warning" });
    expect(duplicate?.meta.candidate_service_id).toBe("103");
    const unavailableDiagnostic = diagnostics.find((item) => item.code === "service_state_unavailable");
    expect(unavailableDiagnostic?.meta.candidate_service_id).toBe(104);
    expect(diagnostics.filter((item) => item.code === "fallback_capability_ineligible"
      || item.code === "fallback_rate_ineligible")).toEqual([]);
  });

  it("derives service and fallback capability contexts from relationship reachability", () => {
    const source = definition();
    source.filters[0]!.includes = ["field:related"];
    source.fields.push({
      id: "field:related", type: "select", label: "Related",
      options: [{ id: "option:related", label: "Related", service_id: 103 }],
    });
    source.fallbacks = { nodes: { "option:related": [104] } };
    const resultCodes = validateProductDefinitionSemantics(source, {
      services: [
        service(101, 10), service(102, 10),
        service(103, 10, { refill: true, cancel: false }),
        service(104, 10, { refill: false, cancel: false }),
      ],
      fallback_policy: { require_capability_fit: true, rate_policy: { kind: "eq_primary" } },
    }).map((item) => item.code);
    expect(resultCodes).not.toContain("fallback_context_unresolved");
    expect(resultCodes).toContain("fallback_capability_ineligible");
  });

  it("accepts a multi-context fallback when at least one filter capability context fits", () => {
    const source = definition();
    source.filters.push({ id: "tag:other", label: "Other", capabilities: { cancel: true } });
    source.fields[1]!.bind_id = ["tag:instagram", "tag:other"];
    source.fallbacks = { nodes: { "option:premium": [103] } };
    const candidate = service(103, 10, { refill: false, cancel: true });
    const resultCodes = validateProductDefinitionSemantics(source, {
      services: [service(101, 10), service(102, 10), candidate],
      fallback_policy: { require_capability_fit: true, rate_policy: { kind: "eq_primary" } },
    }).map((item) => item.code);
    expect(resultCodes).not.toContain("fallback_context_unresolved");
    expect(resultCodes).not.toContain("fallback_capability_ineligible");
  });

  it("checks global fallback capability, rate, and availability against every use context", () => {
    const source = definition();
    source.fallbacks = { global: { "101": [103, 104] } };
    const unavailable = service(104, 10);
    unavailable.state = "disabled";
    const resultCodes = validateProductDefinitionSemantics(source, {
      services: [
        service(101, 10), service(102, 10),
        service(103, 25, { refill: false, cancel: false }), unavailable,
      ],
      fallback_policy: { require_capability_fit: true, rate_policy: { kind: "eq_primary" } },
    }).map((item) => item.code);
    expect(resultCodes).toEqual(expect.arrayContaining([
      "fallback_capability_ineligible", "fallback_rate_ineligible", "service_state_unavailable",
    ]));
  });

  it("inherits utility pricing role from a field for service conflicts and base selection", () => {
    const source = definition();
    source.fields[1]!.pricing_role = "utility";
    source.fields[1]!.utility = { rate: 1, mode: "flat" };
    delete source.fields[1]!.options![0]!.pricing_role;
    const resultCodes = codes(source);
    expect(resultCodes).toContain("utility_service_conflict");
  });

  it("covers field and option utility declarations across every canonical mode", () => {
    const missing = definition();
    missing.fields.push({
      id: "field:missing-utility", type: "text", label: "Missing utility", bind_id: "tag:instagram",
      name: "missing_utility", pricing_role: "utility",
    });
    missing.fields[1]!.pricing_role = "utility";
    delete missing.fields[1]!.options![1]!.utility;
    expect(codes(missing).filter((code) => code === "utility_definition_missing").length).toBeGreaterThanOrEqual(2);

    const valid = definition();
    valid.fields.push(
      {
        id: "field:flat", type: "text", label: "Flat", bind_id: "tag:instagram", name: "flat",
        pricing_role: "utility", utility: { rate: 1, mode: "flat" },
      },
      {
        id: "field:quantity-utility", type: "text", label: "Per quantity", bind_id: "tag:instagram", name: "per_quantity",
        pricing_role: "utility", utility: { rate: 1, mode: "per_quantity" },
      },
      {
        id: "field:value-utility", type: "text", label: "Per value", bind_id: "tag:instagram", name: "per_value",
        pricing_role: "utility", utility: { rate: 1, mode: "per_value", value_by: "length" },
      },
      {
        id: "field:percent", type: "text", label: "Percent", bind_id: "tag:instagram", name: "percent",
        pricing_role: "utility", utility: { rate: 5, mode: "percent", percent_base: "all" },
      },
    );
    expect(codes(valid)).not.toContain("utility_definition_missing");
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

  it("evaluates utility completeness after option effects narrow the reachable options", () => {
    const source = definition();
    delete source.filters[0]!.service_id;
    source.fields.push(button("field:narrow"));
    source.option_effects_for_buttons["field:narrow"] = {
      "field:package": { exclude: ["option:premium"] },
    };
    expect(codes(source)).toContain("utility_base_missing");

    source.option_effects_for_buttons["field:narrow"] = {
      "field:package": { exclude: ["option:rush"] },
    };
    expect(codes(source)).not.toContain("utility_base_missing");
  });
});
