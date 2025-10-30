# PiChat Threat Model

## Assets
- **Identity keys**: long-term identity key pair stored in the OS-protected keystore and referenced via opaque handles.
- **Pre-keys**: signed pre-key and one-time pre-keys cached in Realm for X3DH bootstrapping.
- **Session state**: Double Ratchet secrets stored encrypted at rest.
- **Messages**: ciphertext bodies and metadata required for ordering.
- **Attachments**: encrypted blobs and symmetric keys.

## Adversaries
- **Passive network observer**: can sniff packets but cannot break Signal encryption.
- **Compromised Waku relay**: can read topics and replay messages but receives only ciphertext.
- **Stolen device attacker**: gains physical access to the handset.

## Controls
- **End-to-end encryption**: Signal Protocol (X3DH + Double Ratchet) for all messages and attachment keys.
- **Fingerprint verification**: users compare emoji/word fingerprints before chatting.
- **OS keystore**: private keys and pre-key secrets stored using platform secure storage APIs.
- **Recovery Kit**: exported with Argon2id passphrase-based encryption to resist brute force.
- **In-app lock**: biometric/PIN gate protects the UI; inactivity triggers automatic lock.
- **Notifications**: display sender alias only, no plaintext payloads.
- **Local wipe**: optional wipe after configurable failed unlock attempts.

## Assumptions & Residual Risk
- Devices are free of malware at time of setup.
- Users keep passphrases secret and store Recovery Kits offline.
- Metadata leakage (timing, topic subscription) is partially mitigated but not eliminated by Waku.
