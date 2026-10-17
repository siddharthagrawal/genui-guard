import type { CaseOutcome, EvalReport, SuiteResult, Thresholds } from "./types.js";

export function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

export function pct(value: number | null, digits = 1): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`;
}

export function summarise(
  suites: SuiteResult[],
  thresholds: Thresholds,
  durationMs: number,
): EvalReport {
  const clean = suites.filter((s) => s.kind === "clean").flatMap((s) => s.cases);
  const detection = suites.filter((s) => s.kind === "detection").flatMap((s) => s.cases);

  const falseBlockRate = rate(clean.filter((c) => c.falseBlock).length, clean.length);
  const falseModificationRate = rate(
    clean.filter((c) => c.falseModification).length,
    clean.length,
  );
  const detectionRate = rate(detection.filter((c) => c.passed).length, detection.length);

  const detectionByFamily: EvalReport["detectionByFamily"] = {};
  for (const outcome of detection) {
    const bucket = (detectionByFamily[outcome.family] ??= { total: 0, caught: 0 });
    bucket.total += 1;
    if (outcome.passed) bucket.caught += 1;
  }

  return {
    suites,
    falseBlockRate,
    falseModificationRate,
    detectionRate,
    detectionByFamily,
    collateral: detection.filter((c) => c.collateral).length,
    thresholds,
    failures: violations(
      { falseBlockRate, falseModificationRate, detectionRate, detectionByFamily },
      thresholds,
    ),
    durationMs,
  };
}

/**
 * Thresholds are a floor, not a verdict on the product. A run that trips one
 * says the number moved, and the report says in which direction and on which
 * cases, which is the only thing a failing check can usefully tell anyone.
 */
function violations(
  measured: Pick<
    EvalReport,
    "falseBlockRate" | "falseModificationRate" | "detectionRate" | "detectionByFamily"
  >,
  thresholds: Thresholds,
): string[] {
  const out: string[] = [];

  const max = (
    label: string,
    value: number | null,
    limit: number | undefined,
  ): void => {
    if (limit === undefined || value === null) return;
    if (value > limit) out.push(`${label} is ${pct(value)}, above the ${pct(limit)} limit`);
  };

  const min = (label: string, value: number | null, limit: number | undefined): void => {
    if (limit === undefined || value === null) return;
    if (value < limit) out.push(`${label} is ${pct(value)}, below the ${pct(limit)} floor`);
  };

  max("false-block rate", measured.falseBlockRate, thresholds.maxFalseBlockRate);
  max(
    "false-modification rate",
    measured.falseModificationRate,
    thresholds.maxFalseModificationRate,
  );
  min("detection rate", measured.detectionRate, thresholds.minDetectionRate);

  for (const [family, floor] of Object.entries(thresholds.minDetectionByFamily ?? {})) {
    const bucket = measured.detectionByFamily[family];
    if (!bucket) {
      out.push(`a detection floor is set for the family "${family}", which has no cases`);
      continue;
    }
    min(`detection on ${family}`, rate(bucket.caught, bucket.total), floor);
  }

  return out;
}

export function worstFirst(cases: CaseOutcome[]): CaseOutcome[] {
  const weight = (c: CaseOutcome): number =>
    c.falseBlock ? 0 : c.falseModification ? 1 : c.passed ? 3 : 2;
  return [...cases].sort((a, b) => weight(a) - weight(b) || a.id.localeCompare(b.id));
}
