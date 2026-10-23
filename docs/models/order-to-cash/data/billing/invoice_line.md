---
entity: invoice_line
group: billing
pk:
  - party_id
  - invoice_no
  - line_no
columns:
  party_id:
    type: integer
  invoice_no:
    type: integer
  line_no:
    type: integer
  order_no:
    type: integer
  order_line_no:
    type: integer
  amount:
    type: decimal
examples:
  - party_id: 2
    invoice_no: 1
    line_no: 1
    order_no: 1
    order_line_no: 1
    amount: 49.00
  - party_id: 2
    invoice_no: 1
    line_no: 2
    order_no: 1
    order_line_no: 2
    amount: 89.00
relationships:
  - target: invoice
    on:
      party_id: party_id
      invoice_no: invoice_no
    predicate: { fwd: contains, rev: is part of }
  - target: order_line
    on:
      party_id: party_id
      order_no: order_no
      order_line_no: line_no
    predicate: { fwd: is billed by, rev: bills }
---

# invoice_line

Bills one [[order_line]]. Both foreign keys share `party_id`, so an invoice can only bill its own party's orders.
