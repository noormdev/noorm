---
'@noormdev/cli': minor
'@noormdev/sdk': minor
---

On a trusted `isTest: true` config, every role, agents included, gets at least admin's permissions, so an agent can build and test against its own test database. Configs without `isTest` are unchanged.
