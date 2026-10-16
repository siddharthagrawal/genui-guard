/**
 * json-render addresses state with JSON Pointer ("/fares/HA-2041/price") while
 * genui-guard's core uses dotted paths, because core has no reason to know one
 * renderer's convention. Translation lives here and nowhere else.
 */

/** "/fares/HA-2041/price" -> "fares.HA-2041.price" */
export function pointerToPath(pointer: string): string {
  return pointer
    .split("/")
    .filter((s) => s.length > 0)
    .map(unescapePointerSegment)
    .join(".");
}

/** "fares.HA-2041.price" -> "/fares/HA-2041/price" */
export function pathToPointer(path: string): string {
  const segments = path.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) return "";
  return `/${segments.map(escapePointerSegment).join("/")}`;
}

// RFC 6901: ~0 is a literal "~", ~1 is a literal "/". Order matters both ways.
function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
