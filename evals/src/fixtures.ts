import type { ToolResult } from "@genui-guard/core";
import type { JsonRenderElement, JsonRenderSpec } from "@genui-guard/json-render";
import { pathToPointer } from "@genui-guard/json-render";
import { searchFlights, searchHotels, getFareRules } from "../../apps/travel/lib/data.js";

/**
 * The suites run against the demo's own fictional data rather than a second copy
 * of it, so a case can never be right about a fare the application would get
 * wrong. `apps/travel/lib/data.ts` has no imports, which is what makes reaching
 * across for it harmless.
 */
export const FARES = searchFlights("SFO", "LIS");
export const HOTELS = searchHotels("Lisbon");

export const TURN_ID = "eval-turn";

/** The turn every case starts from: one flight search and one hotel search. */
export const standardTurn: ToolResult[] = [
  {
    turnId: TURN_ID,
    toolName: "searchFlights",
    entity: "fares",
    key: "fareId",
    data: FARES,
  },
  {
    turnId: TURN_ID,
    toolName: "searchHotels",
    entity: "hotels",
    key: "hotelId",
    data: HOTELS,
  },
];

/** A turn that also loaded the rules for one fare, for FareRulesCard cases. */
export function turnWithRules(fareId: string): ToolResult[] {
  return [
    ...standardTurn,
    {
      turnId: TURN_ID,
      toolName: "getFareRules",
      entity: "rules",
      data: { [fareId]: { fareId, ...getFareRules(fareId) } },
    },
  ];
}

export function fare(fareId: string) {
  const found = FARES.find((f) => f.fareId === fareId);
  if (!found) throw new Error(`eval fixture names fare ${fareId}, which the search does not return`);
  return found;
}

export function hotel(hotelId: string) {
  const found = HOTELS.find((h) => h.hotelId === hotelId);
  if (!found) throw new Error(`eval fixture names hotel ${hotelId}, which the search does not return`);
  return found;
}

/** A direct state reference, in json-render's own form. */
export function ref(path: string): { $state: string } {
  return { $state: pathToPointer(path) };
}

export function flightProps(fareId: string): Record<string, unknown> {
  return {
    airline: ref(`fares.${fareId}.airline`),
    price: ref(`fares.${fareId}.price`),
    stops: ref(`fares.${fareId}.stops`),
    depart: ref(`fares.${fareId}.depart`),
    arrive: ref(`fares.${fareId}.arrive`),
    badges: null,
    note: null,
  };
}

export function hotelProps(hotelId: string): Record<string, unknown> {
  return {
    name: ref(`hotels.${hotelId}.name`),
    nightly: ref(`hotels.${hotelId}.nightly`),
    rating: ref(`hotels.${hotelId}.rating`),
    imageUrl: ref(`hotels.${hotelId}.imageUrl`),
    imageAlt: ref(`hotels.${hotelId}.imageAlt`),
    badges: null,
    note: null,
  };
}

export function fareRulesProps(fareId: string): Record<string, unknown> {
  return {
    refundable: ref(`rules.${fareId}.refundable`),
    changeFee: ref(`rules.${fareId}.changeFee`),
    bagsIncluded: ref(`rules.${fareId}.bagsIncluded`),
  };
}

export function flight(fareId: string, overrides: Record<string, unknown> = {}): JsonRenderElement {
  return { type: "FlightCard", props: { ...flightProps(fareId), ...overrides }, children: [] };
}

export function hotelCard(
  hotelId: string,
  overrides: Record<string, unknown> = {},
): JsonRenderElement {
  return { type: "HotelCard", props: { ...hotelProps(hotelId), ...overrides }, children: [] };
}

export function fareRules(
  fareId: string,
  overrides: Record<string, unknown> = {},
): JsonRenderElement {
  return { type: "FareRulesCard", props: { ...fareRulesProps(fareId), ...overrides }, children: [] };
}

/**
 * A results screen: one Stack with the given children, which is the shape the
 * demo's model output actually takes.
 */
export function screen(
  elements: Record<string, JsonRenderElement>,
  opts: { heading?: string; state?: Record<string, unknown> } = {},
): JsonRenderSpec {
  return {
    root: "root",
    elements: {
      root: {
        type: "Stack",
        props: { gap: 12, heading: opts.heading ?? "Flights to Lisbon" },
        children: Object.keys(elements),
      },
      ...elements,
    },
    ...(opts.state ? { state: opts.state } : {}),
  };
}
