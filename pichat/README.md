# PiChat

PiChat is a privacy-first, decentralized, end-to-end encrypted messenger built on Waku v2 and the Signal Protocol. This monorepo contains the mobile application, shared packages, infrastructure configuration, documentation, and design system.

## Getting Started

```bash
yarn bootstrap
```

### Development Scripts

- `yarn mobile:android` – build the Android app (delegates to `apps/mobile`).
- `yarn lint` – run ESLint across all workspaces.
- `yarn typecheck` – run TypeScript in each workspace.
- `yarn test` – execute unit and component tests.
- `yarn e2e` – execute Detox tests for the mobile app.

## Packages

- `@pichat/types` – shared TypeScript types for core models and DTOs.
- `@pichat/utils` – logging, time helpers, codec utilities.
- `@pichat/crypto` – Signal identity management, recovery, attachment encryption.
- `@pichat/network` – js-waku integration for decentralized messaging.
- `@pichat/storage` – Realm schemas and repositories.
- `@pichat/ui` – design-system powered component primitives.

## Mobile App

The React Native application lives in `apps/mobile` and composes the shared packages for a cohesive experience with onboarding, contact exchange, secure chat, and recovery flows.

## Documentation

- `docs/architecture.md` – technical overview.
- `docs/threat-model.md` – summarized threat model.
- `docs/figma.md` – design system description and component catalog.

## License

Apache 2.0 © PiChat Contributors
