// SPDX-License-Identifier: GPL-3.0-only

import validProduct from "@elqora/dgp-spec/fixtures/valid/product-definition.json" with { type: "json" };
import type { HandlerService, ProductDefinition } from "@elqora/dgp-spec";
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
          tag_id: "tag:instagram", field_id: "field:package",
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
});
