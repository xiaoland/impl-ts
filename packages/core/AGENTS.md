# @inkcre/core

Shared models, Peer protocols, storage/resolver mechanics, and native Extension Host contracts.

## Owners

- Package role and cross-package flows: `../../ARCHITECTURE.md`.
- Client runtime and delegation: `../../docs/30-unit-tdd/client-runtime-and-delegation.md`.
- Info-Base hydration, storage, Resolver outcomes, and browser handles: `../../docs/30-unit-tdd/info-base.md`.
- Native Extension Host and lifecycle: `../../docs/30-unit-tdd/native-extension-runtime.md`.
- Shared cross-unit contracts: `../../docs/_shared/20-product-tdd/`.

## Local Hazards

- Keep one domain model and request/response authority. UI consumers import core contracts instead of reconstructing parallel shapes.
- Keep Peer transport generic and capability managers domain-specific. Never retry ambiguous dispatch or silently substitute a different exact target.
- Preserve exact, versioned Resolver IDs and the distinction between unknown, unsupported, supported-null, and authored-empty outcomes.
- Treat storage content as opaque bytes/pointers; Resolver semantics and browser runtime handles remain separate.
- `database.generated.ts` is generated from impl-py's admitted schema artifact; `generated.ts` and runtime-contract adapters are the stable local boundary. Do not hand-edit generated projections.
- Keep runtime source and ESM distribution free of environment profiles, service origins, Peer identity, and credentials. Do not add CommonJS without a named consumer and explicit contract change.
- Preserve Extension lifecycle compensation across `initialize`, `activate`, `deactivate`, and `dispose`.

## Checks

- `pnpm --filter @inkcre/core type-check`
- `pnpm --filter @inkcre/core build`
- `pnpm lint:type-aware`
- `pnpm type-check`
- `pnpm check`
