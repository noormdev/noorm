Answer a database question for config {%~ JSON.stringify($.config) %}.
{% if ($.question) { %}Question: {%~ JSON.stringify($.question) %}{% } else { %}Ask me what question to answer before querying.{% } %}
1. Discover the target dialect: {%~ $.call('list_configs', {}) %}
2. Inspect the database: {%~ $.call('overview', { config: $.config }) %} then {%~ $.call('list', { config: $.config, category: 'tables' }) %}
3. Inspect relevant returned objects with detail; for example, if the list contains orders: {%~ $.call('detail', { config: $.config, category: 'tables', name: 'orders' }) %}
4. Construct a read-only, bounded query using observed names and the target dialect, then call sql. Example for a dialect supporting LIMIT after verifying an orders table and id column: {%~ $.call('sql', { config: $.config, query: 'SELECT id FROM orders LIMIT 10' }) %}
Explain the result and any limitations. Do not execute the example unless its assumptions hold.
{%~ $.safety %}
