/**
 * json-render addresses state with JSON Pointer ("/fares/HA-2041/price") while
 * genui-guard's core uses dotted paths, because core has no reason to know one
 * renderer's convention. Translation lives here and nowhere else.
 */

/**
 * "/fares/HA-2041/price" -> "fares.HA-2041.price"
 *
 * A dot inside a segment is escaped on the way in, because real identifiers
 * contain them: "/fares/UA.102.Y/price" becomes "fares.UA\.102\.Y.price" and
 * stays three segments. Without that it became five, the guard looked for a
 * record called "UA", and a valid card was blocked.
 */
export function pointerToPath(pointer: string): string {
  return pointer
    .split("/")
    .filter((s) => s.length > 0)
    .map(unescapePointerSegment)
    .map((segment) => segment.replaceAll(".", "\\."))
    .join(".");
}

/** "fares.HA-2041.price" -> "/fares/HA-2041/price", escaping respected. */
export function pathToPointer(path: string): string {
  const segments = splitEscaped(path);
  if (segments.length === 0) return "";
  return `/${segments.map(escapePointerSegment).join("/")}`;
}

/** Splits on unescaped dots only, so an escaped one stays inside its segment. */
function splitEscaped(path: string): string[] {
  const parts: string[] = [];
  let current = "";

  for (let i = 0; i < path.length; i += 1) {
    const char = path[i]!;
    if (char === "\\" && path[i + 1] === ".") {
      current += ".";
      i += 1;
      continue;
    }
    if (char === ".") {
      if (current.length > 0) parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0) parts.push(current);

  return parts;
}

// RFC 6901: ~0 is a literal "~", ~1 is a literal "/". Order matters both ways.
function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
