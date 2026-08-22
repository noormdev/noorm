import{_ as t,o,c as d,a6 as a}from"./chunks/framework.ZMCvXf1_.js";const p=JSON.parse('{"title":"noorm run","description":"","frontmatter":{},"headers":[],"relativePath":"cli/run.md","filePath":"cli/run.md"}'),r={name:"cli/run.md"};function n(s,e,c,i,l,u){return o(),d("div",null,[...e[0]||(e[0]=[a(`<h1 id="noorm-run" tabindex="-1">noorm run <a class="header-anchor" href="#noorm-run" aria-label="Permalink to “noorm run”">​</a></h1><p>Execute SQL files against the active database. Five subcommands execute SQL — <code>build</code>, <code>file</code>, <code>dir</code>, <code>files</code>, and <code>exec</code> — and they all share the same result shape and exit-code semantics. Two more, <code>inspect</code> and <code>preview</code>, read a <code>.sql.tmpl</code> file without touching the database.</p><h2 id="subcommands" tabindex="-1">Subcommands <a class="header-anchor" href="#subcommands" aria-label="Permalink to “Subcommands”">​</a></h2><table tabindex="0"><thead><tr><th>Command</th><th>Purpose</th></tr></thead><tbody><tr><td><code>noorm run build</code></td><td>Execute every file under <code>paths.sql/</code></td></tr><tr><td><code>noorm run file &lt;path&gt;</code></td><td>Execute a single file</td></tr><tr><td><code>noorm run dir &lt;path&gt;</code></td><td>Execute every file in a directory</td></tr><tr><td><code>noorm run files --paths a.sql,b.sql</code></td><td>Execute an explicit, ordered list</td></tr><tr><td><code>noorm run exec &lt;dir-or-glob&gt;</code></td><td>Discover files by glob, then execute</td></tr><tr><td><code>noorm run inspect &lt;path&gt;</code></td><td>Show the template context for a <code>.sql.tmpl</code> file</td></tr><tr><td><code>noorm run preview &lt;path&gt;</code></td><td>Render a <code>.sql.tmpl</code> file and print the SQL</td></tr></tbody></table><h2 id="flags" tabindex="-1">Flags <a class="header-anchor" href="#flags" aria-label="Permalink to “Flags”">​</a></h2><p>Common to the five executing subcommands:</p><ul><li><code>--config &lt;name&gt;</code> / <code>-c &lt;name&gt;</code> — use a named config from <code>state.enc</code></li><li><code>--force</code> / <code>-f</code> — re-run even if the file&#39;s checksum matches a prior success</li><li><code>--dry-run</code> — render templates and write to <code>tmp/</code> without executing</li><li><code>--json</code> — emit machine-readable JSON on stdout</li></ul><p><code>inspect</code> and <code>preview</code> take <code>--config</code> and <code>--json</code> only. Neither executes, so <code>--force</code> and <code>--dry-run</code> have nothing to act on.</p><h2 id="exit-codes" tabindex="-1">Exit codes <a class="header-anchor" href="#exit-codes" aria-label="Permalink to “Exit codes”">​</a></h2><table tabindex="0"><thead><tr><th>Code</th><th>Meaning</th></tr></thead><tbody><tr><td><code>0</code></td><td>Every file succeeded or was skipped</td></tr><tr><td><code>1</code></td><td>Total failure — setup failed (could not connect, project not initialized), or the runner ran and nothing succeeded</td></tr><tr><td><code>2</code></td><td>Usage error — a missing flag, a directory or glob that matched no SQL files (<code>dir</code>, <code>exec</code>), or a template that isn&#39;t there (<code>inspect</code>, <code>preview</code>). Nothing was attempted</td></tr><tr><td><code>3</code></td><td>Partial failure — some files succeeded and some failed. Re-running is not automatically safe</td></tr></tbody></table><h2 id="output-failure" tabindex="-1">Output: failure <a class="header-anchor" href="#output-failure" aria-label="Permalink to “Output: failure”">​</a></h2><p>When a file errors, the human-readable output includes the SQL error beneath the file&#39;s status line so you don&#39;t have to scroll the log looking for the cause:</p><pre><code>sql/02_tables/Memory.sql (failed)
  error: relation &quot;memory&quot; does not exist
Build completed  status=partial filesRun=12 filesSkipped=0 filesFailed=1 durationMs=84
</code></pre><p>A batch where some files ran and some failed reports <code>partial</code> and exits <code>3</code>. Only a batch where nothing succeeded reports <code>failed</code> and exits <code>1</code>.</p><p>The same information lives on the JSON output&#39;s per-file entries. The <code>--json</code> payload is the <code>BatchResult</code> (or <code>FileResult</code> for <code>noorm run file</code>) returned by the SDK plus the envelope&#39;s <code>success</code> flag, so <code>files[].error</code> is populated for every failed file:</p><pre><code>{
    &quot;success&quot;: false,
    &quot;status&quot;: &quot;partial&quot;,
    &quot;files&quot;: [
        {
            &quot;filepath&quot;: &quot;sql/02_tables/Memory.sql&quot;,
            &quot;status&quot;: &quot;failed&quot;,
            &quot;error&quot;: &quot;relation \\&quot;memory\\&quot; does not exist&quot;,
            &quot;durationMs&quot;: 4.2,
            &quot;checksum&quot;: &quot;...&quot;
        }
    ],
    &quot;filesRun&quot;: 12,
    &quot;filesSkipped&quot;: 0,
    &quot;filesFailed&quot;: 1,
    &quot;durationMs&quot;: 84
}
</code></pre><h2 id="output-skip" tabindex="-1">Output: skip <a class="header-anchor" href="#output-skip" aria-label="Permalink to “Output: skip”">​</a></h2><p>A file is skipped when its checksum matches a previous successful execution. The reason is shown inline:</p><pre><code>sql/seeds/Sentinels.sql.tmpl (skipped: unchanged)
</code></pre><p>In JSON form, <code>skipReason</code> is set to <code>&#39;unchanged&#39;</code> (or <code>&#39;already-run&#39;</code> for the change-level checks):</p><pre><code>{
    &quot;filepath&quot;: &quot;sql/seeds/Sentinels.sql.tmpl&quot;,
    &quot;status&quot;: &quot;skipped&quot;,
    &quot;skipReason&quot;: &quot;unchanged&quot;,
    &quot;checksum&quot;: &quot;...&quot;
}
</code></pre><p>If a file was skipped because you forgot <code>--force</code> after wiping the database, this is the signal to look for. Pass <code>--force</code> to re-run regardless of the checksum cache.</p><h2 id="mssql-go-batches" tabindex="-1">MSSQL: <code>GO</code> batches <a class="header-anchor" href="#mssql-go-batches" aria-label="Permalink to “MSSQL: GO batches”">​</a></h2><p>On MSSQL connections, files containing multiple statements separated by <code>GO</code> (the T-SQL batch separator) work as you&#39;d expect — <code>CREATE PROCEDURE</code>, <code>CREATE FUNCTION</code>, <code>CREATE TRIGGER</code>, <code>CREATE VIEW</code>, and <code>CREATE TYPE</code> for table-valued parameters can be grouped in a single file. The runner splits on <code>GO</code> (anchored to its own line) and executes batches sequentially. If a batch fails, the error is prefixed with <code>[batch N of M]</code> so you can identify the offending statement without re-reading the file. See <a href="/guide/sql-files/execution.html#mssql-multiple-statements-per-file">Writing MSSQL Files with GO</a> for examples and the <a href="/dev/runner.html#mssql-batch-handling">runner internals</a> for the splitter rules and known limitations.</p><h2 id="examples" tabindex="-1">Examples <a class="header-anchor" href="#examples" aria-label="Permalink to “Examples”">​</a></h2><pre><code>noorm run build
noorm run build --force
noorm run build --json

noorm run file sql/init.sql
noorm run file seeds/test-data.sql.tmpl --dry-run

noorm run dir sql/02_views/
noorm run files --paths sql/01_tables/users.sql,sql/01_tables/orders.sql

noorm run exec &quot;sql/**/*.sql&quot;
</code></pre>`,26)])])}const m=t(r,[["render",n]]);export{p as __pageData,m as default};
