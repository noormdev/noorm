<div class="nh-rows">
<div class="nh-r">
<p class="nh-pain">The ER diagram in your wiki stopped matching the database months ago.</p>
<p class="nh-fix">The diagram renders from markdown in the repo, so it changes in the same pull request as the schema.</p>
<code class="nh-proof">ignatius serve model/ -o</code>
</div>
<div class="nh-r">
<p class="nh-pain">Nobody remembers why a table exists.</p>
<p class="nh-fix">Each entity carries its purpose and example rows beside its keys, searchable in the dictionary.</p>
<code class="nh-proof">examples:</code>
</div>
<div class="nh-r">
<p class="nh-pain">The person who signs off on the design can't read DDL.</p>
<p class="nh-fix">Export the whole model to one HTML file. They open it from their desktop, with nothing installed.</p>
<code class="nh-proof">ignatius export -o model.html</code>
</div>
<div class="nh-r">
<p class="nh-pain">You inherited a database nobody documented.</p>
<p class="nh-fix">An agent reads it through noorm's read-only MCP server, and the ignatius-modeling skill writes the model.</p>
<code class="nh-proof">/ignatius-modeling</code>
</div>
</div>
