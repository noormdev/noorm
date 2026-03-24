/**
 * No-op ansis stub for SDK builds.
 *
 * The SDK doesn't need terminal colors — the logger/theme chain
 * pulls in ansis but SDK consumers don't write to terminals.
 * This stub passes strings through unchanged.
 */
const passthrough = (text: string) => text;
const hex = (_color: string) => passthrough;

export default {
    hex,
    bold: passthrough,
    dim: passthrough,
    italic: passthrough,
    underline: passthrough,
    inverse: passthrough,
    reset: passthrough,
};
