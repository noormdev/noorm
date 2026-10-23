---
entity: order_line
group: sales
pk:
  - party_id
  - order_no
  - line_no
columns:
  party_id:
    type: integer
  order_no:
    type: integer
  line_no:
    type: integer
  product_id:
    type: integer
  qty:
    type: integer
  unit_price:
    type: decimal
    desc: "Price agreed at order time, copied from the catalog."
examples:
  - party_id: 2
    order_no: 1
    line_no: 1
    product_id: 10
    qty: 1
    unit_price: 49.00
  - party_id: 2
    order_no: 1
    line_no: 2
    product_id: 11
    qty: 1
    unit_price: 89.00
relationships:
  - target: sales_order
    on:
      party_id: party_id
      order_no: order_no
    predicate: { fwd: contains, rev: is part of }
  - target: product
    on:
      product_id: product_id
    predicate: { fwd: is sold via, rev: sells }
---

# order_line

One product on a [[sales_order]]. The key carries the whole lineage, so the owning party is on every row without a join.
