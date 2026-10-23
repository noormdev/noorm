---
process: Collect payment
number: 3
description: "Records a payment and allocates it against invoice lines."
inputs:
  - from: ext:Customer
    label: payment
    data: card, amount
  - from: db:invoice_line
    label: open lines
    data: [party_id, invoice_no, line_no, amount]
outputs:
  - to: db:payment
    label: payment
    data: [party_id, payment_no, amount]
  - to: db:payment_allocation
    label: allocations
    data: [party_id, payment_no, invoice_no, line_no, amount]
  - to: file:gateway-log
    label: gateway response
    data: transaction reference, status, raw response
  - to: ext:Customer
    label: receipt
    data: payment number, status
---

Writes the [[payment]] and its [[payment_allocation]] rows in one transaction.
