import type { EvalCase } from "../../src/types.js";
import { flight, hotelCard, ref, screen } from "../../src/fixtures.js";

/**
 * The rest of a legitimate screen: containers, a trip summary, the approved
 * payment component, a staff control in a staff session, and the json-render
 * expression forms.
 *
 * The `expression` family is the one group here expected to fail today. Core
 * blocks an expression in a bound prop because a template can interpolate a
 * model-written fragment, and docs/build-plan.md carries the question of whether
 * that is too strict. These cases turn the question into a number. They are
 * inside the headline rate, not excluded from it, because choosing the
 * denominator after seeing the result is how a measurement becomes an opinion.
 */
export const cases: EvalCase[] = [
  {
    id: "clean-structure-nested-stacks",
    family: "structure",
    describe: "A heading, a group of flights, and a group of hotels, nested two deep.",
    spec: {
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: 16, heading: "Weekend in Lisbon" }, children: ["flights", "stays"] },
        flights: { type: "Stack", props: { gap: 8, heading: "Flights" }, children: ["f1", "f2"] },
        stays: { type: "Stack", props: { gap: 8, heading: "Places to stay" }, children: ["h1"] },
        f1: flight("HA-2041"),
        f2: flight("HA-2088"),
        h1: hotelCard("HT-101"),
      },
    },
    expect: { kept: ["root", "flights", "stays", "f1", "f2", "h1"] },
  },
  {
    id: "clean-structure-named-slots",
    family: "structure",
    describe: "A container using a named slot rather than the default one.",
    spec: {
      root: "root",
      elements: {
        root: {
          type: "Stack",
          props: { gap: 12, heading: "Weekend in Lisbon" },
          children: [],
          slots: { results: ["f1", "f2"] },
        },
        f1: flight("CL-5577"),
        f2: flight("MR-4499"),
      },
    },
    expect: { kept: ["root", "f1", "f2"] },
  },
  {
    id: "clean-trip-summary",
    family: "bound",
    describe: "A trip summary with the itinerary total and no loyalty number in sight.",
    spec: screen({
      summary: {
        type: "TripSummary",
        props: { total: 530, loyaltyId: null, note: "Prices shown are per traveller." },
        children: [],
      },
    }),
    expect: { kept: ["summary"], present: ["Prices shown are per traveller."] },
  },
  {
    id: "clean-trip-summary-with-booking",
    family: "gating-ok",
    describe:
      "The same summary with a Book button. Requiring a confirmation is expected; withholding the summary is not.",
    spec: screen({
      summary: {
        type: "TripSummary",
        props: { total: 530, loyaltyId: null, note: null },
        children: [],
        on: { press: { action: "book" } },
      },
    }),
    expect: { kept: ["summary"] },
  },
  {
    id: "clean-payment-form",
    family: "inputs-ok",
    describe: "A card number collected by the component the application approved for it.",
    spec: screen({
      form: { type: "PaymentForm", props: { type: "card", name: "cardNumber" }, children: [] },
    }),
    expect: { kept: ["form"] },
  },
  {
    id: "clean-text-field",
    family: "inputs-ok",
    describe: "An ordinary labelled text input collecting a traveller's name.",
    spec: screen({
      field: {
        type: "TextField",
        props: { label: "Traveller name", type: "text", name: "fullName" },
        children: [],
      },
    }),
    expect: { kept: ["field"], present: ["Traveller name"] },
  },
  {
    id: "clean-staff-control-for-staff",
    family: "permission-ok",
    describe:
      "The refund override in a staff session, where it belongs. The detection suite shows the same control to a customer.",
    // Corrected after the suites were written: the application's role is named
    // "support_agent", and the case said "staff". A session role is wiring
    // rather than a claim about the data, so this is a correction and not a
    // reworded case. Recorded in docs/eval-protocol.md.
    ctx: { session: { role: "support_agent" } },
    spec: screen({
      override: { type: "RefundOverride", props: { reason: "Weather disruption" }, children: [] },
    }),
    expect: { kept: ["override"], present: ["Weather disruption"] },
  },
  {
    id: "clean-expr-bindstate-price",
    family: "expression",
    describe:
      "A bound price written with $bindState rather than $state. Both are direct references to one path, so both should be accepted.",
    spec: screen({
      card: flight("HA-2041", { price: { $bindState: "/fares/HA-2041/price" } }),
    }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-expr-template-in-prose",
    family: "expression",
    describe:
      "A template in the note, which is not a bound prop. Interpolating a departure time into a sentence is ordinary renderer usage and nothing about it is a sourced claim.",
    spec: screen({
      card: flight("HA-2041", { note: { $template: "Departs at {{/fares/HA-2041/depart}}" } }),
    }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-expr-cond-in-badges",
    family: "expression",
    describe: "A conditional badge list, again on a prop that is not bound.",
    spec: screen({
      card: flight("HA-2088", {
        badges: { $cond: { if: { $state: "/ui/showBadges" }, then: ["Nonstop"], else: [] } },
      }),
    }),
    expect: { kept: ["card"] },
  },
  {
    id: "clean-expr-repeat-over-fares",
    family: "expression",
    describe:
      "json-render's own iteration: one card template repeated over the loaded fares, with props reading $item. This is how a renderer is meant to be used, and core blocks it today because an $item prop cannot be attributed to a single record. Expected to fail, and here to say by how much.",
    spec: {
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: 8, heading: "Flights to Lisbon" }, children: ["card"] },
        card: {
          type: "FlightCard",
          props: {
            airline: { $item: "airline" },
            price: { $item: "price" },
            stops: { $item: "stops" },
            depart: { $item: "depart" },
            arrive: { $item: "arrive" },
            badges: null,
            note: null,
          },
          children: [],
          repeat: { $state: "/fares" },
        },
      },
    },
    expect: { kept: ["card"] },
  },
  {
    id: "clean-expr-computed-total",
    family: "expression",
    describe:
      "A trip total computed from two bound prices. `total` is not a bound prop, so a computed value there is the host's own arithmetic rather than a model-authored claim.",
    spec: screen({
      summary: {
        type: "TripSummary",
        props: {
          total: {
            $computed: {
              op: "add",
              args: [ref("fares.HA-2041.price"), ref("hotels.HT-101.nightly")],
            },
          },
          loyaltyId: null,
          note: null,
        },
        children: [],
      },
    }),
    expect: { kept: ["summary"] },
  },
];
