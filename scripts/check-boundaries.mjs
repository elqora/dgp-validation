import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const allowedDependencies = new Set(["@elqora/dgp-spec", "@elqora/dgp-core", "ajv", "ajv-formats"]);
const errors = [];

for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
  if (!allowedDependencies.has(dependency)) errors.push(`Forbidden runtime dependency ${dependency}.`);
}

const canonicalTypeNames = new Set([
  "ProductDefinition",
  "ProductFilter",
  "ProductField",
  "FieldOption",
  "ProductDefinitionDiagnostic",
  "ProductDefinitionValidationResult",
]);
const forbiddenTerms = /\b(flags|estimates|constraints_origin|constraints_overrides|component)\b/;
const sourceFiles = (await readdir(path.join(root, "src"), { recursive: true }))
  .filter((entry) => entry.endsWith(".ts"))
  .map((entry) => path.join("src", entry));

for (const relativePath of sourceFiles) {
  const absolutePath = path.join(root, relativePath);
  const sourceText = await readFile(absolutePath, "utf8");
  const source = ts.createSourceFile(absolutePath, sourceText, ts.ScriptTarget.Latest, true);

  for (const match of sourceText.matchAll(new RegExp(forbiddenTerms, "g"))) {
    const position = source.getLineAndCharacterOfPosition(match.index ?? 0);
    errors.push(`${relativePath}:${position.line + 1} contains forbidden legacy field ${match[0]}.`);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const moduleName = node.moduleSpecifier.getText(source).replaceAll(/["']/g, "");
      if (!moduleName.startsWith(".") && ![...allowedDependencies].some((name) => moduleName === name || moduleName.startsWith(`${name}/`))) {
        errors.push(`${relativePath}:${source.getLineAndCharacterOfPosition(node.pos).line + 1} imports forbidden package ${moduleName}.`);
      }
    }
    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && canonicalTypeNames.has(node.name.text)) {
      errors.push(`${relativePath}:${source.getLineAndCharacterOfPosition(node.pos).line + 1} independently authors canonical type ${node.name.text}.`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (errors.length > 0) throw new Error(`Validation boundary violations:\n${errors.join("\n")}`);
console.log("Validation dependency and source boundaries are valid.");
