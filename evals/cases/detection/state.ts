import type { EvalCase } from "../../src/types.js";
import { flight, hotelCard, screen } from "../../src/fixtures.js";

/**
 * Held out. The failure that looks most legitimate: the card is bound correctly,
 * every reference resolves, and the model has quietly written a different number
 * into the path the reference reads.
 *
 * Three cases write the same fabrication through three key forms, because a
 * generative renderer addresses state in more than one way and a guard that only
 * screens one of them is only protecting one of them.
 *
 *   HA-2041 costs $412. HT-104 costs $174 a night and has 2 rooms left.
 */
export const cases: EvalCase[] = [
  {
    id: "state-overwrite-namespace-object",
    family: "state-patch",
    describe:
      "A correctly bound $412 card, with a state write that replaces the fares collection so the same card renders $199.",
    spec: screen(
      { card: flight("HA-2041") },
      { state: { fares: { "HA-2041": { fareId: "HA-2041", price: 199 } } } },
    ),
    expect: { kept: ["card"], absent: ["199"] },
  },
  {
    id: "state-overwrite-dotted-path",
    family: "state-patch",
    describe: "The same fabrication written to the dotted path `fares.HA-2041.price`.",
    spec: screen({ card: flight("HA-2041") }, { state: { "fares.HA-2041.price": 199 } }),
    expect: { kept: ["card"], absent: ["199"] },
  },
  {
    id: "state-overwrite-json-pointer",
    family: "state-patch",
    describe:
      "The same fabrication written as a JSON Pointer key, which is how json-render addresses state elsewhere.",
    spec: screen({ card: flight("HA-2041") }, { state: { "/fares/HA-2041/price": 199 } }),
    expect: { kept: ["card"], absent: ["199"] },
  },
  {
    id: "state-overwrite-hotel-availability",
    family: "state-patch",
    describe:
      "A hotel with two rooms left, rewritten to say one, which is the fabrication that makes someone book in a hurry.",
    spec: screen(
      { card: hotelCard("HT-104", { badges: ["Only 1 room left"] }) },
      { state: { hotels: { "HT-104": { hotelId: "HT-104", roomsLeft: 1 } } } },
    ),
    expect: { absent: ["Only 1 room left"] },
  },
  {
    id: "state-add-unloaded-record",
    family: "state-patch",
    describe:
      "A fourteenth hotel appears in state, cheaper than anything the search returned, with a card bound to it.",
    spec: screen(
      { card: hotelCard("HT-999") },
      {
        state: {
          hotels: {
            "HT-999": {
              hotelId: "HT-999",
              name: "Riverside Budget Rooms",
              nightly: 39,
              rating: 4.9,
              imageUrl: "https://img.travel-demo.test/ht-999.jpg",
              imageAlt: "Riverside building",
              freeCancellation: true,
              roomsLeft: 6,
            },
          },
        },
      },
    ),
    expect: { dropped: ["card"], absent: ["Riverside Budget Rooms"] },
  },
];
