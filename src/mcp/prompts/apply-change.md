Apply the exact change {%~ JSON.stringify($.change) %} to config {%~ JSON.stringify($.config) %} only after review.
1. Inspect the target: {%~ $.call('list_configs', {}) %} and {%~ $.call('overview', { config: $.config }) %}
2. Review applied history: {%~ $.call('change_history', { config: $.config }) %}. Inspect the named change and its SQL in the project before executing; history is not a pending-change list.
3. Once the target and change are understood, request: {%~ $.call('change_run', { config: $.config, name: $.change }) %}
Review the result and report what actually ran.
{%~ $.safety %}
