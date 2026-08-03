# Agent guidance: DGP Validation

Read and follow `../AGENTS.md` before working in this repository.

## Role

This repository validates canonical DGP `ProductDefinition` documents for editorial tools, publication pipelines, CI, backends, and future SDKs. It reports structural and semantic correctness through stable diagnostics.

## Dependencies

- May depend on sibling `dgp-spec` for contracts, diagnostic identifiers, and conformance fixtures.
- May depend on sibling `dgp-core` only when a validation rule genuinely requires its framework-neutral graph or resolution primitive; document that justification.
- Must not depend on Ordering, the Form Palette adapter, Workspace, Studio, React, or a host application.
- Ordering must never depend on Validation.

## Boundaries

- Validate canonical v1 definitions only. Do not accept or convert legacy definitions and do not add aliases, deprecated fields, or compatibility modes.
- Validate expression declaration shape, required metadata, and declared return expectations without executing browser JavaScript.
- Report definition correctness and coherence with structured diagnostic codes owned by Spec.
- Keep host publication policy extensible and separate from universal DGP rules.
- Do not perform customer ordering, advisory utility calculation, pricing, or fulfillment.
- Do not expose editorial diagnostics to customers or render diagnostic UI.
- Treat `meta` as an opaque host-owned object; validate only its protocol-level JSON-object shape.

## Authority

Spec owns shared representation and diagnostic identifiers; SDK owns backend domain semantics; legacy validators supply behavior evidence to retain or improve. Validation owns validation behavior within its boundary and must not redefine shared contracts.

Ratified means the versioned plain TypeScript contract, required JSON fixtures, rationale, and stable status are merged into `dgp-spec/main`; generated JSON Schemas must also be current once tooling exists. Released means that ratified Spec version is tagged and published. Validation may implement ratified unreleased contracts, but stable releases require the corresponding released Spec version.

## Change workflow and operations

- Update Validation only after Spec ratification and the required Core/SDK conformance work.
- Commit and release this repository independently before affected higher-level consumers are released.
- This repository has no implementation manifest or operational commands yet. Do not invent install, test, lint, type-check, build, or generation commands.
- When its toolchain is introduced, document all real commands, supported runtimes, generated-output policy, completion criteria, and checks for forbidden Ordering/framework dependencies, legacy fields, and diagnostic/fixture drift.

## References

- Spec authority: sibling `../dgp-spec`.
- Shared-contract guide: sibling `../dgp-spec/CONTRACTS.md`.
- Optional interpretation dependency: sibling `../dgp-core`.
- Backend evidence: sibling `../dgp-sdk`.
- Legacy validation evidence: `D:\Projects\GitHub\digital-service-ui-builder\src\core\validate`.
- Studio source evidence: `D:\Projects\GitHub\service-builder`; destination: sibling `../dgp-studio`.
- Siblings: `../dgp-ordering`, `../dgp-ordering-form-palette`, and `../dgp-workspace`.

This repository remains GPL-3.0-only. Future manifests and source headers must use that exact SPDX identifier.
