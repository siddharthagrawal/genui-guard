/**
 * A one-case suite for the CLI's own tests. Plain JavaScript on purpose: these
 * fixtures exercise the loader path a published install uses, without assuming
 * the host Node can read TypeScript.
 */
export const cases = [
  {
    id: "withheld-card",
    family: "bound",
    describe: "A legitimate card the fake adapter reports as withheld.",
    spec: { root: "root" },
    expect: { kept: ["card"] },
  },
];
