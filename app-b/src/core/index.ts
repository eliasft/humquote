// Everything versions A and C (site/a, site/c, plain JavaScript) use, built into one ES module
// (core.js) by vite.core.config.ts, so versions A and C share the same calculations.

export * from './calc';
export * from './periods';
export * from './tariffs';
export * from './analysis';
