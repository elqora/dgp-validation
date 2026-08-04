# Agent guidance: DGP Validation

Read and follow `../AGENTS.md` before working in this repository.

## Role

This repository provides full-scale validation of canonical DGP `ProductDefinition` documents for editorial tools, publication pipelines, CI, backends, and future SDKs. It preserves the structural, contextual, semantic, catalog-aware, and policy behavior proven by the legacy validator while reporting through stable diagnostics.

## Dependencies

- May depend on sibling `dgp-spec` for contracts, diagnostic identifiers, and conformance fixtures.
- May depend on sibling `dgp-core` only when a validation rule genuinely requires its framework-neutral graph or resolution primitive; document that justification.
- Must not depend on Ordering, the Form Palette adapter, Workspace, Studio, React, or a host application.
- Ordering must never depend on Validation.

## Boundaries

- Validate canonical v1 definitions only. Do not accept or convert legacy definitions and do not add aliases, deprecated fields, or compatibility modes.
- Validate expression declaration shape, required metadata, and declared return expectations without executing browser JavaScript.
- Report definition correctness and coherence with structured diagnostic codes owned by Spec.
- Keep host publication policy extensible and separate from universal DGP rules. Preserve proven host-specific checks as reusable optional rules or policy packs rather than discarding them.
- Validate identity, bindings, reachability, context-sensitive visibility and effects, service and capability fit, fallback coherence and eligibility, utility configuration, rate coherence, and publication policy wherever the required catalog or host inputs are supplied.
- SDK handlers remain authoritative for final pricing and charges. This does not prohibit publication-time validation of coherent use of SDK-provided rates, services, capabilities, bounds, and fallback data.
- Do not perform customer ordering, construct advisory utility results, calculate authoritative prices or charges, or perform fulfillment.
- Do not expose editorial diagnostics to customers or render diagnostic UI.
- Treat `meta` as an opaque host-owned object; validate only its protocol-level JSON-object shape.

## Authority

Spec owns shared representation and diagnostic identifiers; SDK owns backend domain semantics; legacy validators supply proven behavior that Validation must preserve by default. Validation owns validation behavior within its boundary and must not redefine shared contracts.

Ratified means the versioned plain TypeScript contract, required JSON fixtures, rationale, and stable status are merged into `dgp-spec/main`; generated JSON Schemas must also be current once tooling exists. Released means that ratified Spec version is tagged and published. Validation may implement ratified unreleased contracts, but stable releases require the corresponding released Spec version.

## Migration completeness

- Audit every legacy validation step and test. Record its destination, preserved outcome, universal or configurable status, implementation state, and replacement evidence in `MIGRATION.md`.
- Default to preservation. A rule that needs a service catalog, rate policy, field registry, or host policy becomes a reusable optional validator or policy pack; it is not implicitly retired.
- Context-sensitive validation must evaluate reachable product states rather than replace proven behavior with a shallow global approximation.
- Redesign or retirement of a proven diagnostic outcome requires explicit recorded user approval and the corresponding Spec diagnostic/fixture decision.
- Mark missing checks as **pending migration**. Do not describe the package as complete or publish another stable release until the full legacy inventory is classified and all preserved behavior is tested.

## Change workflow and operations

- Update Validation only after Spec ratification and the required Core/SDK conformance work.
- Commit and release this repository independently before affected higher-level consumers are released.
- Supported runtime: Node.js 22 or newer; package manager: npm.
- Install with `npm install`; run tests with `npm test`, lint with `npm run lint`, strict type checking with `npm run typecheck`, boundary enforcement with `npm run check:boundaries`, and the distributable build with `npm run build`.
- `npm run check` is the repository verification command and must pass before commit or release; it is not by itself evidence of migration completeness.
- `dist/` is generated and not committed. Validation consumes Spec's committed ProductDefinition JSON Schema and diagnostic types; it does not generate or author shared contracts.
- The Core dependency is justified only for canonical indexing, recursive-option traversal, graph context, capability inheritance, and service binding. Validation must not duplicate those interpreter rules locally.
- Boundary enforcement must continue to reject Ordering, UI/framework dependencies, independently authored shared types, and forbidden legacy fields.

## References

- Spec authority: sibling `../dgp-spec`.
- Shared-contract guide: sibling `../dgp-spec/CONTRACTS.md`.
- Optional interpretation dependency: sibling `../dgp-core`.
- Backend evidence: sibling `../dgp-sdk`.
- Legacy validation evidence: `D:\Projects\GitHub\digital-service-ui-builder\src\core\validate`.
- Studio source evidence: `D:\Projects\GitHub\service-builder`; destination: sibling `../dgp-studio`.
- Siblings: `../dgp-ordering`, `../dgp-ordering-form-palette`, and `../dgp-workspace`.

This repository remains GPL-3.0-only. Future manifests and source headers must use that exact SPDX identifier.
