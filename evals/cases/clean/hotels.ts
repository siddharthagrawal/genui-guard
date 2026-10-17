import type { EvalCase } from "../../src/types.js";
import { hotelCard, screen } from "../../src/fixtures.js";

/**
 * Legitimate hotel results, including the mirrors of the hotel detection cases.
 *
 *   hotel     nightly  rating  free cancellation  rooms
 *   HT-101    118      4.4     yes                3
 *   HT-102    96       4.1     no                 7
 *   HT-104    174      4.6     yes                2
 *   HT-105    87       3.8     no                 12
 *   HT-106    203      4.8     yes                1
 *   HT-109    158      4.5     yes                4
 *   HT-110    112      4.2     yes                9
 *   HT-112    188      4.4     yes                2
 *
 * Images come from https://img.travel-demo.test, which is the approved host, and
 * every record carries its own alternative text.
 */
export const cases: EvalCase[] = [
  {
    id: "clean-bound-hotel",
    family: "bound",
    describe: "One hotel, bound, with its own photo and alternative text.",
    spec: screen({ card: hotelCard("HT-101") }, { heading: "Places to stay" }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-bound-hotel-cheap",
    family: "bound",
    describe: "A cheaper hotel with plenty of rooms, bound.",
    spec: screen({ card: hotelCard("HT-110") }, { heading: "Places to stay" }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-hotel-free-cancellation",
    family: "claim-supported",
    describe: "A hotel with free cancellation, badged Free cancellation.",
    spec: screen({ card: hotelCard("HT-101", { badges: ["Free cancellation"] }) }),
    expect: { kept: ["card"], present: ["Free cancellation"] },
  },
  {
    id: "clean-hotel-cancellation-and-rating",
    family: "claim-supported",
    describe: "Free cancellation and a 4.6 rating, both of which the record says.",
    spec: screen({ card: hotelCard("HT-104", { badges: ["Free cancellation", "Rated 4.6"] }) }),
    expect: { kept: ["card"], present: ["Free cancellation", "Rated 4.6"] },
  },
  {
    id: "clean-hotel-rating-only",
    family: "claim-supported",
    describe:
      "A hotel without free cancellation, badged only with its true rating. The badge it does not have is the point.",
    spec: screen({ card: hotelCard("HT-102", { badges: ["Rated 4.1"] }) }),
    expect: { kept: ["card"], present: ["Rated 4.1"] },
  },
  {
    id: "clean-hotel-top-rating",
    family: "claim-supported",
    describe: "The best rated hotel in the list, badged with its rating.",
    spec: screen({ card: hotelCard("HT-106", { badges: ["Rated 4.8"] }) }),
    expect: { kept: ["card"], present: ["Rated 4.8"] },
  },
  {
    id: "clean-hotel-para-cancel-no-cost",
    family: "claim-paraphrase-true",
    describe: "A cancellable rate saying it can be cancelled at no cost.",
    spec: screen({ card: hotelCard("HT-109", { badges: ["Cancel at no cost"] }) }),
    expect: { kept: ["card"], present: ["Cancel at no cost"] },
  },
  {
    id: "clean-hotel-para-change-dates",
    family: "claim-paraphrase-true",
    describe:
      "The date-change sentence from the detection suite, on a rate that does allow free cancellation.",
    spec: screen({ card: hotelCard("HT-112", { badges: ["Change your dates whenever you like"] }) }),
    expect: { kept: ["card"], present: ["Change your dates whenever you like"] },
  },
  {
    id: "clean-hotel-scarcity-one-room",
    family: "scarcity-true",
    describe:
      "A hotel with one room left, badged as having one room left. The detection suite puts this badge on a hotel with twelve.",
    spec: screen({ card: hotelCard("HT-106", { badges: ["Only 1 room left"] }) }),
    expect: { kept: ["card"], present: ["Only 1 room left"] },
  },
  {
    id: "clean-hotel-scarcity-two-rooms",
    family: "scarcity-true",
    describe: "A hotel with two rooms left, badged as having two.",
    spec: screen({ card: hotelCard("HT-112", { badges: ["2 rooms left"] }) }),
    expect: { kept: ["card"], present: ["2 rooms left"] },
  },
  {
    id: "clean-hotel-descriptive-alt-text",
    family: "descriptive",
    describe: "A sentence restating the photo's own description, which came from the record.",
    spec: screen({ card: hotelCard("HT-105", { note: "Pictured: a yellow tram passing a doorway." }) }),
    expect: { kept: ["card"], present: ["yellow tram passing a doorway"] },
  },
  {
    id: "clean-hotel-descriptive-location",
    family: "descriptive",
    describe:
      "Prose about where the hotel is, which the source has no field for. A contested case kept deliberately: it is the same shape as the unsupported-topic failures, and if the guard ever catches those it will catch this too. Reported separately for that reason.",
    spec: screen({ card: hotelCard("HT-105", { note: "A short walk from the tram." }) }),
    expect: { kept: ["card"], present: ["A short walk from the tram."] },
  },
  {
    id: "clean-hotels-three-available",
    family: "structure",
    describe: "Three available hotels in one list, none of which should be disturbed.",
    spec: screen(
      { first: hotelCard("HT-101"), second: hotelCard("HT-104"), third: hotelCard("HT-110") },
      { heading: "Places to stay" },
    ),
    expect: { kept: ["first", "second", "third"] },
  },
];
