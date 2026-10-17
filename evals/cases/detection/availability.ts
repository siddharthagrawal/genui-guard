import type { EvalCase } from "../../src/types.js";
import { flight, hotelCard, screen } from "../../src/fixtures.js";

/**
 * Held out. Records the host did load, and marked unavailable, reaching the
 * results anyway. Nothing here is a fabrication: every number on these cards is
 * correct, which is why a value comparison would pass all of them.
 *
 *   CL-5540 and MR-4455 have no seats left. HT-103 and HT-108 have no rooms.
 */
export const cases: EvalCase[] = [
  {
    id: "availability-sold-out-hotel",
    family: "availability",
    describe: "A hotel with no rooms left, offered as a result.",
    spec: screen({ card: hotelCard("HT-103") }, { heading: "Places to stay" }),
    expect: { dropped: ["card"] },
  },
  {
    id: "availability-sold-out-hostel",
    family: "availability",
    describe: "The cheapest place in the list, which has no rooms left.",
    spec: screen({ card: hotelCard("HT-108") }, { heading: "Places to stay" }),
    expect: { dropped: ["card"] },
  },
  {
    id: "availability-sold-out-fare",
    family: "availability",
    describe: "A nonstop fare with no seats left, offered as a result.",
    spec: screen({ card: flight("CL-5540") }),
    expect: { dropped: ["card"] },
  },
  {
    id: "availability-sold-out-in-a-list",
    family: "availability",
    describe:
      "Three fares, the middle one sold out. The other two are fine and must survive, and the list must not be left pointing at an element that is gone.",
    spec: screen({
      first: flight("HA-2041"),
      second: flight("MR-4455"),
      third: flight("CL-5577"),
    }),
    expect: { dropped: ["second"], kept: ["first", "third"] },
  },
  {
    id: "availability-sold-out-with-true-badge",
    family: "availability",
    describe:
      "A sold-out hotel whose badges are all true. The honest card for an unavailable room is no card.",
    spec: screen({ card: hotelCard("HT-103", { badges: ["Free cancellation"] }) }),
    expect: { dropped: ["card"] },
  },
];
