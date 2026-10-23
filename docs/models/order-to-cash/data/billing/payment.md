---
entity: payment
group: billing
pk:
  - party_id
  - payment_no
columns:
  party_id:
    type: integer
  payment_no:
    type: integer
  paid_at:
    type: datetime
  amount:
    type: decimal
examples:
  - party_id: 2
    payment_no: 1
    paid_at: "2026-03-09T10:00:00Z"
    amount: 138.00
relationships:
  - target: party
    on:
      party_id: party_id
    predicate: { fwd: makes, rev: is made by }
---

# payment

Money a [[party]] paid.
