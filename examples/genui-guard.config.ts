/**
 * A worked configuration, kept type-checked so the README quickstart cannot
 * drift away from the real API. This is the shape a host writes by hand.
 */
import { createGuard, createRegistry, policies as p } from "@genui-guard/core";

export const guard = createGuard({
  // A host using a catalog goes through an adapter instead of listing specs.
  registry: createRegistry([
    {
      name: "FlightCard",
      entity: "fares",
      key: "fareId",
      bound: ["airline", "price", "stops"],
      fallback: "FlightCardUnavailable",
    },
    {
      name: "HotelCard",
      entity: "hotels",
      key: "hotelId",
      bound: ["name", "nightly"],
      a11y: { requireAlt: ["imageAlt"] },
    },
    { name: "TripSummary" },
    { name: "RefundOverride" },
    { name: "PaymentForm" },
  ]),

  policies: [
    p.requireBinding(),
    p.dropUnsourcedClaims({
      topics: ["free cancellation", "refundable", "bag included"],
      supportedBy: ["fareRules"],
    }),
    p.excludeWhere("fares", (fare) => fare.seatsLeft === 0, "it is sold out"),
    p.excludeWhere("hotels", (hotel) => hotel.roomsLeft === 0, "it has no rooms left"),
    p.annotateWhere(
      "fares",
      (fare, ctx) => Number(fare.price) > Number(ctx.budget ?? Infinity),
      "Over your stated budget",
    ),
    p.requireRole(["RefundOverride"], "support_agent"),
    p.confirmActions(["book", "cancel", "refund"]),
    p.safeUrls({ imageHosts: ["img.travel-demo.test"], linkHosts: ["travel-demo.test"] }),
    p.restrictInputs({ allow: ["PaymentForm"] }),
    p.maskFields(["loyaltyId"]),
  ],

  holdTimeoutMs: 5000,

  onTrace: (entry) => {
    if ("component" in entry && entry.final !== "allow") {
      console.warn(`[genui-guard] ${entry.component} ${entry.final}`);
    }
  },
});
