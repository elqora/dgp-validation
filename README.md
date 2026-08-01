# DGP Validation

DGP Validation provides portable structural and semantic validation for Digital Goods Protocol product definitions. It is intended for editorial feedback, backend ingestion, publication gates, CI, and future language SDKs.

Ordering does not depend on this package. Customer-facing runtimes consume definitions that have already passed publication validation.

## Responsibilities

- Structural protocol validation against DGP Spec
- Identity, reference, graph, visibility, effect, service-binding, fallback, and coherence diagnostics
- Stable machine-readable validation results
- Shared behavior compatible with DGP conformance fixtures

Host-specific publication policy remains an extension and is not a universal DGP rule.

## Ecosystem

- [DGP Spec](https://github.com/elqora/dgp-spec) owns canonical contracts and fixtures.
- [DGP Core](https://github.com/elqora/dgp-core) supplies interpretation primitives.
- [DGP Ordering](https://github.com/elqora/dgp-ordering) consumes published definitions without this dependency.
- [DGP Workspace](https://github.com/elqora/dgp-workspace) orchestrates editorial sessions and publication state.
- [DGP Studio](https://github.com/elqora/dgp-studio) presents diagnostics and publication readiness to editors.
- [DGP SDK](https://github.com/elqora/dgp-sdk) is the backend protocol reference.
- [Digital Service Engine](https://github.com/timeax/digital-service-engine) is the legacy migration source and behavioral reference.

## Status

Repository scaffold only. Validation extraction and migration will be planned separately.

## License

GPL-3.0.
