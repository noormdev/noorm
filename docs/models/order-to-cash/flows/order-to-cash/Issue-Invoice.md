---
process: Issue invoice
number: 2
description: "Bills open order lines."
inputs:
  - from: db:order_line
    label: unbilled lines
    data: [party_id, order_no, line_no, qty, unit_price]
outputs:
  - to: db:invoice
    label: new invoice
    data: [party_id, invoice_no]
  - to: db:invoice_line
    label: billed lines
    data: [party_id, invoice_no, line_no, order_no, order_line_no, amount]
  - to: ext:Customer
    label: invoice
    data: invoice number, lines, total
---

Bills every open [[order_line]] for one party onto a new [[invoice]].
