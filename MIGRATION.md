# Validation migration evidence

The initial DGP Validation slice retains only legacy checks that remain universal publication concerns under the clean v1 ownership model.

| Concern | Legacy evidence | DGP v1 disposition |
| --- | --- | --- |
| Identity and binding | `src/core/validate/steps/identity.ts`, `structure.ts` | Retain duplicate IDs/names, unknown bindings, and hierarchy-cycle checks using canonical IDs and JSON Pointer paths. |
| Option and visibility maps | `option-maps.ts`, `visibility-cycles.ts` | Retain reference, ownership, include/exclude conflict, and dependency-cycle checks for canonical snake-case rules. |
| Value effects | `value-effects.ts` | Retain target, conflicting declaration, and dependency-cycle diagnostics; never apply customer state in Validation. |
| Capability inheritance | legacy constraint propagation/validation | Redesign as authored `capabilities`; report ignored descendant conflicts while Core calculates effective values without mutation. |
| Service fit | legacy service filtering | Retain optional catalog existence and capability-fit checks. Retire frontend rate comparisons and final-pricing assumptions. |
| Fallbacks | fallback validation tests | Retain registration reference, primary, duplicate, self-reference, candidate, and cycle coherence. Rates and operational eligibility remain backend concerns. |
| Utilities | utility validation tests | Retain utility/service-role separation and base-service presence. Exact advisory arithmetic belongs to Ordering. |
| Expressions | field/quantity validation tests | Validate declaration shape through Spec schema only; never execute JavaScript here. |

Retired from universal validation: custom-component resolution, legacy normalization, `flags`, `estimates`, derived constraint fields, frontend rate authority, Form Palette details, editorial presentation, and customer-facing diagnostics.
