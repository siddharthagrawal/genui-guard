// A config whose own import cannot be resolved, which is what a TypeScript
// import specifier looks like to a Node with no loader.
export { default } from "./not-a-real-file.mjs";
