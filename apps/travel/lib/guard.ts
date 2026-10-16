import { createGuard, policies as p } from "@genui-guard/core";
import { fromJsonRender } from "@genui-guard/json-render";
import { catalog } from "./catalog";

/**
 * The entire genui-guard configuration for this app. It reuses the catalog
 * above and adds only what the guard needs to know on top of it.
 *
 * This module is imported by the server route only. The guard runs on the
 * server, because a check that runs in the browser is a check the client can
 * remove.
 */
export function buildGuard() {
  return createGuard({
    registry: fromJsonRender(catalog, {
      FlightCard: {
        entity: "fares",
        key: "fareId",
        bound: ["airline", "price", "stops"],
      },
      HotelCard: {
        entity: "hotels",
        key: "hotelId",
        bound: ["name", "nightly"],
        a11y: { requireAlt: ["imageAlt"] },
      },
    }),

    policies: [
      p.requireBinding(),
      p.dropUnsourcedClaims({
        topics: ["free cancellation", "refundable", "bag included", "bags included"],
        supportedBy: ["fareRules"],
      }),
      p.excludeWhere("fares", (fare) => fare.seatsLeft === 0, "that fare is sold out"),
      p.excludeWhere("hotels", (hotel) => hotel.roomsLeft === 0, "it has no rooms left"),
      p.annotateWhere(
        "fares",
        (fare, ctx) => Number(fare.price) > Number(ctx.budget ?? Infinity),
        "Over your stated budget",
      ),
      p.requireRole(["RefundOverride"], "support_agent"),
      p.confirmActions(["book", "refund"]),
      p.safeUrls({ imageHosts: ["img.travel-demo.test"], linkHosts: ["travel-demo.test"] }),
      p.restrictInputs({ allow: ["PaymentForm"] }),
      p.maskFields(["loyaltyId"]),
    ],
  });
}
