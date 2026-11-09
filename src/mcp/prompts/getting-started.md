Help me get started with noorm.
1. Discover visible configs: {%~ $.call('list_configs', {}) %}
{% if ($.config) { %}2. Check that {%~ JSON.stringify($.config) %} is the intended target and inspect it: {%~ $.call('overview', { config: $.config }) %}{% } else { %}2. Ask me to choose an exact config from the results before making database-scoped calls.{% } %}
3. List relevant object categories and inspect their details before answering.
{%~ $.safety %}
