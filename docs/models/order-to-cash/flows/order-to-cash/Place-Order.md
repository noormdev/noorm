---
process: Place order
number: 1
description: "Records an order and its lines, assigning the next order_no for the party."
inputs:
  - from: ext:Customer
    label: order request
    data: party, products, quantities
  - from: db:product
    label: list price
    data: [product_id, list_price]
outputs:
  - to: db:sales_order
    label: new order
    data: [party_id, order_no, status]
  - to: db:order_line
    label: order lines
    data: [party_id, order_no, line_no, product_id, qty, unit_price]
---

Runs as the `place_order()` procedure. It assigns `order_no` as one more than the party's highest, inside the same transaction that writes the lines.
