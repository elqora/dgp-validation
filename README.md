# DGP Validation

DGP Validation provides portable structural and semantic validation for Digital Goods Protocol product definitions. It is intended for editorial feedback, backend ingestion, publication gates, CI, and future language SDKs.

Ordering does not depend on this package. Customer-facing runtimes consume definitions that have already passed publication validation.

## Responsibilities

- Structural protocol validation against DGP Spec
- Identity, reference, graph, visibility, effect, capability, service-binding, fallback, utility, and coherence diagnostics
- Stable machine-readable validation results
- Shared behavior compatible with DGP conformance fixtures

Host-specific publication policy remains an extension and is not a universal DGP rule.

Validation never executes browser JavaScript. Expression declarations are checked by the canonical JSON Schema; runtime execution and structured host-configuration failures belong to Ordering.

## Install

Node.js 22 or newer is required.

```sh
npm install @elqora/dgp-validation @elqora/dgp-spec @elqora/dgp-core
```

## Usage

```ts
import { validateProductDefinition, validateForPublication } from "@elqora/dgp-validation";

const result = validateProductDefinition(input, { services });
if (!result.valid) {
  console.error(result.diagnostics);
}

const publication = validateForPublication(input, {
  services,
  field_registry,
  rate_policy,
  fallback_policy,
  policies: [hostPolicy],
});
```

Structural failures use stable schema diagnostics and stop semantic interpretation. Structurally valid documents are then checked for:

- duplicate identities and customer-field names;
- filter hierarchy and binding coherence;
- relationship, trigger, recursive-option, and effect references;
- contradictory relationships, contextual reachability, co-visible labels, and quantity sources;
- visibility invalidation and actual value-effect activation cycles;
- registry type/variant fallback and multi-select support;
- inherited capabilities, optional service-catalog fit, state, and quantity bounds;
- contextual rate coherence under a supplied exact policy;
- fallback registration, cycles, contextual capability fit, and rate eligibility; and
- advisory utility declarations, service separation, and contextual base-service guards.

Supplying a service catalog enables reference, capability, availability, bounds, rate-coherence, and fallback-eligibility checks. These checks validate publication coherence only. Final prices, charges, and fulfillment remain handler authority.

The optional service-policy pack preserves reusable host rules without adding them to the protocol:

```ts
import {
  compileServicePublicationPolicies,
  createServicePublicationPolicies,
  validateForPublication,
} from "@elqora/dgp-validation";

const compiled = compileServicePublicationPolicies(rawHostRules);
const publication = validateForPublication(input, {
  services,
  policies: createServicePublicationPolicies(compiled.policies),
});
```

Compiled rules support global or visible-group scopes; base, utility, or both roles; filter and field allow-lists; metadata predicates; property projections; equality, uniqueness, boolean, and count operators; and host-selected warning or error severity. Configuration diagnostics remain separate from both protocol and publication results.

Canonical protocol diagnostics and host publication diagnostics remain separate. Host policy codes are not added to Spec's stable DGP code family, and a host policy runs only after universal protocol validation succeeds.

## Development

```sh
npm install
npm run lint
npm run typecheck
npm test
npm run check:boundaries
npm run build
npm run check
```

`npm run check` is the repository completion command. It runs linting, strict type checking, tests, dependency/source boundary checks, and the distributable build. `dist/` is generated and not committed.

## Ecosystem

- [DGP Spec](https://github.com/elqora/dgp-spec) owns canonical contracts and fixtures.
- [DGP Core](https://github.com/elqora/dgp-core) supplies interpretation primitives.
- [DGP Ordering](https://github.com/elqora/dgp-ordering) consumes published definitions without this dependency.
- [DGP Ordering Form Palette](https://github.com/elqora/dgp-ordering-form-palette) provides an optional ordering UI integration without becoming a validation dependency.
- [DGP Workspace](https://github.com/elqora/dgp-workspace) orchestrates editorial sessions and publication state.
- [DGP Studio](https://github.com/elqora/dgp-studio) presents diagnostics and publication readiness to editors.
- [DGP SDK](https://github.com/elqora/dgp-sdk) is the backend protocol reference.
- [Digital Service Engine](https://github.com/timeax/digital-service-engine) is the legacy migration source and behavioral reference.

## Status

The complete DGP v1 structural, semantic, catalog-aware, registry-aware, and optional host-policy migration is implemented against ratified unreleased Spec 1.4 and Core 1.1.

## License

GPL-3.0-only.
