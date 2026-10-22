import type { Policy, PolicyInput, PolicyResult, PropValue } from "./types.js";

/**
 * Every reason is one plain sentence a developer can act on, because the reason
 * strings are the trace and someone will read them during an incident.
 *
 * Repairs are subtractive only. Stripping a claim, dropping a URL and adding
 * alt text cannot assert something new. See docs/decisions.md.
 */

const NULLED: PropValue = { kind: "literal", value: null };

function literalString(v: PropValue | undefined): string | undefined {
  if (v?.kind !== "literal") return undefined;
  return typeof v.value === "string" ? v.value : undefined;
}

/** On by default. Verified in provenance.ts; this exists so config reads honestly. */
export function requireBinding(): Policy {
  return { name: "requireBinding", check: () => null };
}

export function dropUnsourcedClaims(opts: {
  topics: string[];
  /** Fields on the source entity that can support a claim, for example fareRules. */
  supportedBy?: string[];
}): Policy {
  const patterns = opts.topics.map((t) => ({
    topic: t,
    re: new RegExp(t.replace(/\s+/g, "\\s+"), "i"),
  }));

  const unsupported = (text: string, entity: Record<string, unknown> | undefined) =>
    patterns.find(({ topic, re }) => {
      const match = re.exec(text);
      if (!match) return false;
      if (!entity) return true;

      const evidence = claimEvidence(entity, topic, opts.supportedBy);
      // No field for this topic at all: unsourced whichever way it is phrased.
      if (evidence === undefined) return true;

      // A claim asserts the topic or denies it, and the source has to agree
      // with whichever was asserted. "Non-refundable" on a fare that is not
      // refundable is the truth, and stripping it takes a warning away from
      // the person about to buy. This is the whole reason evidence is three
      // states rather than a boolean.
      return evidence !== !isNegated(text, match.index);
    });

  return {
    name: "dropUnsourcedClaims",
    check({ element, entity }) {
      const out: PolicyResult[] = [];

      for (const [prop, value] of Object.entries(element.props)) {
        if (value.kind !== "literal") continue;

        // A single string claim. Removing it clears the whole prop.
        if (typeof value.value === "string") {
          const hit = unsupported(value.value, entity);
          if (!hit) continue;

          out.push({
            policy: "dropUnsourcedClaims",
            decision: "repair",
            reason: `${element.type}.${prop} claims "${hit.topic}", which nothing in the source data supports, so the claim was removed.`,
            patch: { [prop]: NULLED },
          });
          continue;
        }

        // A list of claims, which is how most catalogs model badges and tags.
        // Removing the whole prop here would also discard the claims the source
        // does support, so only the offending entries come out.
        if (Array.isArray(value.value) && value.value.every((v) => typeof v === "string")) {
          const entries = value.value as string[];
          const bad: { entry: string; topic: string }[] = [];

          for (const entry of entries) {
            const hit = unsupported(entry, entity);
            if (hit) bad.push({ entry, topic: hit.topic });
          }
          if (bad.length === 0) continue;

          const kept = entries.filter((e) => !bad.some((b) => b.entry === e));
          const removed = bad.map((b) => `"${b.entry}"`).join(", ");

          out.push({
            policy: "dropUnsourcedClaims",
            decision: "repair",
            reason:
              kept.length > 0
                ? `${element.type}.${prop} claimed ${removed}, which nothing in the source data supports, so ${bad.length === 1 ? "it was" : "they were"} removed and the remaining ${kept.length === 1 ? "claim" : "claims"} kept.`
                : `${element.type}.${prop} claimed ${removed}, which nothing in the source data supports, so the list was emptied.`,
            patch: { [prop]: { kind: "literal", value: kept } },
          });
        }
      }

      return out.length > 0 ? out : null;
    },
  };
}

const NEGATORS = /\b(no|not|non|without|never|excludes?|excluding)\s*-?\s*$/i;

/**
 * Whether the claim denies its topic rather than asserting it.
 *
 * Only the words immediately before the match count, so "Refundable, no change
 * fees" reads as a positive refund claim rather than a negated one: the "no"
 * belongs to the change fee, not to the refund. Crude, and crude in the right
 * direction, because the cost of a false negation is keeping a claim that
 * should have gone rather than deleting one that was true.
 */
function isNegated(text: string, at: number): boolean {
  return NEGATORS.test(text.slice(Math.max(0, at - 24), at));
}

/**
 * Field names and claim topics are written by different people in different
 * styles: a topic reads "bag included" and the field is `bagsIncluded`. Matching
 * the raw strings strips true claims, so both sides are reduced to crudely
 * singularised word tokens before comparison.
 */
function tokens(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .join(" ");
}

/** True when a value says the claim holds, rather than merely existing. */
function affirms(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text.length > 0 && text !== "false" && text !== "no" && text !== "none" && text !== "0";
  }
  return false;
}

/**
 * What the source says about a topic: `true` when a matching field affirms it,
 * `false` when a matching field denies it, and `undefined` when there is no
 * field for it at all. The third state is what lets a denial be verified
 * instead of deleted.
 */
function claimEvidence(
  entity: Record<string, unknown>,
  topic: string,
  supportedBy: string[] | undefined,
): boolean | undefined {
  // The entity's own fields always count. `supportedBy` names extra nested
  // places to look, such as a fare's rules object, rather than replacing the
  // root. Treating it as a replacement strips true claims from entities that
  // keep them at the top level, which is a false block of the worst kind,
  // since the data supported the claim all along.
  const haystacks: unknown[] = [entity, ...(supportedBy ?? []).map((f) => entity[f])];
  const wanted = tokens(topic);

  let found: boolean | undefined;
  for (const h of haystacks) {
    if (h === null || typeof h !== "object") continue;
    for (const [field, value] of Object.entries(h as Record<string, unknown>)) {
      if (tokens(field) !== wanted) continue;
      // An affirming field anywhere wins, since rules are often duplicated
      // between a record and its nested rule object.
      if (affirms(value)) return true;
      found = false;
    }
  }
  return found;
}

export function excludeWhere(
  entity: string,
  predicate: (record: Record<string, unknown>) => boolean,
  reason = "it is unavailable",
): Policy {
  return {
    name: "excludeWhere",
    check({ element, spec, entity: record }) {
      if (spec?.entity !== entity || !record) return null;
      if (!predicate(record)) return null;

      return {
        policy: "excludeWhere",
        decision: "block",
        reason: `${element.type} was removed because ${reason}.`,
      };
    },
  };
}

/**
 * Annotates rather than blocks, because an over-budget result is accurate data
 * the user may still want. See docs/decisions.md.
 */
export function annotateWhere(
  entity: string,
  predicate: (record: Record<string, unknown>, ctx: PolicyInput["ctx"]) => boolean,
  note: string,
): Policy {
  return {
    name: "annotateWhere",
    check({ element, spec, entity: record, ctx }) {
      if (spec?.entity !== entity || !record) return null;
      if (!predicate(record, ctx)) return null;

      return {
        policy: "annotateWhere",
        decision: "annotate",
        reason: `${element.type} was flagged: ${note}.`,
        note,
      };
    },
  };
}

/** Not a security boundary. Defence in depth only. See the README. */
export function requireRole(components: string[], role: string): Policy {
  const restricted = new Set(components);

  return {
    name: "requireRole",
    check({ element, ctx }) {
      if (!restricted.has(element.type)) return null;
      const actual = ctx.session?.role;
      if (actual === role) return null;

      return {
        policy: "requireRole",
        decision: "block",
        reason: `${element.type} requires the "${role}" role, and this session is "${actual ?? "unauthenticated"}".`,
      };
    },
  };
}

export function confirmActions(names: string[]): Policy {
  const gated = new Set(names);

  return {
    name: "confirmActions",
    check({ element }) {
      if (!element.on) return null;

      const hits = Object.values(element.on)
        .map((a) => a.name)
        .filter((n) => gated.has(n));
      if (hits.length === 0) return null;

      return {
        policy: "confirmActions",
        decision: "gate",
        reason: `${element.type} can fire ${hits.join(", ")}, which changes something, so it now needs a confirmation first.`,
        gatedActions: [...new Set(hits)],
      };
    },
  };
}

const SAFE_SCHEMES = new Set(["https:", "mailto:"]);

export function safeUrls(opts: {
  imageHosts?: string[];
  linkHosts?: string[];
  imageProps?: string[];
  linkProps?: string[];
} = {}): Policy {
  const imageProps = new Set(opts.imageProps ?? ["src", "imageUrl", "image", "photo"]);
  const linkProps = new Set(opts.linkProps ?? ["href", "url", "link"]);

  return {
    name: "safeUrls",
    check({ element }) {
      const out: PolicyResult[] = [];

      for (const [prop, value] of Object.entries(element.props)) {
        const isImage = imageProps.has(prop);
        const isLink = linkProps.has(prop);
        if (!isImage && !isLink) continue;

        const raw = literalString(value);
        if (!raw) continue;

        const allowed = isImage ? opts.imageHosts : opts.linkHosts;
        const problem = urlProblem(raw, allowed);
        if (!problem) continue;

        out.push({
          policy: "safeUrls",
          decision: "repair",
          reason: `${element.type}.${prop} ${problem}, so the URL was removed.`,
          patch: { [prop]: NULLED },
        });
      }

      return out.length > 0 ? out : null;
    },
  };
}

function urlProblem(raw: string, allowedHosts: string[] | undefined): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // A relative path cannot carry a scheme or an off-host origin, so it is fine.
    return raw.startsWith("/") ? null : `is not a valid absolute URL ("${raw}")`;
  }

  if (!SAFE_SCHEMES.has(url.protocol)) {
    return `uses the ${url.protocol} scheme, which is not allowed`;
  }
  if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.includes(url.hostname)) {
    return `points at ${url.hostname}, which is not an approved host`;
  }
  return null;
}

const SENSITIVE_INPUTS = new Set(["password", "card", "cardNumber", "cvv", "otp", "pin", "ssn"]);

export function restrictInputs(opts: { allow: string[] }): Policy {
  const allowed = new Set(opts.allow);

  return {
    name: "restrictInputs",
    check({ element }) {
      if (allowed.has(element.type)) return null;

      const typeProp = literalString(element.props.type);
      const nameProp = literalString(element.props.name);
      const hit =
        (typeProp && SENSITIVE_INPUTS.has(typeProp) ? typeProp : undefined) ??
        (nameProp && SENSITIVE_INPUTS.has(nameProp) ? nameProp : undefined);

      if (!hit) return null;

      return {
        policy: "restrictInputs",
        decision: "block",
        reason: `${element.type} renders a "${hit}" field, and sensitive inputs may only appear inside [${[...allowed].join(", ")}].`,
      };
    },
  };
}

export function maskFields(fields: string[], visible = 4): Policy {
  const targets = new Set(fields);

  return {
    name: "maskFields",
    check({ element }) {
      const out: PolicyResult[] = [];

      for (const [prop, value] of Object.entries(element.props)) {
        if (!targets.has(prop)) continue;
        const text = literalString(value);
        if (!text || text.length <= visible) continue;

        const masked = "•".repeat(Math.max(0, text.length - visible)) + text.slice(-visible);
        out.push({
          policy: "maskFields",
          decision: "repair",
          reason: `${element.type}.${prop} was masked, because it is sensitive and this view may be shared.`,
          patch: { [prop]: { kind: "literal", value: masked } },
        });
      }

      return out.length > 0 ? out : null;
    },
  };
}

export const policies = {
  requireBinding,
  dropUnsourcedClaims,
  excludeWhere,
  annotateWhere,
  requireRole,
  confirmActions,
  safeUrls,
  restrictInputs,
  maskFields,
};
