import { defineCatalog, defineSchema } from "@json-render/core";
import { z } from "zod";

/**
 * An ordinary json-render catalog. Nothing here is specific to genui-guard,
 * which is the point: the guard reads this through an adapter rather than
 * asking for a second declaration of the same components.
 */
export const schema = defineSchema((s) => ({
  spec: s.object({
    root: s.object({
      type: s.ref("catalog.components"),
      props: s.propsOf("catalog.components"),
      children: s.array(s.string()),
    }),
  }),
  catalog: s.object({
    components: s.map({ props: s.zod(), description: s.string() }),
    actions: s.map({ description: s.string() }),
  }),
}));

export const catalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({ gap: z.number().nullable(), heading: z.string().nullable() }),
      description: "A vertical group with an optional heading",
    },
    FlightCard: {
      props: z.object({
        airline: z.string(),
        price: z.number(),
        stops: z.number(),
        depart: z.string().nullable(),
        arrive: z.string().nullable(),
        badges: z.array(z.string()).nullable(),
        note: z.string().nullable(),
      }),
      description: "One flight option with its fare",
    },
    HotelCard: {
      props: z.object({
        name: z.string(),
        nightly: z.number(),
        rating: z.number().nullable(),
        imageUrl: z.string().nullable(),
        imageAlt: z.string().nullable(),
        badges: z.array(z.string()).nullable(),
        note: z.string().nullable(),
      }),
      description: "One hotel option with its nightly rate",
    },
    FareRulesCard: {
      props: z.object({
        refundable: z.boolean(),
        changeFee: z.number(),
        bagsIncluded: z.number(),
      }),
      description: "The fare rules behind a flight",
    },
    TripSummary: {
      props: z.object({
        total: z.number().nullable(),
        loyaltyId: z.string().nullable(),
        note: z.string().nullable(),
      }),
      description: "Itinerary totals and the booking action",
    },
    RefundOverride: {
      props: z.object({ reason: z.string().nullable() }),
      description: "Staff only. Overrides a fare's refund rules",
    },
    PaymentForm: {
      props: z.object({ type: z.string().nullable(), name: z.string().nullable() }),
      description: "Approved host component for payment and credential fields",
    },
    TextField: {
      props: z.object({
        label: z.string().nullable(),
        type: z.string().nullable(),
        name: z.string().nullable(),
      }),
      description: "A single line input",
    },
  },
  actions: {
    book: { description: "Books the itinerary and charges the card" },
    refund: { description: "Issues a refund" },
    filter: { description: "Narrows the results" },
  },
});
