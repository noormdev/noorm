---
entity: party
group: parties
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "Root identity. A surrogate is right here: nothing above party supplies one."
  party_type:
    type: text
    desc: "Which subtype this party is."
  name:
    type: text
    desc: "Display name."
examples:
  - party_id: 1
    party_type: BUSINESS
    name: Meridian Analytics
  - party_id: 2
    party_type: PERSON
    name: Ada Lovelace
subtypes:
  - exclusive: true
    desc: Every party is exactly one of person or business
    members:
      person:
        party_type: party_type.code.PERSON
      business:
        party_type: party_type.code.BUSINESS
relationships:
  - target: party_type
    on:
      party_type: code
    predicate: { fwd: classifies, rev: is classified by }
---

# party

Anyone who places orders and owes on invoices. Every table in sales and billing inherits `party_id`, which is what lets the database stop one customer's payment from settling another customer's invoice.
