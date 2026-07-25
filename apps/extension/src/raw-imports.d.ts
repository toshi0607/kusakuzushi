/**
 * Ambient module declaration for Vite's `?raw` import suffix (used by the
 * test suite to inline the HTML fixture as a string). Vite/vitest resolve
 * this at test-transform time; this file only teaches `tsc` the shape so
 * `pnpm build`'s type-check doesn't need a Node `fs` dependency to read
 * fixtures — this package intentionally carries no `@types/node`.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
