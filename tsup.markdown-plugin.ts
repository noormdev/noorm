import { readFileSync } from 'node:fs';
import type { Plugin } from 'esbuild';

/** Inlines `.md` imports as strings so bundled output needs no custom loader. */
export const markdownText: Plugin = {
    name: 'markdown-text',
    setup(build) {

        build.onLoad({ filter: /\.md$/ }, (args) => ({
            contents: readFileSync(args.path, 'utf8'),
            loader: 'text',
        }));

    },
};
