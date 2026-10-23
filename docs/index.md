---
layout: home
title: noorm — A database change manager for the modern era
titleTemplate: false
description: noorm keeps one SQL file per table as the schema you have today. Fresh databases build from those files; existing ones catch up through tracked changes. Postgres, MySQL, SQLite, and SQL Server.
---

<section class="nh-hero">

<p class="nh-eyebrow">Postgres · MySQL · SQLite · SQL Server</p>

<h1 class="nh-title">A database change manager<br><span>for the modern era</span></h1>

<div class="nh-row">
<p class="nh-lead">Your schema lives in <code>db/sql/</code>, one file per table, as it stands today. A fresh database builds straight from those files. An existing one catches up through tracked changes you can revert.</p>
<div class="nh-actions">
<a class="nh-btn brand" href="/getting-started/installation">Get started →</a>
<a class="nh-btn alt" href="/download">Download</a>
<p class="nh-caption">Write SQL. Skip the ORM. · one binary · Apache 2.0</p>
</div>
</div>

<div class="nh-compare">
<div class="nh-panel nh-bad">
<div class="nh-panel-head"><span><b class="nh-mark">✕</b> migrations/</span><span>what changed</span></div>
<pre class="nh-panel-body">0001_create_party.sql
0002_create_sales_order.sql
0003_add_email_to_party.sql
0004_create_order_line.sql
…
0212_rename_total_to_amount.sql
0213_add_status_to_sales_order.sql
0214_backfill_sales_order_status.sql</pre>
<p class="nh-panel-foot">To learn what <code>sales_order</code> looks like, read all 214.</p>
</div>
<div class="nh-file nh-good">
<div class="nh-panel-head"><span><b class="nh-mark">✓</b> db/sql/01_tables/02_sales_order.sql</span><span>what exists</span></div>

```sql
CREATE TABLE sales_order (
    party_id   integer     NOT NULL,
    order_no   integer     NOT NULL,
    placed_at  timestamptz NOT NULL DEFAULT now(),
    status     text        NOT NULL DEFAULT 'open',
    CONSTRAINT sales_order_pk
        PRIMARY KEY (party_id, order_no),
    CONSTRAINT sales_order_isplacedby_party
        FOREIGN KEY (party_id) REFERENCES party (party_id)
);
```

</div>
</div>

</section>

<section class="nh-section">

<p class="nh-eyebrow">What changes</p>

<h2 class="nh-h2">The problems you stop having</h2>

<div class="nh-rows">
<div class="nh-r">
<p class="nh-pain">A test database replays the whole migration history before the first test runs.</p>
<p class="nh-fix">It builds from the current files in one command.</p>
<code class="nh-proof">noorm run build</code>
</div>
<div class="nh-r">
<p class="nh-pain">A stored procedure was hotfixed in a SQL editor, and nobody can say which version is live.</p>
<p class="nh-fix">Procedures, views, and functions re-run through a change. History records who ran it, when, and the error if it failed.</p>
<code class="nh-proof">noorm change history</code>
</div>
<div class="nh-r">
<p class="nh-pain">A password or API key the database needs sits in a SQL file in git.</p>
<p class="nh-fix">Store it encrypted with noorm. The template fills it in when the SQL runs, so the committed file holds only the reference.</p>
<code class="nh-proof">{%~ $.quote($.secrets.GATEWAY_KEY) %}</code>
</div>
<div class="nh-r">
<p class="nh-pain">Your tests mock the database because a real one is a chore to set up.</p>
<p class="nh-fix">The SDK runs tests against a real database, and refuses any config not marked as a test one.</p>
<code class="nh-proof">createContext({ requireTest: true })</code>
</div>
<div class="nh-r">
<p class="nh-pain">You handed an AI agent a connection string and hope it reads before it writes.</p>
<p class="nh-fix">Each config sets a role per caller: read-only for the agent on dev, invisible on prod.</p>
<code class="nh-proof">noorm mcp serve</code>
</div>
</div>

</section>

<section class="nh-section nh-split">
<div>

<p class="nh-eyebrow">How it works</p>

<h2 class="nh-h2">Two folders, two commands</h2>

<p>Edit the table in <code>db/sql/</code>. Add a change for databases that already exist. Every environment ends up in the same state.</p>

<pre class="nh-flow" role="img" aria-label="A fresh database runs noorm run build on db/sql/; an existing database runs noorm change ff on db/changes/; both reach the current schema."><span class="nh-dim">fresh database</span>     db/sql/      <span class="nh-arrow">── noorm run build ──▶</span>  current
<span class="nh-dim">existing database</span>  db/changes/  <span class="nh-arrow">── noorm change ff ──▶</span>  current</pre>

<p class="nh-links"><a href="/getting-started/first-build">Quick start</a> · <a href="/guide/changes/add-a-column">Add a column to a live database</a></p>

</div>
<div>

```bash
# a new test database
$ noorm run build
• log  Build completed  status=success filesRun=11 filesSkipped=0 filesFailed=0 durationMs=96.417
```

```bash
# staging, which already has data
$ noorm change ff -c staging
• log  Fast-forward success  executed=1 skipped=0 failed=0
• log    2026-10-20-order-status (success)
```

</div>
</section>

<section class="nh-section nh-band">
<div class="nh-tool">

<p class="nh-eyebrow">ignatius · data modeling</p>

<h2 class="nh-h2 nh-big">Agree on the data model<br><span>before anyone writes the SQL</span></h2>

<div class="nh-row">
<p class="nh-lead">ignatius turns a folder of markdown into an IDEF1X entity diagram, a searchable data dictionary, and data flow diagrams. It reads no database and writes no SQL. The model lives in your repo and changes in the same pull request as the schema.</p>
<div class="nh-actions">
<a class="nh-btn alt" href="/download">Download</a>
<a class="nh-btn alt" href="/modeling/">Explore ignatius</a>
<p class="nh-caption">one binary · works with or without noorm</p>
</div>
</div>

<div class="nh-dfd">

<h3 class="nh-h3">Where your data comes from, and where it goes</h3>

<p class="nh-dfd-lead">A data flow diagram shows who sends data, including people outside the technical system, which process moves or transforms it, and which store keeps it. Most teams skip it and draw logic flowcharts, which show decisions, not data. ignatius draws data flow diagrams in the SSADM style.</p>

<!--@include: ./parts/ignatius-dfd.md-->

</div>

<!--@include: ./parts/ignatius-viewer.md-->

<!--@include: ./parts/ignatius-problems.md-->

<!--@include: ./parts/ignatius-cmds.md-->

</div>
</section>

<section class="nh-section">

<p class="nh-eyebrow">FAQ</p>

<h2 class="nh-h2">Questions developers ask first</h2>

<div class="nh-faq">
<div><h3>Is this migrations with extra steps?</h3><p>Your migrations become <code>db/changes/</code>: forward and revert files, tracked and checksummed. <code>db/sql/</code> sits beside them as the current schema, so a fresh database builds from it without replaying history.</p></div>
<div><h3>Does it replace my ORM?</h3><p>It replaces the ORM's schema and migration layer. Query with the typed SDK (Kysely underneath), raw SQL, or the client you already use.</p></div>
<div><h3>Which databases?</h3><p>PostgreSQL, MySQL, SQLite, and SQL Server. The CLI is one binary with every driver built in.</p></div>
<div><h3>What about stored procedures?</h3><p>Call them from TypeScript with typed parameters and result rows, table-valued parameters included.</p></div>
<div><h3>Do I need both tools?</h3><p>No. ignatius reads markdown and never connects to a database, so it works with any stack. noorm runs your SQL whether or not a model exists.</p></div>
<div><h3>Does ignatius generate the SQL?</h3><p>No. It shows what you intend to build. Write the SQL yourself or hand the model to your agent; <a href="/modeling/model-to-sql">From model to SQL</a> shows how each field maps.</p></div>
</div>

</section>

<section class="nh-section nh-start">

<h2 class="nh-h2">If you write SQL by hand and ship it to more than one environment, start here.</h2>

```bash
# noorm: build and change the database
curl -fsSL https://noorm.dev/install.sh | sh

# ignatius: model it first
curl -fsSL https://noorm.dev/ignatius.sh | sh
```

<div class="nh-actions nh-inline">
<a class="nh-btn brand" href="/getting-started/installation">Get started →</a>
<a class="nh-btn alt" href="/download">Download</a>
</div>

</section>
