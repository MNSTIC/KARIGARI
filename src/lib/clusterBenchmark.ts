/**
 * Anonymous cluster benchmarks — the arithmetic and the privacy rule.
 *
 * Pure: no Prisma, no React. The reads live in src/lib/benchmarkRecord.ts.
 *
 * A leaderboard naming the highest earner in a village of forty weavers creates
 * real conflict between neighbours, and a disclaimer does not prevent it. The
 * control here is technical rather than editorial:
 *
 *   - **k-anonymity.** Nothing is shown until at least MIN_COHORT *other*
 *     artisans are active in the comparison. Below that the caller returns a
 *     refusal that carries no figure at all — not in the UI and not in the JSON,
 *     because a payload is as public as a screenshot of it.
 *   - **Medians, never means.** One large seller must not set the bar for a
 *     cluster of people who sell one saree a month.
 *   - **Quartiles, never ranks.** The finest position this file will express is
 *     BELOW / MIDDLE / ABOVE. There is no "you are 3rd of 9", no percentile, and
 *     no name, id or photo anywhere in the result — the type simply has no field
 *     that could carry one.
 *
 * Every figure is per artisan over the same fixed window, so a cohort member who
 * joined last week is not compared against a year of somebody else's work.
 */

/**
 * Minimum peers — artisans OTHER than the one asking — before a cluster figure
 * may be shown. Five is the k in k-anonymity here: with four peers, an artisan
 * who knows their village can often work out whose number moved the median.
 */
export const MIN_COHORT = 5;

/** How far the one widening step reaches, when the cluster itself is too small. */
export const REGION_RADIUS_KM = 150;

/** The comparison window. Everything below is "in the last 90 days". */
export const BENCHMARK_WINDOW_DAYS = 90;

/** That window in whole months, so "per month" is an honest division. */
export const BENCHMARK_MONTHS = 3;

export type BenchmarkScope = 'CLUSTER' | 'REGION';
export type QuartilePosition = 'BELOW' | 'MIDDLE' | 'ABOVE';
export type BenchmarkMetricKey = 'monthlyEarnings' | 'listings' | 'fulfilment' | 'avgPrice';

/** The order the four figures are rendered in. */
export const BENCHMARK_METRICS: readonly BenchmarkMetricKey[] = [
  'monthlyEarnings',
  'listings',
  'fulfilment',
  'avgPrice',
];

/** The i18n key for each metric's own label. */
export const BENCHMARK_METRIC_LABEL_KEYS: Record<BenchmarkMetricKey, string> = {
  monthlyEarnings: 'benchmark_monthly_earnings',
  listings: 'benchmark_listings',
  fulfilment: 'benchmark_fulfilment',
  avgPrice: 'benchmark_avg_price',
};

/**
 * One artisan's four figures over the window.
 *
 * `fulfilment` and `avgPrice` are null when the artisan has no basis for them —
 * nobody accepted an order, or nothing was priced. Null is not zero: a weaver
 * who took no bulk order this quarter does not have a 0 % fulfilment rate, and
 * writing one would put a false number into somebody else's median.
 */
export interface PeerFigures {
  /** Realised platform earnings in the window, divided by BENCHMARK_MONTHS. */
  monthlyEarnings: number;
  /** Pieces catalogued in the window, divided by BENCHMARK_MONTHS. */
  listings: number;
  /** Delivered ÷ accepted demand orders, 0–100. Null with no accepted order. */
  fulfilment: number | null;
  /** Mean asking price of the pieces listed in the window. Null with none. */
  avgPrice: number | null;
}

export interface BenchmarkMetric {
  key: BenchmarkMetricKey;
  /** The artisan's own figure, on exactly the same basis as the median. */
  you: number;
  /** The cohort median — peers only, never including the artisan's own value. */
  median: number;
  position: QuartilePosition;
  /** How many peers had a value for this metric. Never below MIN_COHORT. */
  peers: number;
}

export type BenchmarkResult =
  | {
      available: false;
      scope: null;
      /** Peers found, so the refusal can name the real number. */
      cohortSize: number;
      minCohort: number;
    }
  | {
      available: true;
      scope: BenchmarkScope;
      cohortSize: number;
      minCohort: number;
      metrics: BenchmarkMetric[];
    };

// ------------------------------------------------------------------ the maths

/** Median of a list. Null on an empty one — never 0, which is a real value. */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Where a value sits against a cohort, at quartile resolution and no finer.
 *
 * The halves are split around the median and exclude it on an odd-length list —
 * the ordinary "exclusive" quartile, and the one that behaves sensibly on the
 * small cohorts this file is built for. A value equal to Q1 or Q3 is MIDDLE:
 * the edges belong to the middle, so being exactly at the bar is never reported
 * as being under it.
 */
export function quartilePosition(value: number, peers: number[]): QuartilePosition {
  const sorted = peers.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length < 4) return 'MIDDLE';

  const half = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, half);
  const upper = sorted.slice(sorted.length % 2 === 1 ? half + 1 : half);
  const q1 = median(lower);
  const q3 = median(upper);
  if (q1 === null || q3 === null) return 'MIDDLE';

  if (value < q1) return 'BELOW';
  if (value > q3) return 'ABOVE';
  return 'MIDDLE';
}

/** The peers' values for one metric, with the ones that have no basis dropped. */
function peerValues(peers: PeerFigures[], key: BenchmarkMetricKey): number[] {
  const values: number[] = [];
  for (const peer of peers) {
    const value = peer[key];
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
  }
  return values;
}

/**
 * Build the comparison, or refuse to.
 *
 * `peers` must already exclude the artisan themselves: their own figure must
 * never be part of the median they are being shown, or a cluster of one would
 * cheerfully report that the artisan is exactly average.
 *
 * A metric is dropped — not zeroed, not estimated — when the artisan has no
 * basis for it, or when fewer than MIN_COHORT peers do. That is the same
 * k-anonymity rule applied per figure rather than only to the cohort as a whole:
 * if only three of nine peers took a bulk order, their fulfilment rates are
 * three identifiable people's rates.
 */
export function buildBenchmark(
  own: PeerFigures,
  peers: PeerFigures[],
  scope: BenchmarkScope
): BenchmarkResult {
  const cohortSize = peers.length;
  if (cohortSize < MIN_COHORT) {
    return { available: false, scope: null, cohortSize, minCohort: MIN_COHORT };
  }

  const metrics: BenchmarkMetric[] = [];
  for (const key of BENCHMARK_METRICS) {
    const mine = own[key];
    if (typeof mine !== 'number' || !Number.isFinite(mine)) continue;

    const values = peerValues(peers, key);
    if (values.length < MIN_COHORT) continue;

    const mid = median(values);
    if (mid === null) continue;

    metrics.push({
      key,
      you: round(key, mine),
      median: round(key, mid),
      position: quartilePosition(mine, values),
      peers: values.length,
    });
  }

  if (metrics.length === 0) {
    return { available: false, scope: null, cohortSize, minCohort: MIN_COHORT };
  }

  return { available: true, scope, cohortSize, minCohort: MIN_COHORT, metrics };
}

/**
 * Rupees to the rupee, rates to the whole percent, listings to one decimal —
 * "1.7 pieces a month" is true where "2" would round a quiet month away.
 */
function round(key: BenchmarkMetricKey, value: number): number {
  if (key === 'listings') return Math.round(value * 10) / 10;
  return Math.round(value);
}

/** Per-month figures over the fixed window. Kept here so both sides divide alike. */
export function perMonth(total: number): number {
  return total / BENCHMARK_MONTHS;
}

/**
 * Delivered ÷ accepted, as a percentage. Null when nothing was accepted — see
 * the note on `PeerFigures.fulfilment`.
 */
export function fulfilmentRate(accepted: number, delivered: number): number | null {
  if (accepted <= 0) return null;
  return Math.max(0, Math.min(100, (delivered / accepted) * 100));
}
