// SPDX-License-Identifier: GPL-3.0-only

import type { FieldOption, ProductDefinition, ProductField, ProductFilter } from "@elqora/dgp-spec";
import { createProductIndex, type ProductIndex } from "@elqora/dgp-core";

export interface LocatedFilter { value: ProductFilter; path: string; index: number }
export interface LocatedField { value: ProductField; path: string; index: number }
export interface LocatedOption { value: FieldOption; field: ProductField; path: string }

export interface SemanticIndex {
  core: ProductIndex;
  filters: ReadonlyMap<string, LocatedFilter>;
  fields: ReadonlyMap<string, LocatedField>;
  options: ReadonlyMap<string, LocatedOption>;
  nodePaths: ReadonlyMap<string, string>;
  duplicateNodes: Array<{ id: string; path: string; firstPath: string }>;
}

export function createSemanticIndex(definition: ProductDefinition): SemanticIndex {
  const filters = new Map<string, LocatedFilter>();
  const fields = new Map<string, LocatedField>();
  const options = new Map<string, LocatedOption>();
  const nodePaths = new Map<string, string>();
  const duplicateNodes: Array<{ id: string; path: string; firstPath: string }> = [];

  const recordNode = (id: string, path: string): void => {
    const firstPath = nodePaths.get(id);
    if (firstPath === undefined) nodePaths.set(id, path);
    else duplicateNodes.push({ id, path, firstPath });
  };

  definition.filters.forEach((value, index) => {
    const path = `/filters/${index}`;
    recordNode(value.id, path);
    if (!filters.has(value.id)) filters.set(value.id, { value, path, index });
  });
  definition.fields.forEach((value, index) => {
    const path = `/fields/${index}`;
    recordNode(value.id, path);
    if (!fields.has(value.id)) fields.set(value.id, { value, path, index });

    const visit = (items: readonly FieldOption[] | undefined, parentPath: string): void => {
      for (const [optionIndex, option] of (items ?? []).entries()) {
        const optionPath = `${parentPath}/${optionIndex}`;
        recordNode(option.id, optionPath);
        if (!options.has(option.id)) options.set(option.id, { value: option, field: value, path: optionPath });
        visit(option.children, `${optionPath}/children`);
      }
    };
    visit(value.options, `${path}/options`);
  });

  return { core: createProductIndex(definition), filters, fields, options, nodePaths, duplicateNodes };
}

export function triggerOwnerField(index: SemanticIndex, triggerId: string): ProductField | undefined {
  const field = index.fields.get(triggerId)?.value;
  if (field !== undefined) return field.button === true ? field : undefined;
  return index.options.get(triggerId)?.field;
}
