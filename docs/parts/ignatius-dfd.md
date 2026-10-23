<div class="nh-dfd-compare">
<div class="nh-panel">
<div class="nh-panel-head"><span>logic flowchart</span><span>what teams draw</span></div>
<pre class="nh-panel-body nh-ascii" role="img" aria-label="Logic flowchart: charge card, then approved? yes leads to mark paid, no leads to show error.">     ┌─────────────┐
     │ charge card │
     └──────┬──────┘
            │
        approved?
        ┌───┴───┐
     yes│       │no
 ┌──────▼───┐ ┌─▼──────────┐
 │ mark paid│ │ show error │
 └──────────┘ └────────────┘</pre>
<p class="nh-panel-foot">What the code decides. No table, log file, or person appears in it.</p>
</div>
<ModelViewer class="nh-dfd-frame" model="order-to-cash" hash="view=flow&amp;dfd=order-to-cash&amp;flowview=connected" :tabs="false" label="data flow diagram · order to cash" title="Order-to-cash data flow diagram rendered by ignatius">
<p class="nh-panel-foot">Every place an order's data enters, rests, and leaves, including the gateway log that no table holds.</p>
</ModelViewer>
</div>
