# Agent guidance: DGP Validation

Read and follow `../AGENTS.md` before working in this repository.

## Role

This repository implements reusable product-definition validation for editorial tools, backend publication pipelines, CI, and future SDKs.

## Dependencies

- May depend on sibling `dgp-spec` for contracts and conformance fixtures.
- May depend on sibling `dgp-core` for framework-neutral graph and resolution primitives.
- Must not depend on `dgp-ordering`, `dgp-workspace`, React, Studio, or a host application.

## Boundaries

- Report definition correctness and coherence with structured diagnostics.
- Validate the declared shape and required metadata of browser JavaScript expressions where specified, but do not make executing JavaScript a cross-language validation requirement.
- Studio owns interactive expression execution, previews, test cases, and author feedback before publication.
- Do not perform customer ordering or expose editorial diagnostics to customers.
- Keep host publication policy extensible and separate from universal DGP rules.
- Do not render diagnostic consoles or other editorial UI.

## References

- Legacy validation source: `D:\Projects\GitHub\digital-service-ui-builder\src\core\validate`.
- Current Studio diagnostics and expression-testing reference: `D:\Projects\GitHub\service-builder`.
- Backend reference: sibling `../dgp-sdk` at `D:\Projects\GitHub\elqora\digital-goods-protocol\dgp-sdk`.
- Sibling repositories: `../dgp-spec`, `../dgp-core`, `../dgp-ordering`, and `../dgp-workspace`.
