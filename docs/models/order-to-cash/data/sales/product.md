---
entity: product
group: sales
pk:
  - product_id
columns:
  product_id:
    type: integer
  sku:
    type: text
  name:
    type: text
  list_price:
    type: decimal
ak:
  - rule: is identified by sku
    columns:
      - sku
examples:
  - product_id: 10
    sku: HW-DONGLE
    name: USB security key
    list_price: 49.00
  - product_id: 11
    sku: SW-SEAT
    name: Desktop seat, yearly
    list_price: 89.00
---

# product

The catalog. Seeded from `sql/09_seeds/products.yml` in the noorm project.
