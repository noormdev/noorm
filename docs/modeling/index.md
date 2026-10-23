---
layout: home
title: ignatius, data modeling
description: ignatius turns a folder of markdown into data flow diagrams, a relationship graph, and a data dictionary, so a team agrees on the data model before anyone writes the SQL.
---

<section class="nh-hero">

<p class="nh-eyebrow">ignatius · data modeling · works with or without noorm</p>

<h1 class="nh-title">Agree on the data model<br><span>before anyone writes the SQL</span></h1>

<div class="nh-row">
<p class="nh-lead">Analysis costs less than rebuilding a system. ignatius turns a folder of markdown into a picture of the plan: what captures data, the shape it takes, why each table exists, the rules it follows, and who outside the system sends it and receives it.</p>
<div class="nh-actions">
<a class="nh-btn brand" href="/download">Download</a>
<a class="nh-btn alt" href="#try-it">Try it in two minutes</a>
<p class="nh-caption">one binary · macOS, Linux, Windows</p>
</div>
</div>

</section>

<section class="nh-section">

<p class="nh-eyebrow">01 · Movement</p>

<h2 class="nh-h2">Do you know how data moves through your system, and who produces it?</h2>

<p class="nh-chapter">A data flow diagram answers both. It shows who produces data, including people outside the technical system, which process moves or transforms it, and which store keeps it: a table, a cache, a log file, a paper form. Most teams skip this step and draw logic flowcharts, which show decisions, not data.</p>

<!--@include: ../parts/ignatius-dfd.md-->

<p class="nh-note">Read each process as an operation your database must support. <strong>Place order</strong> takes the customer's order request and product prices and writes <code>sales_order</code> and <code>order_line</code>. That is <code>place_order()</code>, specified before anyone writes the SQL or the code that calls it.</p>

</section>

<section class="nh-section">

<p class="nh-eyebrow">02 · Relationships</p>

<h2 class="nh-h2">Have you ever visualized your entity relationships clearly?</h2>

<p class="nh-chapter">An ER diagram lists every column and buries the relationships under them. ignatius draws the relationships alone: entities by name, joined by the business verbs that relate them. Click an entity to open its columns, keys, example rows, and the reason it exists, then walk the graph to tell the story in a meeting.</p>

<!--@include: ../parts/ignatius-viewer.md-->

</section>

<section class="nh-section">

<p class="nh-eyebrow">03 · Agents</p>

<h2 class="nh-h2">In the age of AI agents, review the plan first</h2>

<p class="nh-chapter">Agents write schemas faster than anyone can read them, so the review has to happen before the code exists. The model is markdown, so it is the thing you review before you sign off on what the agent builds. The agent reads the same files, and the ignatius-modeling skill writes them one question at a time and validates each one.</p>

<!--@include: ../parts/ignatius-cmds.md-->

</section>

<section class="nh-section">

<p class="nh-eyebrow">04 · Documentation</p>

<h2 class="nh-h2">The plan becomes the visualization</h2>

<p class="nh-chapter">Everything above comes from one folder of markdown. The same files are your database's documentation and its data dictionary, the place the team plans and shares plans, and the place an agent looks to see what it should build.</p>

<!--@include: ../parts/ignatius-problems.md-->

</section>

<section class="nh-section">

<p class="nh-eyebrow">05 · Lineage</p>

<h2 class="nh-h2">Built on the shoulders of giants</h2>

<p class="nh-chapter">ignatius is not a new invention. It is a looking glass into excellent standards: IDEF1X for entities, grown out of E. F. Codd's relational model, and SSADM-style data flow diagrams for movement.</p>

| Year | Step |
|---|---|
| 1970 | E. F. Codd publishes the relational model of data. |
| 1977–78 | Chris Gane and Trish Sarson, then Tom DeMarco, publish structured analysis built on data flow diagrams. |
| 1981 | The US Air Force's ICAM program publishes IDEF1, built on Codd's relational theory and Peter Chen's entity-relationship model. |
| 1982 | Robert Brown develops the logical database design technique for Bank of America. |
| 1983 on | The Air Force extends IDEF1 into IDEF1X, using Brown's technique. |
| 1993 | NIST publishes IDEF1X as federal standard FIPS 184. |
| 2012 | IDEF1X becomes part of the international standard ISO/IEC/IEEE 31320-2. |

</section>

<section class="nh-section" id="try-it">

<p class="nh-eyebrow">Try it</p>

<h2 class="nh-h2">A model in two minutes</h2>

<div class="nh-steps">
<div>
<div>
<p class="nh-step">01 · Install</p>
<p class="nh-step-note">Windows and other options: <a href="/download">Download</a>.</p>
</div>
<div>

```bash
curl -fsSL https://noorm.dev/ignatius.sh | sh
```

</div>
</div>
<div>
<div>
<p class="nh-step">02 · Write one entity</p>
<p class="nh-step-note">A folder with an <code>ignatius.yml</code> is a model. Each file under <code>data/</code> is one entity: keys and columns in the frontmatter, what it is for in the body.</p>
</div>
<div>

<div class="nh-file">
<div class="nh-panel-head"><span>model/ignatius.yml</span><span>you write this</span></div>

```yaml
name: Shop
```

</div>
<div class="nh-file">
<div class="nh-panel-head"><span>model/data/party.md</span><span>you write this</span></div>

```markdown
---
entity: party
pk: [party_id]
columns:
  party_id: { type: integer }
  name:     { type: text }
---

# party

Anyone who places orders.
```

</div>

</div>
</div>
<div>
<div>
<p class="nh-step">03 · Serve it</p>
<p class="nh-step-note">The browser opens on the diagram. Save <code>party.md</code> and the open tab redraws. Add the next entity with a <code>relationships:</code> block pointing at <code>party</code>, and the edge appears.</p>
</div>
<div>

```bash
ignatius serve model -o
```

</div>
</div>
</div>

</section>

<section class="nh-section">

<p class="nh-eyebrow">Go deeper</p>

<h2 class="nh-h2">Where to go next</h2>

<div class="nh-cards">
<a href="/modeling/entities"><strong>Entity files</strong><span>The entity format, and what ignatius derives from your keys.</span></a>
<a href="/modeling/data-flows"><strong>Data flows</strong><span>Processes, externals, and stores, including the ones that are not tables.</span></a>
<a href="/modeling/model-to-sql"><strong>From model to SQL</strong><span>How each field of an entity file becomes DDL.</span></a>
<a href="/modeling/reverse-engineering"><strong>Reverse-engineering</strong><span>Extract a model from a database you already run.</span></a>
<a href="/modeling/modeling-skill"><strong>The modeling skill</strong><span>Author entities and flows from Claude Code, one question at a time.</span></a>
<a href="/modeling/best-practices"><strong>Best practices</strong><span>What makes a model worth showing to a stakeholder.</span></a>
<a href="/modeling/installation"><strong>Commands</strong><span>Install, serve, validate, export, index, approve, and update.</span></a>
<a href="/modeling/why"><strong>Why ignatius</strong><span>The case for modeling first, and where the name comes from.</span></a>
</div>

</section>
