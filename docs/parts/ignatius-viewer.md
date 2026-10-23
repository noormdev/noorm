<div class="nh-viewer">
<div class="nh-file">
<div class="nh-panel-head"><span>model/data/sales/sales_order.md</span><span>you write this</span></div>

```yaml
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
```

</div>
<ModelViewer model="order-to-cash" title="Order-to-cash model rendered by ignatius" caption="ignatius draws this" />
</div>

<p class="nh-note">Cardinality and identifying edges come from the keys, and subtype clusters from the <code>subtypes:</code> block. Nothing is drawn by hand, and saving a file reloads the open browser.</p>
