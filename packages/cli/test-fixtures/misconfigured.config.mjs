import { createRegistry } from "@genui-guard/core";
import { z } from "zod";

/**
 * Every config mistake `genui-guard check` is supposed to catch, in one file:
 * bound props with no entity, bound props with an entity but no key, a bound
 * prop the schema has no such prop for, and a tool result whose array data has
 * no key to address records by.
 */
export default {
  registry: createRegistry([
    { name: "FlightCard", bound: ["price"] },
    { name: "HotelCard", entity: "hotels", bound: ["nightly"] },
    {
      name: "FareRulesCard",
      entity: "rules",
      key: "fareId",
      bound: ["refundabel"],
      props: z.object({ refundable: z.boolean() }),
    },
  ]),
  tools: [{ turnId: "t", toolName: "searchFlights", entity: "", data: [{ fareId: "A" }] }],
  run: () => ({ output: {}, dropped: [], traces: [] }),
};
