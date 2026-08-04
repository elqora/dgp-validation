// SPDX-License-Identifier: GPL-3.0-only

import type {
  HandlerService,
  FieldRegistryConformanceEntry,
  ProductDefinition,
  ProductDefinitionDiagnostic,
  ProductField,
  ServiceId,
  ServiceRatePolicy,
} from "@elqora/dgp-spec";
import {
  findService,
  resolveFallbackEligibilityForNode,
  resolveCapabilities,
  resolveVisibilityWithIndex,
  resolveServiceBindingsWithIndex,
  serviceRateMatchesPolicy,
  serviceBindingForNode,
  serviceCapabilityEnabled,
  serviceSatisfiesCapabilities,
  walkFieldOptions,
} from "@elqora/dgp-core";

import { stronglyConnectedCycles } from "./cycles.js";
import { diagnostic, escapePointerSegment, sortDiagnostics } from "./diagnostics.js";
import {
  createSemanticIndex,
  triggerOwnerField,
  type SemanticIndex,
} from "./semantic-index.js";

export interface SemanticValidationOptions {
  services?: readonly HandlerService[];
  field_registry?: readonly FieldRegistryConformanceEntry[];
  rate_policy?: ServiceRatePolicy | null;
  fallback_policy?: {
    require_capability_fit: boolean;
    rate_policy: ServiceRatePolicy;
  } | null;
}

function pointerMapPath(mapName: string, key: string): string {
  return `/${mapName}/${escapePointerSegment(key)}`;
}

function addEdge(edges: Map<string, string[]>, source: string, target: string): void {
  const targets = edges.get(source) ?? [];
  if (!targets.includes(target)) targets.push(target);
  edges.set(source, targets);
}

function validateIdentity(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
): void {
  for (const duplicate of index.duplicateNodes) {
    diagnostics.push(diagnostic(
      "duplicate_node_id",
      "error",
      `${duplicate.path}/id`,
      `Node id ${duplicate.id} is already used elsewhere in this definition.`,
      { node_id: duplicate.id },
      [`${duplicate.firstPath}/id`],
    ));
  }

  const filterLabels = new Map<string, string>();
  definition.filters.forEach((filter, filterIndex) => {
    const key = filter.label.trim().toLocaleLowerCase();
    const path = `/filters/${filterIndex}/label`;
    const firstPath = filterLabels.get(key);
    if (firstPath === undefined) filterLabels.set(key, path);
    else diagnostics.push(diagnostic(
      "duplicate_filter_label",
      "warning",
      path,
      `Filter label ${filter.label} is duplicated.`,
      { label: filter.label },
      [firstPath],
    ));
  });

  const fieldNames = new Map<string, string>();
  definition.fields.forEach((field, fieldIndex) => {
    if (field.name === undefined || field.name.length === 0) return;
    const path = `/fields/${fieldIndex}/name`;
    const firstPath = fieldNames.get(field.name);
    if (firstPath === undefined) fieldNames.set(field.name, path);
    else diagnostics.push(diagnostic(
      "duplicate_field_name",
      "error",
      path,
      `Field name ${field.name} would collide in customer input state.`,
      { field_name: field.name },
      [firstPath],
    ));
  });
}

function validateBindingsAndCycles(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
): void {
  const filterEdges = new Map<string, string[]>();
  definition.filters.forEach((filter, filterIndex) => {
    filterEdges.set(filter.id, filter.bind_id === undefined ? [] : [filter.bind_id]);
    if (filter.bind_id !== undefined && !index.filters.has(filter.bind_id)) {
      diagnostics.push(diagnostic(
        "filter_binding_unknown",
        "error",
        `/filters/${filterIndex}/bind_id`,
        `Filter ${filter.id} references unknown parent filter ${filter.bind_id}.`,
        { filter_id: filter.id, parent_filter_id: filter.bind_id },
      ));
    }
  });

  for (const cycle of stronglyConnectedCycles(filterEdges)) {
    const first = index.filters.get(cycle[0]!);
    const related = cycle.slice(1).flatMap((id) => {
      const item = index.filters.get(id);
      return item === undefined ? [] : [`${item.path}/bind_id`];
    });
    diagnostics.push(diagnostic(
      "filter_cycle",
      "error",
      first === undefined ? "/filters" : `${first.path}/bind_id`,
      `Filter hierarchy contains a cycle: ${cycle.join(" -> ")}.`,
      { filter_ids: cycle },
      related,
    ));
  }

  definition.fields.forEach((field, fieldIndex) => {
    for (const filterId of index.core.fieldBindIds(field)) {
      if (!index.filters.has(filterId)) diagnostics.push(diagnostic(
        "field_binding_unknown",
        "error",
        `/fields/${fieldIndex}/bind_id`,
        `Field ${field.id} references unknown filter ${filterId}.`,
        { field_id: field.id, filter_id: filterId },
      ));
    }
  });
}

function validateFieldReference(
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  fieldId: string,
  path: string,
): boolean {
  if (index.fields.has(fieldId)) return true;
  diagnostics.push(diagnostic(
    "relationship_target_unknown",
    "error",
    path,
    `Relationship references unknown field ${fieldId}.`,
    { field_id: fieldId },
  ));
  return false;
}

function validateTrigger(
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  triggerId: string,
  path: string,
): ProductField | undefined {
  const owner = triggerOwnerField(index, triggerId);
  if (owner !== undefined) return owner;
  diagnostics.push(diagnostic(
    "trigger_unknown",
    "error",
    path,
    `Trigger ${triggerId} is not a recursive option or a button field.`,
    { trigger_id: triggerId },
  ));
  return undefined;
}

function validateValueTrigger(
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  triggerId: string,
  path: string,
): ProductField | undefined {
  if (index.filters.has(triggerId)) return undefined;
  return validateTrigger(index, diagnostics, triggerId, path);
}

function validateRelationshipsAndEffects(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
): void {
  definition.filters.forEach((filter, filterIndex) => {
    for (const mapName of ["includes", "excludes"] as const) {
      for (const [targetIndex, fieldId] of (filter[mapName] ?? []).entries()) {
        validateFieldReference(index, diagnostics, fieldId, `/filters/${filterIndex}/${mapName}/${targetIndex}`);
      }
    }
    const included = new Set(filter.includes ?? []);
    for (const fieldId of filter.excludes ?? []) if (included.has(fieldId)) diagnostics.push(diagnostic(
      "relationship_conflict", "error", `/filters/${filterIndex}/excludes`,
      `Filter ${filter.id} both includes and excludes field ${fieldId}.`,
      { filter_id: filter.id, field_id: fieldId }, [`/filters/${filterIndex}/includes`],
    ));
  });

  for (const [filterId, fieldIds] of Object.entries(definition.order_for_tags)) {
    const basePath = pointerMapPath("order_for_tags", filterId);
    if (!index.filters.has(filterId)) diagnostics.push(diagnostic(
      "filter_binding_unknown",
      "error",
      basePath,
      `Field order references unknown filter ${filterId}.`,
      { filter_id: filterId },
    ));
    fieldIds.forEach((fieldId, targetIndex) =>
      validateFieldReference(index, diagnostics, fieldId, `${basePath}/${targetIndex}`));
  }

  const relationshipMaps = [
    ["includes_for_buttons", definition.includes_for_buttons],
    ["excludes_for_buttons", definition.excludes_for_buttons],
  ] as const;
  for (const [mapName, map] of relationshipMaps) {
    for (const [triggerId, fieldIds] of Object.entries(map)) {
      const triggerPath = pointerMapPath(mapName, triggerId);
      const owner = validateTrigger(index, diagnostics, triggerId, triggerPath);
      fieldIds.forEach((fieldId, targetIndex) => {
        if (validateFieldReference(index, diagnostics, fieldId, `${triggerPath}/${targetIndex}`)
          && owner !== undefined) {
          // Trigger ownership is validated here; reachability cycles are checked by activation paths below.
        }
      });
    }
  }
  for (const triggerId of new Set([
    ...Object.keys(definition.includes_for_buttons),
    ...Object.keys(definition.excludes_for_buttons),
  ])) {
    const included = new Set(definition.includes_for_buttons[triggerId] ?? []);
    for (const fieldId of definition.excludes_for_buttons[triggerId] ?? []) if (included.has(fieldId)) diagnostics.push(diagnostic(
      "relationship_conflict", "error",
      `${pointerMapPath("excludes_for_buttons", triggerId)}`,
      `Trigger ${triggerId} both includes and excludes field ${fieldId}.`,
      { trigger_id: triggerId, field_id: fieldId },
      [pointerMapPath("includes_for_buttons", triggerId)],
    ));
  }

  for (const [triggerId, targetRules] of Object.entries(definition.option_effects_for_buttons)) {
    const triggerPath = pointerMapPath("option_effects_for_buttons", triggerId);
    const owner = validateTrigger(index, diagnostics, triggerId, triggerPath);
    for (const [targetFieldId, rule] of Object.entries(targetRules)) {
      const targetPath = `${triggerPath}/${escapePointerSegment(targetFieldId)}`;
      const targetField = index.fields.get(targetFieldId)?.value;
      if (targetField === undefined) {
        diagnostics.push(diagnostic(
          "effect_target_unknown",
          "error",
          targetPath,
          `Option effect targets unknown field ${targetFieldId}.`,
          { field_id: targetFieldId, trigger_id: triggerId },
        ));
        continue;
      }
      void owner;
      const knownOptions = new Set(walkFieldOptions(targetField).map((visit) => visit.optionId));
      for (const [property, ids] of [["include", rule.include], ["exclude", rule.exclude]] as const) {
        for (const [optionIndex, optionId] of (ids ?? []).entries()) {
          if (!knownOptions.has(optionId)) diagnostics.push(diagnostic(
            "effect_option_unknown",
            "error",
            `${targetPath}/${property}/${optionIndex}`,
            `Option effect references ${optionId}, which is not owned by field ${targetFieldId}.`,
            { field_id: targetFieldId, option_id: optionId, trigger_id: triggerId },
          ));
        }
      }
      const included = new Set(rule.include ?? []);
      for (const optionId of rule.exclude ?? []) {
        if (included.has(optionId)) diagnostics.push(diagnostic(
          "option_effect_conflict",
          "error",
          targetPath,
          `Option ${optionId} is both included and excluded by the same effect.`,
          { field_id: targetFieldId, option_id: optionId, trigger_id: triggerId },
        ));
      }
    }
  }

  const effectsByTarget = new Map<string, Array<{ triggerId: string; path: string; signature: string }>>();
  for (const [triggerId, targetRules] of Object.entries(definition.value_effects_for_triggers)) {
    const triggerPath = pointerMapPath("value_effects_for_triggers", triggerId);
    const owner = validateValueTrigger(index, diagnostics, triggerId, triggerPath);
    for (const [targetFieldId, effect] of Object.entries(targetRules)) {
      const targetPath = `${triggerPath}/${escapePointerSegment(targetFieldId)}`;
      if (!index.fields.has(targetFieldId)) {
        diagnostics.push(diagnostic(
          "effect_target_unknown",
          "error",
          targetPath,
          `Value effect targets unknown field ${targetFieldId}.`,
          { field_id: targetFieldId, trigger_id: triggerId },
        ));
        continue;
      }
      void owner;
      const effects = effectsByTarget.get(targetFieldId) ?? [];
      effects.push({ triggerId, path: targetPath, signature: JSON.stringify(effect) });
      effectsByTarget.set(targetFieldId, effects);
    }
  }

  for (const [targetFieldId, effects] of effectsByTarget) {
    const signatures = new Set(effects.map((effect) => effect.signature));
    if (effects.length > 1 && signatures.size > 1) diagnostics.push(diagnostic(
      "value_effect_conflict",
      "warning",
      effects[1]!.path,
      `Multiple triggers declare different value effects for field ${targetFieldId}.`,
      { field_id: targetFieldId, trigger_ids: effects.map((effect) => effect.triggerId) },
      [effects[0]!.path],
    ));
  }

}

function validateCustomerAndQuantityRules(
  definition: ProductDefinition,
  diagnostics: ProductDefinitionDiagnostic[],
): void {
  definition.fields.forEach((field, fieldIndex) => {
    const quantity = field.quantity;
    if (quantity?.clamp?.min !== undefined && quantity.clamp.max !== undefined && quantity.clamp.min > quantity.clamp.max) {
      diagnostics.push(diagnostic(
        "quantity_rule_invalid", "error", `/fields/${fieldIndex}/quantity/clamp`,
        `Quantity rule for field ${field.id} has clamp min greater than max.`, { field_id: field.id },
      ));
    }

    for (const [ruleIndex, rule] of (field.validation ?? []).entries()) {
      const path = `/fields/${fieldIndex}/validation/${ruleIndex}`;
      let reason: string | undefined;
      if (["eq", "neq"].includes(rule.op) && rule.value === undefined) reason = `${rule.op} requires value.`;
      if (["gt", "gte", "lt", "lte"].includes(rule.op) && typeof rule.value !== "number") reason = `${rule.op} requires a numeric value.`;
      if (rule.op === "between" && (rule.min === undefined || rule.max === undefined || rule.min > rule.max)) reason = "between requires min less than or equal to max.";
      if (["in", "nin"].includes(rule.op) && (rule.values?.length ?? 0) === 0) reason = `${rule.op} requires at least one value.`;
      if (rule.op === "match") {
        if (rule.pattern === undefined) reason = "match requires pattern.";
        else {
          try { new RegExp(rule.pattern, rule.pattern_flags); }
          catch { reason = "match pattern or pattern_flags is not a valid JavaScript regular expression."; }
        }
      }
      if (reason !== undefined) diagnostics.push(diagnostic(
        "field_validation_rule_invalid", "error", path,
        `Validation rule ${ruleIndex} for field ${field.id} is invalid: ${reason}`,
        { field_id: field.id, rule_index: ruleIndex, operator: rule.op },
      ));
    }
  });
}

function validateCapabilitiesAndServices(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  services: readonly HandlerService[] | undefined,
): void {
  definition.filters.forEach((filter, filterIndex) => {
    const resolved = resolveCapabilities(index.core, filter.id);
    for (const [capabilityId, localValue] of Object.entries(filter.capabilities ?? {})) {
      const originId = resolved.origins[capabilityId];
      if (originId !== undefined && originId !== filter.id && resolved.values[capabilityId] !== localValue) {
        const origin = index.filters.get(originId);
        diagnostics.push(diagnostic(
          "capability_override_ignored",
          "warning",
          `/filters/${filterIndex}/capabilities/${escapePointerSegment(capabilityId)}`,
          `Ancestor filter ${originId} takes precedence over ${filter.id}'s ${capabilityId} declaration.`,
          { capability_id: capabilityId, filter_id: filter.id, origin_filter_id: originId },
          origin === undefined ? [] : [`${origin.path}/capabilities/${escapePointerSegment(capabilityId)}`],
        ));
      }
    }
  });

  if (services === undefined) return;
  const bindings = resolveServiceBindingsWithIndex(definition, index.core);
  for (const [nodeId, serviceId] of Object.entries(bindings.byNodeId)) {
    if (findService(services, serviceId) === undefined) diagnostics.push(diagnostic(
      "service_reference_unknown",
      "error",
      index.nodePaths.get(nodeId) ?? "/",
      `Node ${nodeId} references unknown service ${String(serviceId)}.`,
      { node_id: nodeId, service_id: serviceId },
    ));
  }

  definition.filters.forEach((filter, filterIndex) => {
    if (filter.service_id === undefined) return;
    const service = findService(services, filter.service_id);
    if (service === undefined) return;
    const requirements = resolveCapabilities(index.core, filter.id).values;
    for (const [capabilityId, required] of Object.entries(requirements)) {
      if (serviceCapabilityEnabled(service, capabilityId) !== required) diagnostics.push(diagnostic(
        "capability_requirement_unsatisfied",
        "error",
        `/filters/${filterIndex}/capabilities/${escapePointerSegment(capabilityId)}`,
        `Service ${String(service.id)} does not satisfy ${capabilityId}=${String(required)} for filter ${filter.id}.`,
        { capability_id: capabilityId, required, filter_id: filter.id, service_id: service.id },
      ));
    }
  });
}

function sameServiceId(left: ServiceId, right: ServiceId): boolean {
  return String(left) === String(right);
}

function validateFallbacks(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  services: readonly HandlerService[] | undefined,
): void {
  if (definition.fallbacks === null) return;
  const edges = new Map<string, string[]>();

  const validateCandidates = (
    primary: ServiceId,
    candidates: readonly ServiceId[],
    basePath: string,
  ): void => {
    const seen = new Set<string>();
    candidates.forEach((candidate, candidateIndex) => {
      const path = `${basePath}/${candidateIndex}`;
      const key = String(candidate);
      if (seen.has(key)) diagnostics.push(diagnostic(
        "fallback_duplicate_candidate",
        "warning",
        path,
        `Fallback service ${key} is registered more than once.`,
        { primary_service_id: primary, candidate_service_id: candidate },
      ));
      seen.add(key);
      if (sameServiceId(primary, candidate)) diagnostics.push(diagnostic(
        "fallback_self_reference",
        "error",
        path,
        `Service ${key} cannot fall back to itself.`,
        { primary_service_id: primary },
      ));
      if (services !== undefined && findService(services, candidate) === undefined) diagnostics.push(diagnostic(
        "fallback_candidate_unknown",
        "error",
        path,
        `Fallback candidate ${key} is absent from the supplied service catalog.`,
        { primary_service_id: primary, candidate_service_id: candidate },
      ));
      addEdge(edges, String(primary), key);
    });
  };

  for (const [nodeId, candidates] of Object.entries(definition.fallbacks.nodes ?? {})) {
    const basePath = `/fallbacks/nodes/${escapePointerSegment(nodeId)}`;
    if (!index.nodePaths.has(nodeId)) {
      diagnostics.push(diagnostic(
        "fallback_node_unknown",
        "error",
        basePath,
        `Fallback registration references unknown node ${nodeId}.`,
        { node_id: nodeId },
      ));
      continue;
    }
    const primary = serviceBindingForNode(index.core, nodeId);
    if (primary === undefined) {
      diagnostics.push(diagnostic(
        "fallback_primary_missing",
        "error",
        basePath,
        `Node ${nodeId} has fallback candidates but no primary service binding.`,
        { node_id: nodeId },
      ));
      continue;
    }
    validateCandidates(primary, candidates, basePath);
  }

  for (const [primary, candidates] of Object.entries(definition.fallbacks.global ?? {})) {
    const basePath = `/fallbacks/global/${escapePointerSegment(primary)}`;
    if (services !== undefined && findService(services, primary) === undefined) diagnostics.push(diagnostic(
      "fallback_primary_missing",
      "error",
      basePath,
      `Global fallback primary ${primary} is absent from the supplied service catalog.`,
      { primary_service_id: primary },
    ));
    validateCandidates(primary, candidates, basePath);
  }

  for (const cycle of stronglyConnectedCycles(edges)) diagnostics.push(diagnostic(
    "fallback_cycle",
    "error",
    "/fallbacks",
    `Fallback registrations contain a service cycle: ${cycle.join(" -> ")}.`,
    { service_ids: cycle },
  ));
}

function validateUtilities(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
): void {
  let hasUtility = false;
  let hasBaseService = definition.filters.some((filter) => filter.service_id !== undefined);
  definition.fields.forEach((field, fieldIndex) => {
    if (field.utility !== undefined || field.pricing_role === "utility") hasUtility = true;
    if (field.button === true && field.service_id !== undefined) {
      if (field.pricing_role === "utility") diagnostics.push(diagnostic(
        "utility_service_conflict",
        "error",
        `/fields/${fieldIndex}/service_id`,
        `Utility field ${field.id} cannot also select a handler service.`,
        { field_id: field.id, service_id: field.service_id },
      ));
      else hasBaseService = true;
    }
    for (const visit of walkFieldOptions(field)) {
      if (visit.option.utility !== undefined || visit.option.pricing_role === "utility") hasUtility = true;
      if (visit.option.service_id !== undefined) {
        if (visit.option.pricing_role === "utility") diagnostics.push(diagnostic(
          "utility_service_conflict",
          "error",
          `${index.options.get(visit.optionId)?.path ?? `/fields/${fieldIndex}/options`}/service_id`,
          `Utility option ${visit.optionId} cannot also select a handler service.`,
          { option_id: visit.optionId, service_id: visit.option.service_id },
        ));
        else hasBaseService = true;
      }
    }
  });

  if (hasUtility && !hasBaseService) diagnostics.push(diagnostic(
    "utility_base_missing",
    "error",
    "/fields",
    "The definition declares advisory utilities without any base handler service.",
  ));
}

interface ReachableContext {
  filterId: string;
  triggerIds: string[];
  fieldIds: string[];
}

function reachableContexts(definition: ProductDefinition, index: SemanticIndex): ReachableContext[] {
  const contexts: ReachableContext[] = [];
  const triggers = triggerActivationIndex(definition);
  for (const filter of definition.filters) {
    const pending: string[][] = [[]];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const triggerIds = pending.shift()!;
      const stateKey = [...triggerIds].sort().join("\u0000");
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      const resolved = resolveVisibilityWithIndex(definition, index.core, filter.id, triggerIds);
      contexts.push({ filterId: filter.id, triggerIds, fieldIds: resolved.fieldIds });
      const visible = new Set(resolved.fieldIds);
      for (const trigger of triggers.values()) {
        if (triggerIds.includes(trigger.id) || !visible.has(trigger.ownerFieldId)) continue;
        const owner = index.fields.get(trigger.ownerFieldId)?.value;
        const conflicts = trigger.kind === "option" && owner?.multiple !== true && triggerIds.some((selectedId) => {
          const selected = triggers.get(selectedId);
          return selected?.kind === "option" && selected.ownerFieldId === trigger.ownerFieldId;
        });
        if (!conflicts) pending.push([...triggerIds, trigger.id]);
      }
    }
  }
  return contexts;
}

function nodePath(index: SemanticIndex, nodeId: string): string {
  return index.nodePaths.get(nodeId) ?? "/";
}

function validateLabelsReachabilityAndRoots(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  contexts: readonly ReachableContext[],
): void {
  if (index.core.rootFilters().length === 0) diagnostics.push(diagnostic(
    "filter_root_missing", "error", "/filters",
    "The definition requires at least one root filter context.",
  ));

  definition.filters.forEach((filter, filterIndex) => {
    if (filter.label.trim().length === 0) diagnostics.push(diagnostic(
      "node_label_empty", "error", `/filters/${filterIndex}/label`,
      `Filter ${filter.id} requires a non-empty label.`, { node_id: filter.id },
    ));
  });
  definition.fields.forEach((field, fieldIndex) => {
    if (field.label.trim().length === 0) diagnostics.push(diagnostic(
      "node_label_empty", "error", `/fields/${fieldIndex}/label`,
      `Field ${field.id} requires a non-empty label.`, { node_id: field.id },
    ));
    for (const visit of walkFieldOptions(field)) {
      if (visit.option.label.trim().length === 0) diagnostics.push(diagnostic(
        "node_label_empty", "error", `${index.options.get(visit.optionId)?.path ?? `/fields/${fieldIndex}/options`}/label`,
        `Option ${visit.optionId} requires a non-empty label.`, { node_id: visit.optionId },
      ));
    }
  });

  const reachableFields = new Set(contexts.flatMap(({ fieldIds }) => fieldIds));
  definition.fields.forEach((field, fieldIndex) => {
    if (!reachableFields.has(field.id)) diagnostics.push(diagnostic(
      "field_unreachable", "error", `/fields/${fieldIndex}`,
      `Field ${field.id} is unreachable in every filter and trigger context.`, { field_id: field.id },
    ));
  });

  const reported = new Set<string>();
  for (const context of contexts) {
    const labels = new Map<string, string>();
    for (const fieldId of context.fieldIds) {
      const located = index.fields.get(fieldId);
      if (located === undefined) continue;
      const key = located.value.label.trim().toLocaleLowerCase();
      if (key.length === 0) continue;
      const first = labels.get(key);
      if (first === undefined) labels.set(key, located.path);
      else if (!reported.has(`${context.filterId}:${key}`)) {
        reported.add(`${context.filterId}:${key}`);
        diagnostics.push(diagnostic(
          "duplicate_visible_field_label", "error", `${located.path}/label`,
          `Visible fields in filter ${context.filterId} share label ${located.value.label}.`,
          { filter_id: context.filterId, label: located.value.label }, [`${first}/label`],
        ));
      }
    }
  }
}

function validateServiceInputAndQuantityContexts(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  contexts: readonly ReachableContext[],
): void {
  definition.fields.forEach((field, fieldIndex) => {
    const serviceOptions = walkFieldOptions(field).filter(({ option }) => option.service_id !== undefined);
    if ((field.name?.trim().length ?? 0) > 0 && serviceOptions.length > 0) diagnostics.push(diagnostic(
      "customer_input_service_conflict", "error", `/fields/${fieldIndex}/options`,
      `Customer-input field ${field.id} cannot also select handler services.`, { field_id: field.id },
    ));
    const triggerConfigured = field.button === true && (
      (definition.includes_for_buttons[field.id]?.length ?? 0) > 0
      || (definition.excludes_for_buttons[field.id]?.length ?? 0) > 0
    );
    if ((field.name?.trim().length ?? 0) === 0
      && field.pricing_role !== "utility"
      && field.options === undefined
      && (field.button !== true || field.service_id === undefined)
      && !triggerConfigured) diagnostics.push(diagnostic(
        "service_selector_unconfigured", "error", `/fields/${fieldIndex}`,
        `Nameless field ${field.id} neither selects a service nor acts as a configured trigger.`,
        { field_id: field.id },
      ));
  });

  const reported = new Set<string>();
  for (const context of contexts) {
    const markers = context.fieldIds.filter((fieldId) => {
      const field = index.fields.get(fieldId)?.value;
      return field?.quantity !== undefined || field?.quantity_default !== undefined;
    });
    if (markers.length <= 1) continue;
    const signature = markers.join("\u0000");
    if (reported.has(signature)) continue;
    reported.add(signature);
    diagnostics.push(diagnostic(
      "quantity_source_conflict", "error", nodePath(index, markers[1]!),
      `Reachable context ${context.filterId} contains multiple field quantity sources.`,
      { filter_id: context.filterId, field_ids: markers }, [nodePath(index, markers[0]!)],
    ));
  }
}

function validateValueEffectValuesAndReachability(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
): void {
  for (const [triggerId, targets] of Object.entries(definition.value_effects_for_triggers)) {
    for (const [fieldId, effect] of Object.entries(targets)) {
      const field = index.fields.get(fieldId)?.value;
      if (field === undefined) continue;
      const path = `${pointerMapPath("value_effects_for_triggers", triggerId)}/${escapePointerSegment(fieldId)}`;
      const values = Array.isArray(effect.value) ? effect.value : [effect.value];
      if (values.length > 1 && field.multiple !== true) diagnostics.push(diagnostic(
        "value_effect_cardinality_mismatch", "error", `${path}/value`,
        `Value effect assigns multiple values to single-select field ${fieldId}.`,
        { trigger_id: triggerId, field_id: fieldId },
      ));
      if ((field.options?.length ?? 0) > 0) {
        const accepted = new Set<unknown>();
        for (const visit of walkFieldOptions(field)) {
          accepted.add(visit.option.id);
          if (visit.option.value !== undefined) accepted.add(visit.option.value);
        }
        if (values.some((value) => !accepted.has(value))) diagnostics.push(diagnostic(
          "value_effect_value_invalid", "error", `${path}/value`,
          `Value effect for ${fieldId} contains a value that is not one of its recursive options.`,
          { trigger_id: triggerId, field_id: fieldId },
        ));
      }

      let reachable = false;
      if (index.filters.has(triggerId)) {
        reachable = resolveVisibilityWithIndex(definition, index.core, triggerId).fieldIds.includes(fieldId);
      } else {
        for (const filter of definition.filters) {
          const selected = resolveVisibilityWithIndex(definition, index.core, filter.id, [triggerId]);
          if (selected.fieldIds.includes(fieldId)) {
            reachable = true;
            break;
          }
        }
      }
      if (!reachable) diagnostics.push(diagnostic(
        "effect_target_unreachable", "error", path,
        `Value-effect target ${fieldId} is unreachable while trigger ${triggerId} is active.`,
        { trigger_id: triggerId, field_id: fieldId },
      ));
    }
  }
}

interface TriggerActivationInfo {
  id: string;
  ownerFieldId: string;
  kind: "button" | "option";
}

function triggerActivationIndex(definition: ProductDefinition): Map<string, TriggerActivationInfo> {
  const result = new Map<string, TriggerActivationInfo>();
  for (const field of definition.fields) {
    if (field.button === true) result.set(field.id, { id: field.id, ownerFieldId: field.id, kind: "button" });
    for (const visit of walkFieldOptions(field)) {
      result.set(visit.optionId, { id: visit.optionId, ownerFieldId: field.id, kind: "option" });
    }
  }
  return result;
}

function validateVisibilityInvalidationCycles(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
): void {
  const triggers = triggerActivationIndex(definition);
  const triggersByField = new Map<string, string[]>();
  for (const trigger of triggers.values()) {
    const values = triggersByField.get(trigger.ownerFieldId) ?? [];
    values.push(trigger.id);
    triggersByField.set(trigger.ownerFieldId, values);
  }
  const reveals = new Map<string, string[]>();
  for (const triggerId of triggers.keys()) {
    const targets = new Set(definition.includes_for_buttons[triggerId] ?? []);
    for (const [fieldId, effect] of Object.entries(definition.option_effects_for_buttons[triggerId] ?? {})) {
      if (effect.force_visible === true) targets.add(fieldId);
    }
    reveals.set(triggerId, [...targets]);
  }

  const reported = new Set<string>();
  const invalidatedRequiredId = (
    conflictingTriggerId: string,
    requiredTriggers: ReadonlySet<string>,
    requiredOwners: ReadonlySet<string>,
  ): string | undefined => {
    for (const targetId of definition.excludes_for_buttons[conflictingTriggerId] ?? []) {
      if (requiredOwners.has(targetId) || requiredTriggers.has(targetId)) return targetId;
    }
    for (const [targetFieldId, effect] of Object.entries(
      definition.option_effects_for_buttons[conflictingTriggerId] ?? {},
    )) {
      for (const requiredTriggerId of requiredTriggers) {
        const required = triggers.get(requiredTriggerId);
        if (required?.kind !== "option" || required.ownerFieldId !== targetFieldId) continue;
        if (effect.exclude?.includes(requiredTriggerId) === true) return requiredTriggerId;
        if ((effect.include?.length ?? 0) > 0 && effect.include?.includes(requiredTriggerId) !== true) {
          return requiredTriggerId;
        }
      }
    }
    return undefined;
  };

  const walk = (
    rootId: string,
    currentId: string,
    path: string[],
    requiredTriggers: Set<string>,
    requiredOwners: Set<string>,
    depth: number,
  ): void => {
    if (depth >= 20) return;
    for (const fieldId of reveals.get(currentId) ?? []) {
      for (const nextId of triggersByField.get(fieldId) ?? []) {
        const invalidated = invalidatedRequiredId(nextId, requiredTriggers, requiredOwners);
        if (invalidated !== undefined) {
          const key = `${rootId}:${nextId}:${invalidated}`;
          if (!reported.has(key)) {
            reported.add(key);
            diagnostics.push(diagnostic(
              "visibility_dependency_cycle", "error", nodePath(index, nextId),
              `Trigger ${rootId} reveals ${fieldId}, but reachable trigger ${nextId} invalidates ${invalidated}.`,
              { root_trigger_id: rootId, conflicting_trigger_id: nextId, invalidated_id: invalidated, path: [...path, nextId] },
              [nodePath(index, rootId), nodePath(index, invalidated)],
            ));
          }
        }
        if (path.includes(nextId)) continue;
        const nextTriggers = new Set(requiredTriggers);
        const nextOwners = new Set(requiredOwners);
        nextTriggers.add(nextId);
        const next = triggers.get(nextId);
        if (next !== undefined) nextOwners.add(next.ownerFieldId);
        walk(rootId, nextId, [...path, nextId], nextTriggers, nextOwners, depth + 1);
      }
    }
  };

  for (const trigger of triggers.values()) {
    walk(trigger.id, trigger.id, [trigger.id], new Set([trigger.id]), new Set([trigger.ownerFieldId]), 0);
  }
}

function validateValueActivationCycles(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
): void {
  const triggers = triggerActivationIndex(definition);
  const edges = new Map<string, string[]>();
  for (const [triggerId, targets] of Object.entries(definition.value_effects_for_triggers)) {
    for (const [targetFieldId, effect] of Object.entries(targets)) {
      const field = index.fields.get(targetFieldId)?.value;
      if (field === undefined) continue;
      const optionIds = new Set(walkFieldOptions(field).map(({ optionId }) => optionId));
      for (const value of Array.isArray(effect.value) ? effect.value : [effect.value]) {
        if (typeof value !== "string") continue;
        const targetTriggerId = value;
        if (optionIds.has(targetTriggerId) && triggers.has(targetTriggerId)) addEdge(edges, triggerId, targetTriggerId);
      }
    }
  }
  for (const cycle of stronglyConnectedCycles(edges)) diagnostics.push(diagnostic(
    "value_effect_cycle", "error", nodePath(index, cycle[0]!),
    `Value-effect activation contains a cycle: ${cycle.join(" -> ")}.`,
    { trigger_ids: cycle }, cycle.slice(1).map((id) => nodePath(index, id)),
  ));
}

function validateFieldRegistry(
  definition: ProductDefinition,
  diagnostics: ProductDefinitionDiagnostic[],
  registry: readonly FieldRegistryConformanceEntry[] | undefined,
): void {
  if (registry === undefined || registry.length === 0) return;
  const entries = new Map(registry.map((entry) => [entry.type, entry]));
  definition.fields.forEach((field, fieldIndex) => {
    const entry = entries.get(field.type);
    const path = `/fields/${fieldIndex}`;
    if (entry === undefined || !entry.variants.includes(field.variant ?? "default")
      && !entry.variants.includes("default")) diagnostics.push(diagnostic(
        "field_registry_entry_unknown", "error", `${path}/type`,
        `No field-registry entry can resolve ${field.type}/${field.variant ?? "default"}.`,
        { field_id: field.id, type: field.type, variant: field.variant ?? "default" },
      ));
    else if (field.multiple === true && entry.multiple !== true) diagnostics.push(diagnostic(
      "field_multiple_unsupported", "error", `${path}/multiple`,
      `Resolved registry entry for ${field.id} does not support multiple selection.`,
      { field_id: field.id, type: field.type },
    ));
  });
}

function serviceNodeContexts(index: SemanticIndex, nodeId: string): string[] {
  const node = index.core.getNode(nodeId);
  return node.kind === "filter" ? [node.id] : index.core.nodeFilterIds(nodeId);
}

function validateCatalogCoherence(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  options: SemanticValidationOptions,
): void {
  const services = options.services;
  if (services === undefined) return;
  const bindings = resolveServiceBindingsWithIndex(definition, index.core);
  for (const [nodeId, serviceId] of Object.entries(bindings.byNodeId)) {
    const service = findService(services, serviceId);
    if (service === undefined) continue;
    const path = nodePath(index, nodeId);
    if (service.state !== "enabled") diagnostics.push(diagnostic(
      "service_state_unavailable", "error", path,
      `Service ${String(service.id)} bound by ${nodeId} is ${service.state}.`,
      { node_id: nodeId, service_id: service.id, state: service.state },
    ));
    if (service.min > service.max) diagnostics.push(diagnostic(
      "service_quantity_bounds_incoherent", "error", path,
      `Service ${String(service.id)} has minimum ${service.min} greater than maximum ${service.max}.`,
      { node_id: nodeId, service_id: service.id, min: service.min, max: service.max },
    ));
    for (const filterId of serviceNodeContexts(index, nodeId)) {
      const requirements = resolveCapabilities(index.core, filterId).values;
      if (!serviceSatisfiesCapabilities(service, requirements)) diagnostics.push(diagnostic(
        "capability_requirement_unsatisfied", "error", path,
        `Service ${String(service.id)} does not satisfy effective capabilities in ${filterId}.`,
        { node_id: nodeId, filter_id: filterId, service_id: service.id },
      ));
    }
  }

}

function validateContextualRates(
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  options: SemanticValidationOptions,
  contexts: readonly ReachableContext[],
): void {
  if (options.services === undefined || options.rate_policy == null) return;
  const reported = new Set<string>();
  for (const context of contexts) {
      const refs = context.triggerIds.flatMap((triggerId) => {
        const field = index.fields.get(triggerId)?.value;
        if (field?.button === true && field.service_id !== undefined && field.pricing_role !== "utility") {
          return [{ fieldId: field.id, serviceId: field.service_id }];
        }
        const option = index.options.get(triggerId);
        return option?.value.service_id !== undefined && option.value.pricing_role !== "utility"
          ? [{ fieldId: option.field.id, serviceId: option.value.service_id }] : [];
      });
      if (refs.length === 0) {
        const primaryFilter = [...index.core.filterLineage(context.filterId)].reverse().find(
          (item) => item.service_id !== undefined,
        );
        if (primaryFilter?.service_id !== undefined) refs.push({
          fieldId: primaryFilter.id, serviceId: primaryFilter.service_id,
        });
      }
      const services = refs.flatMap(({ serviceId }) => {
        const service = findService(options.services!, serviceId);
        return service === undefined ? [] : [service];
      });
      if (services.length <= 1) continue;
      const rates = services.flatMap(({ rate }) => rate === null ? [] : [rate]);
      const primaryRate = rates.length === 0 ? undefined : Math.max(...rates);
      if (!services.some(({ rate }) => !serviceRateMatchesPolicy(rate, primaryRate, options.rate_policy ?? undefined))) continue;
      const serviceIds = services.map(({ id }) => id);
      const signature = `${context.filterId}:${serviceIds.map(String).sort().join(",")}`;
      if (reported.has(signature)) continue;
      reported.add(signature);
      diagnostics.push(diagnostic(
        "service_rate_incoherent", "error", nodePath(index, refs[1]?.fieldId ?? refs[0]!.fieldId),
        `Co-selectable services in ${context.filterId} violate the configured catalog rate policy.`,
        { filter_id: context.filterId, service_ids: serviceIds, trigger_ids: context.triggerIds },
        refs.slice(1).map(({ fieldId }) => nodePath(index, fieldId)),
      ));
  }
}

function validateFallbackEligibility(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  options: SemanticValidationOptions,
): void {
  if (definition.fallbacks === null || options.services === undefined || options.fallback_policy == null) return;
  for (const [nodeId, candidates] of Object.entries(definition.fallbacks.nodes ?? {})) {
    const path = `/fallbacks/nodes/${escapePointerSegment(nodeId)}`;
    const contexts = serviceNodeContexts(index, nodeId);
    if (contexts.length !== 1) {
      diagnostics.push(diagnostic(
        "fallback_context_unresolved", "error", path,
        `Fallback node ${nodeId} does not resolve to one unambiguous filter context.`,
        { node_id: nodeId, filter_ids: contexts },
      ));
      continue;
    }
    const rows = resolveFallbackEligibilityForNode(
      index.core, nodeId, candidates, options.services, {
        require_capability_fit: options.fallback_policy.require_capability_fit,
        rate_policy: options.fallback_policy.rate_policy,
      },
    );
    if (rows.some(({ reasons }) => reasons.includes("capability_mismatch"))) diagnostics.push(diagnostic(
      "fallback_capability_ineligible", "error", path,
      `A fallback for ${nodeId} does not satisfy the effective capability requirements.`,
      { node_id: nodeId },
    ));
    if (rows.some(({ reasons }) => reasons.includes("rate_mismatch"))) diagnostics.push(diagnostic(
      "fallback_rate_ineligible", "error", path,
      `A fallback for ${nodeId} violates the configured catalog rate policy.`,
      { node_id: nodeId },
    ));
  }
}

function validateUtilityCompleteness(
  definition: ProductDefinition,
  index: SemanticIndex,
  diagnostics: ProductDefinitionDiagnostic[],
  contexts: readonly ReachableContext[],
): void {
  definition.fields.forEach((field, fieldIndex) => {
    if (field.pricing_role === "utility" && field.utility === undefined) diagnostics.push(diagnostic(
      "utility_definition_missing", "error", `/fields/${fieldIndex}/utility`,
      `Utility field ${field.id} requires a utility definition.`, { field_id: field.id },
    ));
    for (const visit of walkFieldOptions(field)) {
      if (visit.option.pricing_role === "utility" && visit.option.utility === undefined) diagnostics.push(diagnostic(
        "utility_definition_missing", "error", `${index.options.get(visit.optionId)?.path ?? `/fields/${fieldIndex}/options`}/utility`,
        `Utility option ${visit.optionId} requires a utility definition.`, { option_id: visit.optionId },
      ));
    }
  });

  const reported = new Set<string>();
  for (const context of contexts) {
    const visibleFields = context.fieldIds.flatMap((id) => {
      const field = index.fields.get(id)?.value;
      return field === undefined ? [] : [field];
    });
    const hasUtility = visibleFields.some((field) => field.utility !== undefined || field.pricing_role === "utility"
      || walkFieldOptions(field).some(({ option }) => option.utility !== undefined || option.pricing_role === "utility"));
    if (!hasUtility) continue;
    const lineageHasBase = index.core.filterLineage(context.filterId).some(
      (filter) => filter.service_id !== undefined,
    );
    const visibleHasBase = visibleFields.some((field) =>
      field.pricing_role !== "utility" && (field.button === true && field.service_id !== undefined
        || walkFieldOptions(field).some(({ option }) => option.service_id !== undefined && option.pricing_role !== "utility")));
    if (!lineageHasBase && !visibleHasBase && !reported.has(context.filterId)) {
      reported.add(context.filterId);
      diagnostics.push(diagnostic(
        "utility_base_missing", "error", `/filters/${index.filters.get(context.filterId)?.index ?? 0}`,
        `Filter context ${context.filterId} exposes advisory utilities without a reachable base service.`,
        { filter_id: context.filterId },
      ));
    }
  }
}

export function validateProductDefinitionSemantics(
  definition: ProductDefinition,
  options: SemanticValidationOptions = {},
): ProductDefinitionDiagnostic[] {
  const diagnostics: ProductDefinitionDiagnostic[] = [];
  const index = createSemanticIndex(definition);
  const contexts = reachableContexts(definition, index);
  validateIdentity(definition, index, diagnostics);
  validateBindingsAndCycles(definition, index, diagnostics);
  validateRelationshipsAndEffects(definition, index, diagnostics);
  validateCustomerAndQuantityRules(definition, diagnostics);
  validateCapabilitiesAndServices(definition, index, diagnostics, options.services);
  validateFallbacks(definition, index, diagnostics, options.services);
  validateUtilities(definition, index, diagnostics);
  validateLabelsReachabilityAndRoots(definition, index, diagnostics, contexts);
  validateServiceInputAndQuantityContexts(definition, index, diagnostics, contexts);
  validateValueEffectValuesAndReachability(definition, index, diagnostics);
  validateVisibilityInvalidationCycles(definition, index, diagnostics);
  validateValueActivationCycles(definition, index, diagnostics);
  validateFieldRegistry(definition, diagnostics, options.field_registry);
  validateCatalogCoherence(definition, index, diagnostics, options);
  validateContextualRates(index, diagnostics, options, contexts);
  validateFallbackEligibility(definition, index, diagnostics, options);
  validateUtilityCompleteness(definition, index, diagnostics, contexts);
  return sortDiagnostics(diagnostics);
}
