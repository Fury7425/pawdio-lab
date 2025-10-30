# PiChat Architecture

PiChat is organized as a Yarn workspace monorepo that separates platform-specific concerns (the React Native mobile application) from reusable domain logic (crypto, network, storage, and UI packages).

## Layered Overview

1. **Presentation** – React Native screens and components composed from the shared UI kit. Zustand stores provide local state orchestration.
2. **Application** – Services inside `apps/mobile/src/services` orchestrate workflows like onboarding, contact exchange, and message handling by composing lower-level packages.
3. **Domain Packages**:
   - `@pichat/crypto` wraps `libsignal-protocol.js` and `@stablelib/xchacha20poly1305` to manage identity, session bootstrap, and attachment encryption.
   - `@pichat/network` configures js-waku LightNode instances, topic derivation, and message publication/subscription hooks.
   - `@pichat/storage` defines Realm object schemas and repository helpers that serialize encrypted payloads.
   - `@pichat/ui` exports the design-system primitives powered by tokens from `apps/mobile/src/theme`.
   - `@pichat/utils` centralizes logging, codec helpers, and ULID generation.
   - `@pichat/types` supplies shared TypeScript type definitions consumed across workspaces.

## Data Flow

1. On first launch the onboarding flow invokes `cryptoClient.initializeIdentity` which persists the `Identity` document in Realm using `@pichat/storage` and schedules pre-key refresh operations.
2. When a user adds a contact, the QR payload is parsed, fingerprint verification is requested, and the `Contact`/`Conversation` models are persisted.
3. Sending a message triggers `messageService.send` which ensures a Signal session via `@pichat/crypto`, encrypts the plaintext, writes a pending `Message` entry, and publishes the ciphertext using `@pichat/network`.
4. Incoming messages arrive through a Waku subscription callback, are decrypted, persisted, and the unread state is updated in Zustand.
5. Attachments are encrypted client-side with XChaCha20-Poly1305; only the wrapped key is embedded in the Signal message payload.

## Platform Integrations

- **Realm** for persistent object storage and offline cache. Schemas include indexes to optimize conversation queries.
- **React Navigation** for stack navigation. Screens are typed using `@react-navigation/native` generics.
- **Detox** for black-box E2E tests covering onboarding, contact pairing, and messaging.

## Build & CI

The Android GitHub Actions workflow installs the toolchain, configures signing credentials via secrets, and produces both APK and AAB artifacts for distribution.

