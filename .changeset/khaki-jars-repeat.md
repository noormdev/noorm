---
'@noormdev/sdk': patch
---

Put `types` first in the package exports map

Export conditions are matched in order, so `types` sitting after `import` is
resolvable only by luck — it works today because there is no `require`
condition to shadow it, and would silently stop working the moment one was
added. `publint` reports it as an error. Also normalized both packages'
`repository.url` to the full `git+https://…​.git` form npm expects.
