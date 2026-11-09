Run the project SQL file {%~ JSON.stringify($.path) %} against config {%~ JSON.stringify($.config) %} only after review.
1. Inspect the target and dialect: {%~ $.call('list_configs', {}) %} and {%~ $.call('overview', { config: $.config }) %}
2. Read the exact file and relevant project template context; inspect its effects and verify it is appropriate for the target dialect.
3. Request execution of that file: {%~ $.call('run_file', { config: $.config, path: $.path }) %}
Report the result and any errors.
{%~ $.safety %}
