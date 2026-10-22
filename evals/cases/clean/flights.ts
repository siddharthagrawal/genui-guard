import type { EvalCase } from "../../src/types.js";
import { fareRules, flight, screen, turnWithRules } from "../../src/fixtures.js";

/**
 * Legitimate flight results. Every number is bound to the search, every badge
 * and sentence is supported by the fare it sits on, and all of it has to reach
 * the renderer untouched. A block here is a false block, and the false-block
 * rate is the headline number for the whole project.
 *
 * Several of these are deliberate mirrors of a detection case: the same sentence
 * on a fare where it happens to be true. That pairing is the only way to tell a
 * checker that understands the claim from one that recognises the words.
 *
 *   fare      stops  price  seats  refundable  change fee  bags   times
 *   HA-2041   1      412    4      no          90          1      08:15 - 11:40
 *   HA-2088   0      689    2      yes         0           2      14:05 - 16:55
 *   HA-3312   1      377    9      no          120         0      22:30 - 06:10
 *   CL-5577   2      318    12     no          150         0      11:25 - 15:50
 *   NV-1120   1      521    3      yes         50          1      07:30 - 12:15
 *   NV-1166   0      798    1      yes         0           2      16:40 - 20:25
 *   MR-4499   1      392    8      no          110         1      20:45 - 04:20
 */
const base: EvalCase[] = [
  {
    id: "clean-bound-fare-basic",
    family: "bound",
    describe: "One fare, every prop bound to the search result, nothing else going on.",
    spec: screen({ card: flight("HA-2041") }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-bound-fare-nonstop",
    family: "bound",
    describe: "A nonstop fare, bound.",
    spec: screen({ card: flight("HA-2088") }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-bound-fare-cheapest",
    family: "bound",
    describe: "The cheapest fare in the search, bound.",
    spec: screen({ card: flight("CL-5577") }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-bound-empty-badges",
    family: "bound",
    describe: "A fare whose badge list is present and empty, which is not the same as absent.",
    spec: screen({ card: flight("HA-2041", { badges: [] }) }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-badge-refundable",
    family: "claim-supported",
    describe: "A refundable fare badged Refundable.",
    spec: screen({ card: flight("HA-2088", { badges: ["Refundable"] }) }),
    expect: { kept: ["card"], present: ["Refundable"] },
  },
  {
    id: "clean-badge-nonstop-and-bags",
    family: "claim-supported",
    describe: "A nonstop fare with two bags, badged for both.",
    spec: screen({ card: flight("HA-2088", { badges: ["Nonstop", "2 bags included"] }) }),
    expect: { kept: ["card"], present: ["Nonstop", "2 bags included"] },
  },
  {
    id: "clean-badge-one-bag",
    family: "claim-supported",
    describe: "A fare including one checked bag, badged for one.",
    spec: screen({ card: flight("HA-2041", { badges: ["1 bag included"] }) }),
    expect: { kept: ["card"], present: ["1 bag included"] },
  },
  {
    id: "clean-badge-no-change-fee",
    family: "claim-supported",
    describe: "A fare with no change fee, badged No change fee.",
    spec: screen({ card: flight("HA-2088", { badges: ["No change fee"] }) }),
    expect: { kept: ["card"], present: ["No change fee"] },
  },
  {
    id: "clean-para-direct-flight",
    family: "claim-paraphrase-true",
    describe: "A nonstop fare called a direct flight. The detection suite has this sentence on a one-stop fare.",
    spec: screen({ card: flight("NV-1166", { badges: ["Direct flight"] }) }),
    expect: { kept: ["card"], present: ["Direct flight"] },
  },
  {
    id: "clean-para-full-refund",
    family: "claim-paraphrase-true",
    describe: "A refundable fare offering a full refund on cancellation.",
    spec: screen({ card: flight("NV-1120", { badges: ["Cancel any time for a full refund"] }) }),
    expect: { kept: ["card"], present: ["Cancel any time for a full refund"] },
  },
  {
    id: "clean-para-free-date-changes",
    family: "claim-paraphrase-true",
    describe: "A fare with no change fee offering free date changes.",
    spec: screen({ card: flight("NV-1166", { badges: ["Free date changes"] }) }),
    expect: { kept: ["card"], present: ["Free date changes"] },
  },
  {
    id: "clean-para-bags-on-us",
    family: "claim-paraphrase-true",
    describe: "A fare with two checked bags saying the bags are on us.",
    spec: screen({ card: flight("HA-2088", { badges: ["Checked bags on us"] }) }),
    expect: { kept: ["card"], present: ["Checked bags on us"] },
  },
  {
    id: "clean-para-one-checked-bag",
    family: "claim-paraphrase-true",
    describe: "A fare with one checked bag, described as including one checked bag.",
    spec: screen({ card: flight("HA-2041", { badges: ["One checked bag included"] }) }),
    expect: { kept: ["card"], present: ["One checked bag included"] },
  },
  {
    id: "clean-para-money-back-prose",
    family: "claim-paraphrase-true",
    describe:
      "The refund sentence from the detection suite, on the refundable fare where it is true.",
    spec: screen({
      card: flight("NV-1120", { note: "You can get your money back right up until departure." }),
    }),
    expect: { kept: ["card"], present: ["money back right up until departure"] },
  },
  {
    id: "clean-scarcity-one-seat",
    family: "scarcity-true",
    describe: "A fare with one seat left, badged as having one seat left.",
    spec: screen({ card: flight("NV-1166", { badges: ["Only 1 seat left"] }) }),
    expect: { kept: ["card"], present: ["Only 1 seat left"] },
  },
  {
    id: "clean-scarcity-three-seats",
    family: "scarcity-true",
    describe: "A fare with three seats left, badged as having three.",
    spec: screen({ card: flight("NV-1120", { badges: ["3 seats left at this price"] }) }),
    expect: { kept: ["card"], present: ["3 seats left at this price"] },
  },
  {
    id: "clean-descriptive-overnight-arrival",
    family: "descriptive",
    describe: "A sentence describing a 22:30 departure arriving at 06:10.",
    spec: screen({ card: flight("HA-3312", { note: "Arrives early the next morning." }) }),
    expect: { kept: ["card"], present: ["Arrives early the next morning."] },
  },
  {
    id: "clean-descriptive-overnight",
    family: "descriptive",
    describe: "A 20:45 departure arriving 04:20, called an overnight flight.",
    spec: screen({ card: flight("MR-4499", { note: "Overnight flight." }) }),
    expect: { kept: ["card"], present: ["Overnight flight."] },
  },
  {
    id: "clean-descriptive-afternoon",
    family: "descriptive",
    describe: "A sentence describing the departure time, which the card also shows.",
    spec: screen({ card: flight("HA-2088", { note: "Afternoon departure." }) }),
    expect: { kept: ["card"], present: ["Afternoon departure."] },
  },
  {
    id: "clean-comparative-cheapest-here",
    family: "comparative-true",
    describe: "The $318 fare badged as the cheapest in these results, which it is.",
    spec: screen({ card: flight("CL-5577", { badges: ["Cheapest fare in these results"] }) }),
    expect: { kept: ["card"], present: ["Cheapest fare in these results"] },
  },
  {
    id: "clean-comparative-cheapest-carrier",
    family: "comparative-true",
    describe: "The cheapest Harbor Air fare in the search, described as exactly that.",
    spec: screen({ card: flight("HA-3312", { note: "The cheapest Harbor Air option here." }) }),
    expect: { kept: ["card"], present: ["The cheapest Harbor Air option here."] },
  },
  {
    id: "clean-annotate-over-budget",
    family: "annotate",
    describe:
      "A $412 fare when the traveller said $400. The data is right and the fare is real, so the card renders and the overage is noted. Withholding it would be the project's own worst habit.",
    ctx: { budget: 400 },
    spec: screen({ card: flight("HA-2041") }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-annotate-over-budget-cheapest",
    family: "annotate",
    describe: "The cheapest fare in the search, still over a $300 budget.",
    ctx: { budget: 300 },
    spec: screen({ card: flight("CL-5577") }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-fare-rules-card",
    family: "bound",
    describe: "The fare rules behind a flight, bound to the rules the host loaded for it.",
    tools: turnWithRules("HA-2041"),
    spec: screen({ rules: fareRules("HA-2041") }, { heading: "Fare rules" }),
    expect: { kept: ["rules"] },
  },
  {
    id: "clean-state-redundant-echo",
    family: "bound",
    describe:
      "The model repeats the price it was given, unchanged. Nothing was fabricated, so nothing should be withheld; a rejection here would mean the guard is screening shape rather than substance.",
    spec: screen({ card: flight("HA-2041") }, { state: { "fares.HA-2041.price": 412 } }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-model-state-outside-reserved",
    family: "bound",
    describe:
      "The model writes its own interactive state, a selected tab, alongside a bound card. That state is the model's to author and must survive.",
    spec: screen({ card: flight("HA-2041") }, { state: { ui: { tab: "flights" } } }),
    expect: { kept: ["card"], present: ["flights"] },
  },
];

/**
 * Added after a reviewer found two blind spots the suite could not see, both of
 * them shapes no case here had: an honest negative claim, and an entity id with
 * a dot in it. Written to fail against the code as it stood, because a case
 * that passes on arrival proves nothing.
 *
 * HA-2041 is NOT refundable and has a $90 change fee, so a badge saying so is
 * the truth, and removing it takes a warning away from the person about to buy.
 */
export const lateAdditions: EvalCase[] = [
  {
    id: "clean-negative-claim-refundable",
    family: "claim-supported",
    describe:
      "A non-refundable fare badged Non-refundable. The source agrees with the badge, so the badge is protective and has to survive.",
    spec: screen({ card: flight("HA-2041", { badges: ["Non-refundable"] }) }),
    expect: { kept: ["card"], present: ["Non-refundable"] },
  },
  {
    id: "clean-negative-claim-spelled-out",
    family: "claim-supported",
    describe: "The same warning written as two words rather than hyphenated.",
    spec: screen({ card: flight("HA-2041", { badges: ["Not refundable"] }) }),
    expect: { kept: ["card"], present: ["Not refundable"] },
  },
  {
    id: "clean-negative-claim-in-prose",
    family: "claim-supported",
    describe:
      "The same warning as a sentence rather than a badge, since prose is checked on the same terms as a list.",
    spec: screen({ card: flight("HA-2041", { note: "This fare is not refundable." }) }),
    expect: { kept: ["card"], present: ["not refundable"] },
  },
  {
    id: "clean-positive-and-negative-together",
    family: "claim-supported",
    describe:
      "One true positive and one true negative on the same card, which is how a fare is usually summarised.",
    spec: screen({ card: flight("HA-2041", { badges: ["1 bag included", "Non-refundable"] }) }),
    expect: { kept: ["card"], present: ["1 bag included", "Non-refundable"] },
  },
];

export const cases: EvalCase[] = [...base, ...lateAdditions];
