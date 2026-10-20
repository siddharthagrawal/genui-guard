/**
 * Stands in for the json-render catalog a host already has. The real thing is
 * the output of `defineCatalog(schema, { components, actions })`, and the
 * adapter reads it structurally rather than by type, so this shape is all
 * `fromJsonRender` needs. The contract tests in `packages/json-render` check
 * the adapter against the real `@json-render/core`.
 */
export const catalog = {
  componentNames: ["Stack", "FlightCard", "HotelCard", "RefundOverride", "PaymentForm"],
  data: {
    components: {
      Stack: { description: "A vertical group" },
      FlightCard: { description: "One flight option with its fare" },
      HotelCard: { description: "One hotel option with its nightly rate" },
      RefundOverride: { description: "Staff only. Overrides a fare's refund rules" },
      PaymentForm: { description: "Approved host component for payment fields" },
    },
  },
};
