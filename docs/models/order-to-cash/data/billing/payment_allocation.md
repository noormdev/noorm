---
entity: payment_allocation
group: billing
pk:
  - party_id
  - payment_no
  - invoice_no
  - line_no
columns:
  party_id:
    type: integer
  payment_no:
    type: integer
  invoice_no:
    type: integer
  line_no:
    type: integer
  amount:
    type: decimal
examples:
  - party_id: 2
    payment_no: 1
    invoice_no: 1
    line_no: 1
    amount: 49.00
  - party_id: 2
    payment_no: 1
    invoice_no: 1
    line_no: 2
    amount: 89.00
relationships:
  - target: payment
    on:
      party_id: party_id
      payment_no: payment_no
    predicate: { fwd: is applied as, rev: is drawn from }
  - target: invoice_line
    on:
      party_id: party_id
      invoice_no: invoice_no
      line_no: line_no
    predicate: { fwd: is settled by, rev: settles }
---

# payment_allocation

How much of a [[payment]] settles which [[invoice_line]]. Both parents contribute `party_id` to one column, so a payment from party 1 cannot settle party 2's invoice. The schema enforces that with two foreign keys and no trigger.
