---
entity: person
group: parties
pk:
  - party_id
columns:
  party_id:
    type: integer
  given_name:
    type: text
  family_name:
    type: text
examples:
  - party_id: 2
    given_name: Ada
    family_name: Lovelace
relationships:
  - target: party
    on:
      party_id: party_id
    predicate: { fwd: is realized as, rev: is a }
---

# person

A [[party]] that is a natural person. Shares its identity with the party; it never mints its own.
