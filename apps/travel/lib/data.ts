/**
 * Every airline, hotel, route, price and policy here is invented. None of it
 * describes a real company or a real product, which is the point: a project
 * about fabricated claims should not make any of its own.
 */

export type Fare = {
  fareId: string;
  airline: string;
  origin: string;
  destination: string;
  depart: string;
  arrive: string;
  stops: number;
  price: number;
  seatsLeft: number;
  fareRules: {
    refundable: boolean;
    changeFee: number;
    bagsIncluded: number;
  };
};

export type Hotel = {
  hotelId: string;
  name: string;
  city: string;
  nightly: number;
  rating: number;
  imageUrl: string;
  imageAlt: string;
  freeCancellation: boolean;
  roomsLeft: number;
};

const IMG = "https://img.travel-demo.test";

export const FARES: Fare[] = [
  f("HA-2041", "Harbor Air", "SFO", "LIS", "08:15", "11:40", 1, 412, 4, false, 90, 1),
  f("HA-2088", "Harbor Air", "SFO", "LIS", "14:05", "16:55", 0, 689, 2, true, 0, 2),
  f("HA-3312", "Harbor Air", "SFO", "LIS", "22:30", "06:10", 1, 377, 9, false, 120, 0),
  f("CL-5501", "Coastline Air", "SFO", "LIS", "06:45", "10:20", 1, 455, 6, false, 75, 1),
  f("CL-5540", "Coastline Air", "SFO", "LIS", "19:10", "23:05", 0, 742, 0, true, 0, 2),
  f("CL-5577", "Coastline Air", "SFO", "LIS", "11:25", "15:50", 2, 318, 12, false, 150, 0),
  f("NV-1120", "Northvale", "SFO", "LIS", "07:30", "12:15", 1, 521, 3, true, 50, 1),
  f("NV-1166", "Northvale", "SFO", "LIS", "16:40", "20:25", 0, 798, 1, true, 0, 2),
  f("NV-1203", "Northvale", "SFO", "LIS", "23:55", "08:30", 2, 349, 7, false, 140, 0),
  f("MR-4410", "Meridian Wing", "SFO", "LIS", "09:00", "13:35", 1, 468, 5, false, 85, 1),
  f("MR-4455", "Meridian Wing", "SFO", "LIS", "13:20", "17:05", 0, 715, 0, true, 0, 2),
  f("MR-4499", "Meridian Wing", "SFO", "LIS", "20:45", "04:20", 1, 392, 8, false, 110, 1),
  f("HA-7701", "Harbor Air", "JFK", "LIS", "18:30", "06:45", 0, 544, 6, true, 0, 2),
  f("HA-7744", "Harbor Air", "JFK", "LIS", "21:15", "10:05", 1, 421, 11, false, 95, 1),
  f("CL-8820", "Coastline Air", "JFK", "LIS", "17:50", "05:30", 0, 598, 3, true, 25, 2),
  f("CL-8866", "Coastline Air", "JFK", "LIS", "10:10", "22:40", 1, 386, 14, false, 130, 0),
  f("NV-9910", "Northvale", "JFK", "LIS", "19:25", "07:15", 0, 629, 2, true, 0, 2),
  f("NV-9955", "Northvale", "JFK", "LIS", "08:40", "20:20", 2, 334, 10, false, 160, 0),
  f("MR-6630", "Meridian Wing", "JFK", "LIS", "16:05", "04:50", 1, 447, 7, false, 80, 1),
  f("MR-6688", "Meridian Wing", "JFK", "LIS", "22:20", "11:00", 0, 672, 4, true, 0, 2),
];

export const HOTELS: Hotel[] = [
  h("HT-101", "Azul Rooms", "Lisbon", 118, 4.4, "Tiled courtyard with blue shutters", true, 3),
  h("HT-102", "Casa Pombal", "Lisbon", 96, 4.1, "Narrow stone townhouse at dusk", false, 7),
  h("HT-103", "Alfama Quiet House", "Lisbon", 142, 4.7, "Rooftop terrace above red roofs", true, 0),
  h("HT-104", "Praça Nine", "Lisbon", 174, 4.6, "Corner building on a wide plaza", true, 2),
  h("HT-105", "The Tram Stop Inn", "Lisbon", 87, 3.8, "Yellow tram passing a doorway", false, 12),
  h("HT-106", "Miradouro Lofts", "Lisbon", 203, 4.8, "Loft window overlooking the river", true, 1),
  h("HT-107", "Baixa Garden Rooms", "Lisbon", 131, 4.3, "Interior garden with orange trees", false, 5),
  h("HT-108", "Rua Verde Hostel", "Lisbon", 54, 3.5, "Bunk room with tall green shutters", false, 0),
  h("HT-109", "Belém Water House", "Lisbon", 158, 4.5, "White facade near the waterfront", true, 4),
  h("HT-110", "Estrela Small Hotel", "Lisbon", 112, 4.2, "Pastel entrance beside a park", true, 9),
  h("HT-111", "Chiado Bookshop Rooms", "Lisbon", 149, 4.6, "Reading room lined with shelves", false, 6),
  h("HT-112", "Graça Hill Suites", "Lisbon", 188, 4.4, "Balcony above a steep cobbled hill", true, 2),
];

function f(
  fareId: string,
  airline: string,
  origin: string,
  destination: string,
  depart: string,
  arrive: string,
  stops: number,
  price: number,
  seatsLeft: number,
  refundable: boolean,
  changeFee: number,
  bagsIncluded: number,
): Fare {
  return {
    fareId,
    airline,
    origin,
    destination,
    depart,
    arrive,
    stops,
    price,
    seatsLeft,
    fareRules: { refundable, changeFee, bagsIncluded },
  };
}

function h(
  hotelId: string,
  name: string,
  city: string,
  nightly: number,
  rating: number,
  imageAlt: string,
  freeCancellation: boolean,
  roomsLeft: number,
): Hotel {
  return {
    hotelId,
    name,
    city,
    nightly,
    rating,
    imageUrl: `${IMG}/${hotelId.toLowerCase()}.jpg`,
    imageAlt,
    freeCancellation,
    roomsLeft,
  };
}

/** The tools the agent calls. Deterministic, so replay mode needs no network. */
export function searchFlights(origin: string, destination: string): Fare[] {
  return FARES.filter((fare) => fare.origin === origin && fare.destination === destination);
}

export function searchHotels(city: string): Hotel[] {
  return HOTELS.filter((hotel) => hotel.city === city);
}

export function getFareRules(fareId: string): Fare["fareRules"] | undefined {
  return FARES.find((fare) => fare.fareId === fareId)?.fareRules;
}

export function keyed<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
): Record<string, T> {
  return Object.fromEntries(rows.map((row) => [String(row[key]), row]));
}
