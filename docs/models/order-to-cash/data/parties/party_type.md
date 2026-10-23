---
entity: party_type
reference: true
group: parties
pk:
  - code
columns:
  code:
    type: text
    desc: "PERSON or BUSINESS."
  description:
    type: text
examples:
  - code: PERSON
    description: A natural person
  - code: BUSINESS
    description: A legal entity
---

# party_type

The discriminator values for the [[party]] subtype cluster. New kinds of party are added as rows, not as code.
