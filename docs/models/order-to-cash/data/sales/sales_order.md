---
entity: sales_order
group: sales
pk: [party_id, order_no]
columns:
  party_id:  { type: integer }
  order_no:  { type: integer }
  placed_at: { type: datetime, default: now }
  status:    { type: text, default: open }
examples:
  - { party_id: 2, order_no: 1, status: invoiced }
  - { party_id: 2, order_no: 2, status: open }
  - { party_id: 1, order_no: 1, status: paid }
relationships:
  - target: party
    on: { party_id: party_id }
    predicate:
      fwd: places
      rev: is placed by
---

# sales_order

An order a [[party]] places. `order_no` counts within the party, so party 2's orders are 1, 2, 3 and party 1's start again at 1. `place_order()` assigns it; it is never a timestamp.
