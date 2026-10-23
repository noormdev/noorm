---
entity: invoice
group: billing
pk:
  - party_id
  - invoice_no
columns:
  party_id:
    type: integer
  invoice_no:
    type: integer
  issued_at:
    type: datetime
    default: now
examples:
  - party_id: 2
    invoice_no: 1
    issued_at: "2026-03-05T14:25:00Z"
relationships:
  - target: party
    on:
      party_id: party_id
    predicate: { fwd: owes on, rev: is owed by }
---

# invoice

A bill a [[party]] owes on.
