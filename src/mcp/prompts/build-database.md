Build the database for config {%~ JSON.stringify($.config) %} only after review.
1. Inspect the target: {%~ $.call('list_configs', {}) %} and {%~ $.call('overview', { config: $.config }) %}
2. Review the project build settings and relevant SQL files; check the intended target and effects.
3. Run the checksum-based build: {%~ $.call('run_build', { config: $.config }) %}
Report the result. Do not force a rebuild unless explicitly requested.
{%~ $.safety %}
