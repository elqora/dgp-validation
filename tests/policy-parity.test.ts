// SPDX-License-Identifier: GPL-3.0-only

import validProduct from "@elqora/dgp-spec/fixtures/valid/product-definition.json" with { type: "json" };
import type { HandlerService, ProductDefinition } from "@elqora/dgp-spec";
import { createProductIndex } from "@elqora/dgp-core";
import { describe, expect, it } from "vitest";

import {
  compileServicePublicationPolicies,
  createServicePublicationPolicies,
  splitServicePolicyDiagnostics,
  validateForPublication,
} from "../src/index.js";

function definition(): ProductDefinition {
  const source = structuredClone(validProduct) as ProductDefinition;
  source.fallbacks = null;
  return source;
}

function service(id: number, provider: string, enabled: boolean, kind: string): HandlerService {
  return {
    id, name: `Service ${id}`, description: null, category: null, rate: 10, min: 1, max: 1000,
    capabilities: {
      refill: { id: "refill", enabled: true, description: null, meta: {} },
      cancel: { id: "cancel", enabled: false, description: null, meta: {} },
    },
    meta: { provider, kind, policy_enabled: enabled }, state: "enabled", state_reason: null,
  };
}

describe("service publication policy migration parity", () => {
  it("compiles defaults, scalar allow-lists, where clauses, and configuration diagnostics", () => {
    const result = compileServicePublicationPolicies([
      { id: "defaults", label: "Defaults", op: "unique" },
      {
        id: "filtered", op: "max_count", value: 1,
        filter: {
          filter_id: "tag:instagram", field_id: "field:package",
          where: [
            { path: "service.provider", op: "eq", value: "one" },
            { path: "", op: "eq" },
            { path: "service.kind", op: "in", value: "wrong" },
          ],
        },
      },
      { id: "bad", op: "not-an-op" },
    ]);

    expect(result.policies[0]).toMatchObject({
      id: "defaults", scope: "visible_group", subject: "services",
      filter: { role: "both" }, projection: "service.id", severity: "error",
    });
    expect(result.policies[1]!.filter).toMatchObject({
      filter_id: ["tag:instagram"], field_id: ["field:package"],
    });
    expect(result.policies).toHaveLength(2);
    const split = splitServicePolicyDiagnostics(result.diagnostics);
    expect(split.errors).toContainEqual(expect.objectContaining({ ruleId: "bad", path: "op" }));
    expect(split.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "filtered", path: "label" }),
      expect.objectContaining({ ruleId: "filtered", path: "filter.where[1].path" }),
      expect.objectContaining({ ruleId: "filtered", path: "filter.where[2].value" }),
    ]));
  });

  it("preserves every compiler default, invalid enum fallback, projection, severity, and value diagnostic", () => {
    const result = compileServicePublicationPolicies([
      {
        id: "warnings", label: "Warnings", scope: "invalid", subject: "invalid",
        op: "all_true", value: 1, projection: "provider", severity: "invalid",
        filter: { role: "invalid", where: "invalid" },
      },
      { id: "missing-count", label: "Missing count", op: "min_count" },
    ]);
    expect(result.policies).toHaveLength(1);
    expect(result.policies[0]).toMatchObject({
      scope: "visible_group", subject: "services", severity: "error",
      filter: { role: "both" },
    });
    expect(result.diagnostics.filter((item) => item.ruleId === "warnings").map((item) => item.path))
      .toEqual(expect.arrayContaining([
        "scope", "subject", "projection", "severity", "filter.role", "filter.where", "value",
      ]));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      ruleId: "missing-count", severity: "error", path: "value",
    }));
  });

  it("preserves visible-group role, projection, operator, and severity behavior", () => {
    const source = definition();
    source.fields[1]!.options![1]!.service_id = 103;
    source.fields[1]!.options![1]!.pricing_role = "base";
    delete source.fields[1]!.options![1]!.utility;
    const services = [
      service(101, "one", true, "social"),
      service(102, "one", true, "social"),
      service(103, "two", false, "social"),
    ];
    const compiled = compileServicePublicationPolicies([
      {
        id: "provider", label: "One provider", scope: "visible_group", op: "no_mix",
        projection: "service.provider", filter: { role: "base" }, severity: "warning",
      },
      {
        id: "capability", label: "All enabled", scope: "visible_group", op: "all_true",
        projection: "service.policy_enabled", filter: { role: "base" },
      },
      {
        id: "kind", label: "One kind", scope: "visible_group", op: "all_equal",
        projection: "service.kind", filter: { where: [{ path: "service.provider", op: "exists" }] },
      },
    ]);
    const result = validateForPublication(source, {
      services,
      policies: createServicePublicationPolicies(compiled.policies),
    });

    expect(result.protocol.valid, JSON.stringify(result.protocol.diagnostics)).toBe(true);
    expect(result.policyDiagnostics.map((item) => item.meta?.policy_id)).toEqual([
      "provider", "capability",
    ]);
    expect(result.policyDiagnostics[0]).toMatchObject({
      code: "host_service_policy_violation", severity: "warning", path: "/filters/0",
    });
    expect(result.publishable).toBe(false);
  });

  it("preserves global uniqueness and count behavior, including fallback services", () => {
    const source = definition();
    source.fallbacks = { global: { "101": [104] } };
    const services = [
      service(101, "one", true, "alpha"),
      service(102, "one", true, "alpha"),
      service(104, "three", true, "beta"),
    ];
    services[2]!.meta.key = "duplicate";
    services[0]!.meta.key = "duplicate";
    const { policies } = compileServicePublicationPolicies([
      { id: "keys", label: "Unique keys", scope: "global", op: "unique", projection: "service.key" },
      { id: "count", label: "Two max", scope: "global", op: "max_count", value: 2 },
      { id: "any", label: "Any refill", scope: "global", op: "any_true", projection: "service.capabilities.refill.enabled" },
      { id: "min", label: "At least three", scope: "global", op: "min_count", value: 3 },
    ]);
    const result = validateForPublication(source, {
      services,
      policies: createServicePublicationPolicies(policies),
    });
    expect(result.policyDiagnostics.map((item) => item.meta?.policy_id)).toEqual(["keys", "count"]);
    expect(result.policyDiagnostics[0]!.meta?.affected_ids).toEqual(expect.arrayContaining(["104"]));
  });

  it("reports a missing catalog as a host-policy configuration failure", () => {
    const { policies } = compileServicePublicationPolicies([
      { id: "catalog", label: "Catalog", scope: "global", op: "max_count", value: 1 },
    ]);
    const result = validateForPublication(definition(), { policies: createServicePublicationPolicies(policies) });
    expect(result.policyDiagnostics).toContainEqual(expect.objectContaining({
      code: "host_policy_service_catalog_missing", severity: "error",
    }));
  });

  it("evaluates global filter allow-lists as the union of selected visible groups", () => {
    const source = definition();
    source.filters.push({ id: "tag:other", label: "Other", service_id: 103 });
    const services = [service(101, "one", true, "alpha"), service(102, "one", true, "alpha"), service(103, "two", true, "beta")];
    const { policies } = compileServicePublicationPolicies([{
      id: "selected-group", label: "Selected group", scope: "global", op: "all_equal",
      projection: "service.kind", filter: { filter_id: "tag:instagram" },
    }]);
    const selected = validateForPublication(source, { services, policies: createServicePublicationPolicies(policies) });
    expect(selected.policyDiagnostics).toEqual([]);

    const all = compileServicePublicationPolicies([{
      id: "all-groups", label: "All groups", scope: "global", op: "all_equal", projection: "service.kind",
    }]);
    expect(validateForPublication(source, {
      services, policies: createServicePublicationPolicies(all.policies),
    }).policyDiagnostics).toContainEqual(expect.objectContaining({ code: "host_service_policy_violation" }));
  });

  it("includes every global fallback primary and candidate in global policies", () => {
    const source = definition();
    source.fallbacks = { global: { "999": [104] } };
    const services = [service(101, "one", true, "alpha"), service(102, "one", true, "alpha"), service(104, "two", true, "beta")];
    const { policies } = compileServicePublicationPolicies([{
      id: "fallback-count", label: "Fallback count", scope: "global", op: "max_count", value: 3,
    }]);
    const diagnostics = createServicePublicationPolicies(policies)[0]!.evaluate({
      definition: source, index: createProductIndex(source), services,
    });
    expect(diagnostics[0]).toMatchObject({ code: "host_service_policy_violation" });
    expect(diagnostics[0]?.meta?.count).toBe(4);
  });

  it("keeps unknown service references in policy counts even when where clauses are present", () => {
    const source = definition();
    source.fallbacks = { global: { "101": [999] } };
    const services = [service(101, "one", true, "alpha"), service(102, "one", true, "alpha")];
    const { policies } = compileServicePublicationPolicies([{
      id: "unknown", label: "Unknown included", scope: "global", op: "max_count", value: 2,
      filter: { where: [{ path: "service.kind", op: "eq", value: "alpha" }] },
    }]);
    const protocol = validateForPublication(source, { services });
    expect(protocol.protocol.valid).toBe(false);
    const policy = createServicePublicationPolicies(policies)[0]!;
    const diagnostics = policy.evaluate({
      definition: source,
      index: createProductIndex(source),
      services,
    });
    expect(diagnostics[0]).toMatchObject({ code: "host_service_policy_violation" });
    expect(diagnostics[0]?.meta?.count).toBe(3);
  });

  it("applies global count operators to empty collections while visible groups remain skipped", () => {
    const source = definition();
    delete source.filters[0]!.service_id;
    delete source.fields[1]!.options![0]!.service_id;
    source.fallbacks = null;
    const { policies } = compileServicePublicationPolicies([
      { id: "global-min", label: "Global min", scope: "global", op: "min_count", value: 1 },
      { id: "group-min", label: "Group min", scope: "visible_group", op: "min_count", value: 1 },
    ]);
    const adapted = createServicePublicationPolicies(policies);
    const context = { definition: source, index: createProductIndex(source), services: [] };
    const globalDiagnostics = adapted[0]!.evaluate(context);
    expect(globalDiagnostics[0]).toMatchObject({ code: "host_service_policy_violation" });
    expect(globalDiagnostics[0]?.meta?.count).toBe(0);
    expect(adapted[1]!.evaluate(context)).toEqual([]);
  });

  it("evaluates every where-clause operator against canonical service snapshots", () => {
    const source = definition();
    const services = [
      service(101, "one", true, "alpha"),
      service(102, "two", false, "beta"),
    ];
    const cases = [
      { op: "eq", path: "service.provider", value: "one", count: 1 },
      { op: "neq", path: "service.provider", value: "one", count: 1 },
      { op: "in", path: "service.provider", value: ["one"], count: 1 },
      { op: "nin", path: "service.provider", value: ["one"], count: 1 },
      { op: "exists", path: "service.kind", count: 2 },
      { op: "truthy", path: "service.policy_enabled", count: 1 },
      { op: "falsy", path: "service.policy_enabled", count: 1 },
    ] as const;
    for (const item of cases) {
      const { policies } = compileServicePublicationPolicies([{
        id: `where-${item.op}`, label: item.op, scope: "global", op: "max_count", value: 0,
        filter: { where: [{ path: item.path, op: item.op, ...("value" in item ? { value: item.value } : {}) }] },
      }]);
      const diagnostics = createServicePublicationPolicies(policies)[0]!.evaluate({
        definition: source, index: createProductIndex(source), services,
      });
      expect(diagnostics[0]?.meta?.count, item.op).toBe(item.count);
    }
  });

  it("collects node fallbacks in visible groups with the primary service role", () => {
    const source = definition();
    source.fallbacks = { nodes: { "option:premium": [104] } };
    const services = [
      service(101, "one", true, "alpha"),
      service(102, "one", true, "alpha"),
      service(104, "two", true, "beta"),
    ];
    const { policies } = compileServicePublicationPolicies([{
      id: "node-fallback", label: "Node fallback", scope: "visible_group",
      op: "max_count", value: 2, filter: { role: "base" },
    }]);
    const diagnostics = createServicePublicationPolicies(policies)[0]!.evaluate({
      definition: source, index: createProductIndex(source), services,
    });
    expect(diagnostics[0]).toMatchObject({ code: "host_service_policy_violation" });
    expect(diagnostics[0]?.meta?.count).toBe(3);
    expect(diagnostics[0]?.meta?.affected_ids).toEqual(expect.arrayContaining(["104"]));
  });
});
