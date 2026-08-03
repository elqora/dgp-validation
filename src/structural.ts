// SPDX-License-Identifier: GPL-3.0-only

import productDefinitionSchema from "@elqora/dgp-spec/schemas/product-definition.schema.json" with { type: "json" };
import type { ProductDefinition, ProductDefinitionDiagnostic } from "@elqora/dgp-spec";
import { Ajv, type ErrorObject } from "ajv";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

import { diagnostic, escapePointerSegment, sortDiagnostics } from "./diagnostics.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const addFormats = addFormatsModule as unknown as FormatsPlugin;
addFormats(ajv);
const validateSchema = ajv.compile(productDefinitionSchema);

function codeForError(error: ErrorObject): ProductDefinitionDiagnostic["code"] {
  if (error.keyword === "required") return "schema_required_property";
  if (error.keyword === "type") return "schema_invalid_type";
  if (error.keyword === "additionalProperties") return "schema_unknown_property";
  return "schema_invalid_value";
}

function pathForError(error: ErrorObject): string {
  if (error.keyword === "required") {
    const property = String(error.params.missingProperty ?? "");
    return `${error.instancePath}/${escapePointerSegment(property)}`;
  }
  if (error.keyword === "additionalProperties") {
    const property = String(error.params.additionalProperty ?? "");
    return `${error.instancePath}/${escapePointerSegment(property)}`;
  }
  return error.instancePath;
}

export function validateProductDefinitionStructure(input: unknown): ProductDefinitionDiagnostic[] {
  if (validateSchema(input)) return [];
  return sortDiagnostics((validateSchema.errors ?? []).map((error) => diagnostic(
    codeForError(error),
    "error",
    pathForError(error),
    error.message === undefined ? "ProductDefinition does not match its canonical schema." : `Schema ${error.message}.`,
    { keyword: error.keyword, schema_path: error.schemaPath, params: error.params },
  )));
}

export function isProductDefinition(input: unknown): input is ProductDefinition {
  return validateSchema(input);
}
