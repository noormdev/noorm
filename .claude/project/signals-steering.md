# Signals steering
#
# User-provided hints for the signals inferrer. When this file exists,
# the inferrer reads it before writing signals.md and treats its
# content as ground truth — steering wins over detection when they
# conflict. Delete sections you don't need.
#
# ## Framework
# NestJS monorepo (not plain Express)
#
# ## Domains
# - src/billing/ and src/payments/ are one domain ("payments")
# - src/internal-tools/ is scratch code — not a real domain
#
# ## Build
# - Build: pnpm turbo build
# - Test: pnpm test:ci (not pnpm test — that runs watch mode)
#
# ## Ignore for domains
# - vendor/
# - generated/
