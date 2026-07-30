---
"@noormdev/cli": major
"@noormdev/sdk": major
---

## Identity and state key handling fail closed

### Fixed

* `fix(identity)!:` malformed key material is rejected instead of deriving a publicly computable key. `Buffer.from(key, 'hex')` never throws, so any non-hex private key collapsed to a zero-length HKDF input and produced a **constant** AES key — an attacker holding no key material could decrypt a real `state.enc`. `isValidKeyHex` existed but was only called on the CI path; it now guards every entry point.
* `fix(ci)!:` `ci identity enroll` verifies the stored public key matches the one presented. It checked only that a row existed, so anyone able to INSERT into `noorm.identities` — no vault access required — could pre-plant their own key and receive the vault key, while the operator's enrollment reported success and echoed back the expected key.
* `fix(identity)!:` `identity init --force` requires `--yes`, backs up the keypair, and names what it destroys. It silently regenerated the keypair and permanently destroyed every project's `state.enc`.
* `fix(ci):` `ci init --force` backs up `state.enc` and refuses on a TTY without confirmation; it destroyed all configs and secrets unprompted. It also now routes through `parseConfig`, so a numeric-looking database name persists as a string.
* `fix(vault)!:` `vault propagate` names every recipient and withholds until confirmed, and reports partial failures instead of returning success with the failed identity silently omitted.
* `fix(sdk):` an explicit identity scope whose revert fails is no longer marked reverted, and `disconnect()` no longer hangs when scopes are still held.
