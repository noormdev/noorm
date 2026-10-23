---
entity: business
group: parties
pk:
  - party_id
columns:
  party_id:
    type: integer
  legal_name:
    type: text
  tax_id:
    type: text
ak:
  - rule: is identified by tax id
    columns:
      - tax_id
examples:
  - party_id: 1
    legal_name: Meridian Analytics LLC
    tax_id: "47-3819204"
relationships:
  - target: party
    on:
      party_id: party_id
    predicate: { fwd: is realized as, rev: is a }
---

# business

A [[party]] that is a legal entity. `tax_id` is unique, but it is not the key: identity comes from the party.
