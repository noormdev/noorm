Explore the database for config {%~ JSON.stringify($.config) %}.
1. Inspect the target and object counts: {%~ $.call('overview', { config: $.config }) %}
2. List tables: {%~ $.call('list', { config: $.config, category: 'tables' }) %}
3. For each relevant object returned, call detail with its exact name and schema when applicable; for example, if the list contains sales.orders: {%~ $.call('detail', { config: $.config, category: 'tables', name: 'orders', schema: 'sales' }) %}
Summarize the observed schema and relationships; metadata resources may also be used.
{%~ $.safety %}
