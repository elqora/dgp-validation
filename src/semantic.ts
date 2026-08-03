// SPDX-License-Identifier: GPL-3.0-only

import type {
  HandlerService,
  ProductDefinition,
  ProductDefinitionDiagnostic,
  ProductField,
  ServiceId,
} from "@elqora/dgp-spec";
import {
  findService,
  resolveCapabilities,
  resolveServiceBindingsWithIndex,
  serviceBindingForNode,
  serviceCapabilityEnabled,
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

  const visibilityEdges = new Map<string, string[]>();
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
          && owner !== undefined
          && mapName === "includes_for_buttons") addEdge(visibilityEdges, owner.id, fieldId);
      });
    }
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
      if (rule.force_visible === true && owner !== undefined) addEdge(visibilityEdges, owner.id, targetFieldId);
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

  const valueEdges = new Map<string, string[]>();
  const effectsByTarget = new Map<string, Array<{ triggerId: string; path: string; signature: string }>>();
  for (const [triggerId, targetRules] of Object.entries(definition.value_effects_for_triggers)) {
    const triggerPath = pointerMapPath("value_effects_for_triggers", triggerId);
    const owner = validateTrigger(index, diagnostics, triggerId, triggerPath);
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
      if (owner !== undefined) addEdge(valueEdges, owner.id, targetFieldId);
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

  for (const [code, edges] of [
    ["visibility_dependency_cycle", visibilityEdges],
    ["value_effect_cycle", valueEdges],
  ] as const) {
    for (const cycle of stronglyConnectedCycles(edges)) diagnostics.push(diagnostic(
      code,
      "error",
      index.fields.get(cycle[0]!)?.path ?? "/fields",
      `${code === "visibility_dependency_cycle" ? "Visibility" : "Value-effect"} dependencies contain a cycle: ${cycle.join(" -> ")}.`,
      { field_ids: cycle },
      cycle.slice(1).flatMap((id) => {
        const field = index.fields.get(id);
        return field === undefined ? [] : [field.path];
      }),
    ));
  }
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

export function validateProductDefinitionSemantics(
  definition: ProductDefinition,
  options: SemanticValidationOptions = {},
): ProductDefinitionDiagnostic[] {
  const diagnostics: ProductDefinitionDiagnostic[] = [];
  const index = createSemanticIndex(definition);
  validateIdentity(definition, index, diagnostics);
  validateBindingsAndCycles(definition, index, diagnostics);
  validateRelationshipsAndEffects(definition, index, diagnostics);
  validateCapabilitiesAndServices(definition, index, diagnostics, options.services);
  validateFallbacks(definition, index, diagnostics, options.services);
  validateUtilities(definition, index, diagnostics);
  return sortDiagnostics(diagnostics);
}
