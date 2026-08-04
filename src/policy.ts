// SPDX-License-Identifier: GPL-3.0-only

import type {
  DiagnosticSeverity,
  HandlerService,
  ProductDefinition,
  ProductField,
  ServiceId,
} from "@elqora/dgp-spec";
import {
  findService,
  resolveVisibilityWithIndex,
  serviceBindingForNode,
  walkFieldOptions,
  type ProductIndex,
} from "@elqora/dgp-core";

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
  services?: readonly HandlerService[];
}

export interface HostPublicationPolicy {
  id: string;
  evaluate(context: HostPublicationPolicyContext): readonly HostPublicationDiagnostic[];
}

export type ServicePolicyScope = "global" | "visible_group";
export type ServicePolicyRole = "base" | "utility" | "both";
export type ServicePolicyOperator =
  | "all_equal"
  | "no_mix"
  | "unique"
  | "all_true"
  | "any_true"
  | "max_count"
  | "min_count";
export type ServicePolicyWhereOperator = "eq" | "neq" | "in" | "nin" | "exists" | "truthy" | "falsy";

export interface ServicePolicyWhereClause {
  path: string;
  op?: ServicePolicyWhereOperator;
  value?: unknown;
}

export interface ServicePublicationPolicyRule {
  id: string;
  label: string;
  scope: ServicePolicyScope;
  subject: "services";
  filter: {
    role: ServicePolicyRole;
    filter_id?: string[];
    field_id?: string[];
    where?: ServicePolicyWhereClause[];
  };
  projection: string;
  op: ServicePolicyOperator;
  value?: number;
  severity: "error" | "warning";
  message?: string;
}

export interface ServicePolicyConfigurationDiagnostic {
  ruleIndex: number;
  ruleId?: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
}

const scopes = new Set<ServicePolicyScope>(["global", "visible_group"]);
const roles = new Set<ServicePolicyRole>(["base", "utility", "both"]);
const operators = new Set<ServicePolicyOperator>([
  "all_equal", "no_mix", "unique", "all_true", "any_true", "max_count", "min_count",
]);
const whereOperators = new Set<ServicePolicyWhereOperator>([
  "eq", "neq", "in", "nin", "exists", "truthy", "falsy",
]);

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const strings = values.filter((item): item is string => typeof item === "string" && item.length > 0);
  return strings.length === 0 ? undefined : strings;
}

/** Compile JSON host configuration without adding host rules to ProductDefinition. */
export function compileServicePublicationPolicies(raw: unknown): {
  policies: ServicePublicationPolicyRule[];
  diagnostics: ServicePolicyConfigurationDiagnostic[];
} {
  const policies: ServicePublicationPolicyRule[] = [];
  const diagnostics: ServicePolicyConfigurationDiagnostic[] = [];
  if (!Array.isArray(raw)) return {
    policies,
    diagnostics: [{ ruleIndex: -1, severity: "error", message: "Policies root must be an array." }],
  };

  raw.forEach((entry, ruleIndex) => {
    const source = entry !== null && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const local: ServicePolicyConfigurationDiagnostic[] = [];
    const rawId = typeof source.id === "string" && source.id.trim() !== "" ? source.id.trim() : undefined;
    const id = rawId ?? `policy_${ruleIndex + 1}`;
    const warn = (message: string, path?: string): void => {
      local.push({ ruleIndex, ruleId: id, severity: "warning", message, ...(path === undefined ? {} : { path }) });
    };
    const error = (message: string, path?: string): void => {
      local.push({ ruleIndex, ruleId: id, severity: "error", message, ...(path === undefined ? {} : { path }) });
    };
    if (rawId === undefined) warn('Missing "id"; generated automatically.', "id");
    const label = typeof source.label === "string" && source.label.trim() !== "" ? source.label.trim() : id;
    if (!(typeof source.label === "string" && source.label.trim() !== "")) warn('Missing "label"; defaulted to rule id.', "label");

    const scope = scopes.has(source.scope as ServicePolicyScope) ? source.scope as ServicePolicyScope : "visible_group";
    if (source.scope !== undefined && !scopes.has(source.scope as ServicePolicyScope)) warn('Unknown "scope"; defaulted to "visible_group".', "scope");
    if (source.subject !== undefined && source.subject !== "services") warn('Unknown "subject"; defaulted to "services".', "subject");
    const op = source.op as ServicePolicyOperator;
    if (!operators.has(op)) error(`Invalid "op": ${String(source.op)}.`, "op");
    const projection = typeof source.projection === "string" && source.projection.trim() !== ""
      ? source.projection.trim() : "service.id";
    if (!projection.startsWith("service.")) warn('Projection should start with "service." for subject "services".', "projection");

    const rawFilter = source.filter !== null && typeof source.filter === "object"
      ? source.filter as Record<string, unknown> : {};
    const role = roles.has(rawFilter.role as ServicePolicyRole) ? rawFilter.role as ServicePolicyRole : "both";
    if (rawFilter.role !== undefined && !roles.has(rawFilter.role as ServicePolicyRole)) warn('Unknown filter.role; defaulted to "both".', "filter.role");
    const where: ServicePolicyWhereClause[] = [];
    if (rawFilter.where !== undefined && !Array.isArray(rawFilter.where)) warn("filter.where must be an array; ignored.", "filter.where");
    for (const [whereIndex, item] of (Array.isArray(rawFilter.where) ? rawFilter.where : []).entries()) {
      const clause = item !== null && typeof item === "object" ? item as Record<string, unknown> : {};
      if (!(typeof clause.path === "string" && clause.path.trim() !== "")) {
        warn(`filter.where[${whereIndex}].path must be a non-empty string; entry ignored.`, `filter.where[${whereIndex}].path`);
        continue;
      }
      const path = clause.path.trim();
      if (!path.startsWith("service.")) warn(`filter.where[${whereIndex}].path should start with "service.".`, `filter.where[${whereIndex}].path`);
      const whereOp = clause.op === undefined ? "eq" : whereOperators.has(clause.op as ServicePolicyWhereOperator)
        ? clause.op as ServicePolicyWhereOperator : "eq";
      if (clause.op !== undefined && !whereOperators.has(clause.op as ServicePolicyWhereOperator)) warn(`Unknown filter.where[${whereIndex}].op; defaulted to "eq".`, `filter.where[${whereIndex}].op`);
      if ((whereOp === "in" || whereOp === "nin") && !Array.isArray(clause.value)) warn(`filter.where[${whereIndex}] op "${whereOp}" expects an array "value".`, `filter.where[${whereIndex}].value`);
      if (["exists", "truthy", "falsy"].includes(whereOp) && clause.value !== undefined) warn(`filter.where[${whereIndex}] op "${whereOp}" does not use "value".`, `filter.where[${whereIndex}].value`);
      where.push({ path, op: whereOp, value: clause.value });
    }

    const value = source.value;
    if ((op === "max_count" || op === "min_count") && !(typeof value === "number" && Number.isFinite(value))) error(`"${op}" requires numeric "value".`, "value");
    else if (value !== undefined && op !== "max_count" && op !== "min_count") warn(`"${op}" does not use "value".`, "value");
    const severity = source.severity === "warning" || source.severity === "error" ? source.severity : "error";
    if (source.severity !== undefined && source.severity !== "warning" && source.severity !== "error") warn('Unknown "severity"; defaulted to "error".', "severity");

    const filterIds = stringArray(rawFilter.filter_id ?? rawFilter.tag_id);
    const fieldIds = stringArray(rawFilter.field_id);
    diagnostics.push(...local);
    if (!local.some((item) => item.severity === "error")) policies.push({
      id, label, scope, subject: "services",
      filter: {
        role,
        ...(filterIds === undefined ? {} : { filter_id: filterIds }),
        ...(fieldIds === undefined ? {} : { field_id: fieldIds }),
        ...(where.length === 0 ? {} : { where }),
      },
      projection, op, severity,
      ...(typeof value === "number" ? { value } : {}),
      ...(typeof source.message === "string" ? { message: source.message } : {}),
    });
  });
  return { policies, diagnostics };
}

export function splitServicePolicyDiagnostics(diagnostics: readonly ServicePolicyConfigurationDiagnostic[]): {
  errors: ServicePolicyConfigurationDiagnostic[];
  warnings: ServicePolicyConfigurationDiagnostic[];
} {
  return {
    errors: diagnostics.filter((item) => item.severity === "error"),
    warnings: diagnostics.filter((item) => item.severity === "warning"),
  };
}

interface ServicePolicyItem {
  filterId?: string;
  fieldId?: string;
  nodeId: string;
  serviceId: ServiceId;
  role: "base" | "utility";
  service: Record<string, unknown>;
  affectedIds: string[];
}

function getByPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) =>
    current !== null && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value);
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function matchesWhere(item: ServicePolicyItem, clauses: readonly ServicePolicyWhereClause[] | undefined): boolean {
  return (clauses ?? []).every((clause) => {
    const actual = getByPath(item, clause.path);
    switch (clause.op ?? "eq") {
      case "eq": return equal(actual, clause.value);
      case "neq": return !equal(actual, clause.value);
      case "in": return Array.isArray(clause.value) && clause.value.some((value) => equal(value, actual));
      case "nin": return Array.isArray(clause.value) && !clause.value.some((value) => equal(value, actual));
      case "exists": return actual !== undefined && actual !== null;
      case "truthy": return Boolean(actual);
      case "falsy": return !actual;
    }
  });
}

function evalPolicy(rule: ServicePublicationPolicyRule, values: unknown[]): boolean {
  const keys = values.map((value) => JSON.stringify(value));
  switch (rule.op) {
    case "all_equal": case "no_mix": return new Set(keys).size <= 1;
    case "unique": return new Set(keys).size === keys.length;
    case "all_true": return values.every((value) => value === true);
    case "any_true": return values.some((value) => value === true);
    case "max_count": return values.length <= (rule.value ?? Number.POSITIVE_INFINITY);
    case "min_count": return values.length >= (rule.value ?? 0);
  }
}

function serviceSnapshot(service: HandlerService | undefined, serviceId: ServiceId): Record<string, unknown> {
  if (service === undefined) return { id: serviceId };
  return { ...service, ...service.meta, id: service.id };
}

function fieldRefs(field: ProductField): Array<{ nodeId: string; serviceId: ServiceId; role: "base" | "utility" }> {
  const refs: Array<{ nodeId: string; serviceId: ServiceId; role: "base" | "utility" }> = [];
  if (field.button === true && field.service_id !== undefined) refs.push({
    nodeId: field.id, serviceId: field.service_id, role: field.pricing_role === "utility" ? "utility" : "base",
  });
  for (const { option } of walkFieldOptions(field)) if (option.service_id !== undefined) refs.push({
    nodeId: option.id, serviceId: option.service_id, role: option.pricing_role === "utility" || field.pricing_role === "utility" ? "utility" : "base",
  });
  return refs;
}

function collectPolicyItems(context: HostPublicationPolicyContext, rule: ServicePublicationPolicyRule, filterId?: string): ServicePolicyItem[] {
  const fields = filterId === undefined ? context.definition.fields : resolveVisibilityWithIndex(
    context.definition, context.index, filterId, [],
  ).fieldIds.flatMap((id) => {
    const field = context.index.getField(id);
    return field === undefined ? [] : [field];
  });
  const items = new Map<string, ServicePolicyItem>();
  const add = (nodeId: string, serviceId: ServiceId, role: "base" | "utility", fieldId?: string): void => {
    if (rule.filter.role !== "both" && rule.filter.role !== role) return;
    if (rule.filter.filter_id !== undefined && (filterId === undefined || !rule.filter.filter_id.includes(filterId))) return;
    if (rule.filter.field_id !== undefined && (fieldId === undefined || !rule.filter.field_id.includes(fieldId))) return;
    const item: ServicePolicyItem = {
      ...(filterId === undefined ? {} : { filterId }),
      ...(fieldId === undefined ? {} : { fieldId }),
      nodeId, serviceId, role,
      service: serviceSnapshot(findService(context.services ?? [], serviceId), serviceId),
      affectedIds: [nodeId, String(serviceId)],
    };
    if (!matchesWhere(item, rule.filter.where)) return;
    const key = `${String(serviceId)}|${role}`;
    const prior = items.get(key);
    if (prior === undefined) items.set(key, item);
    else prior.affectedIds = [...new Set([...prior.affectedIds, ...item.affectedIds])];
  };

  if (filterId !== undefined) {
    for (const filter of context.index.filterLineage(filterId)) if (filter.service_id !== undefined) add(filter.id, filter.service_id, "base");
  } else for (const filter of context.definition.filters) if (filter.service_id !== undefined) add(filter.id, filter.service_id, "base");
  for (const field of fields) for (const ref of fieldRefs(field)) add(ref.nodeId, ref.serviceId, ref.role, field.id);

  if (context.definition.fallbacks !== null) {
    const visibleNodeIds = new Set<string>(filterId === undefined
      ? [...context.definition.filters.map(({ id }) => id), ...fields.flatMap((field) => [field.id, ...walkFieldOptions(field).map(({ optionId }) => optionId)])]
      : [filterId, ...fields.flatMap((field) => [field.id, ...walkFieldOptions(field).map(({ optionId }) => optionId)])]);
    for (const [nodeId, candidates] of Object.entries(context.definition.fallbacks.nodes ?? {})) {
      if (!visibleNodeIds.has(nodeId)) continue;
      const primary = serviceBindingForNode(context.index, nodeId);
      const primaryItem = primary === undefined ? undefined : [...items.values()].find((item) => String(item.serviceId) === String(primary));
      for (const candidate of candidates) add(nodeId, candidate, primaryItem?.role ?? "base");
    }
    const primaries = new Set([...items.values()].map((item) => String(item.serviceId)));
    for (const [primary, candidates] of Object.entries(context.definition.fallbacks.global ?? {})) if (primaries.has(primary)) {
      const primaryItem = [...items.values()].find((item) => String(item.serviceId) === primary);
      for (const candidate of candidates) add(`fallback:${primary}`, candidate, primaryItem?.role ?? "base");
    }
  }
  return [...items.values()];
}

/** Adapt compiled service rules to the general host-policy extension point. */
export function createServicePublicationPolicies(rules: readonly ServicePublicationPolicyRule[]): HostPublicationPolicy[] {
  return rules.map((rule) => ({
    id: rule.id,
    evaluate(context) {
      if (context.services === undefined) return [{
        code: "host_policy_service_catalog_missing", severity: "error", path: "/",
        message: `Host service policy ${rule.id} requires a service catalog.`,
      }];
      const scopes = rule.scope === "global" ? [{ path: "/", filterId: undefined }]
        : context.definition.filters.map((filter, index) => ({ path: `/filters/${index}`, filterId: filter.id }));
      return scopes.flatMap(({ path, filterId }) => {
        const items = collectPolicyItems(context, rule, filterId);
        if (items.length === 0 || evalPolicy(rule, items.map((item) => getByPath(item, rule.projection)))) return [];
        return [{
          code: "host_service_policy_violation", severity: rule.severity, path,
          message: rule.message ?? rule.label,
          meta: {
            scope: rule.scope, filter_id: filterId, operator: rule.op,
            projection: rule.projection, count: items.length,
            affected_ids: [...new Set(items.flatMap((item) => item.affectedIds))],
          },
        } satisfies HostPublicationDiagnostic];
      });
    },
  }));
}
