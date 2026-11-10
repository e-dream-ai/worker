import { capacity, diagnose, type MaxChangePlan, type Problem, type ProblemKind } from './report.js';
import { isFailure } from './result.js';
import type { AvailabilityLevel, EndpointHealth, EndpointStatus, Snapshot } from './types.js';

export interface RenderOptions {
  readonly color: boolean;
}

const ANSI = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  yellow: [33, 39],
  green: [32, 39],
} as const satisfies Record<string, readonly [open: number, close: number]>;

type Tone = keyof typeof ANSI;

type Align = 'left' | 'right';

interface Column {
  readonly header: string;
  readonly align: Align;
  readonly text: (status: EndpointStatus) => string;
  readonly tone?: (status: EndpointStatus) => Tone | null;
}

const STOCK_TONES = {
  NONE: 'red',
  LOW: 'yellow',
  MEDIUM: null,
  HIGH: 'green',
} as const satisfies Record<AvailabilityLevel, Tone | null>;

const PROBLEM_TONES = {
  'fetch-failed': 'red',
  'no-max': 'red',
  unhealthy: 'red',
  'at-max': 'yellow',
  throttled: 'yellow',
  'over-cap': 'yellow',
  'spend-near-limit': 'yellow',
} as const satisfies Record<ProblemKind, Tone>;

function paint(text: string, tone: Tone | null, { color }: RenderOptions): string {
  if (!color || tone === null) return text;
  const [open, close] = ANSI[tone];
  return `\u001b[${open}m${text}\u001b[${close}m`;
}

const pad = (text: string, width: number, align: Align): string =>
  align === 'right' ? text.padStart(width) : text.padEnd(width);

const formatUsd = (value: number): string => `$${value.toFixed(2)}`;

const countColumn = (header: string, count: (health: EndpointHealth) => number, tone: Tone | null = null): Column => ({
  header,
  align: 'right',
  text: ({ health }) => (isFailure(health) ? '?' : String(count(health.value))),
  tone: ({ health }) => (tone !== null && health.ok && count(health.value) > 0 ? tone : null),
});

const COLUMNS: readonly Column[] = [
  { header: 'ENDPOINT', align: 'left', text: ({ endpoint }) => endpoint.name },
  { header: 'MIN', align: 'right', text: ({ endpoint }) => String(endpoint.workers.min) },
  { header: 'MAX', align: 'right', text: ({ endpoint }) => String(endpoint.workers.max), tone: () => 'bold' },
  countColumn('RUN', ({ workers }) => workers.running),
  countColumn('IDLE', ({ workers }) => workers.idle),
  countColumn('INIT', ({ workers }) => workers.initializing),
  countColumn('THRTL', ({ workers }) => workers.throttled, 'yellow'),
  countColumn('UNHLTH', ({ workers }) => workers.unhealthy, 'red'),
  countColumn('QUEUE', ({ queued }) => queued, 'yellow'),
  {
    header: 'GPU STOCK',
    align: 'left',
    text: ({ availability }) => availability ?? '?',
    tone: ({ availability }) => (availability === null ? null : STOCK_TONES[availability]),
  },
  { header: 'POOLS', align: 'left', text: ({ endpoint }) => (endpoint.gpu?.pools ?? []).join(','), tone: () => 'dim' },
];

const columnWidth = (column: Column, endpoints: readonly EndpointStatus[]): number =>
  Math.max(column.header.length, ...endpoints.map((status) => column.text(status).length));

function renderTable({ endpoints }: Snapshot, options: RenderOptions): string {
  if (endpoints.length === 0) return 'No serverless endpoints found.';
  const sized = COLUMNS.map((column, index) => ({
    column,
    width: index === COLUMNS.length - 1 ? 0 : columnWidth(column, endpoints),
  }));
  const renderRow = (cell: (column: Column) => readonly [text: string, tone: Tone | null]): string =>
    sized
      .map(({ column, width }) => {
        const [text, tone] = cell(column);
        return paint(pad(text, width, column.align), tone, options);
      })
      .join('  ');
  return [
    renderRow((column) => [column.header, 'bold']),
    ...endpoints.map((status) => renderRow((column) => [column.text(status), column.tone?.(status) ?? null])),
  ].join('\n');
}

function capacityLine(snapshot: Snapshot, options: RenderOptions): string {
  const { totalMax, cap, free } = capacity(snapshot);
  const total = `Total max workers: ${paint(String(totalMax), 'bold', options)}`;
  if (isFailure(snapshot.account)) return `${total} (account cap unknown: ${snapshot.account.error})`;
  if (cap === null || free === null) return `${total} (RunPod did not report an account cap)`;
  const freeText =
    free >= 0
      ? paint(`${free} free`, free === 0 ? 'yellow' : 'green', options)
      : paint(`${-free} over`, 'red', options);
  return `${total} / ${cap} account cap, ${freeText}`;
}

function spendLine(snapshot: Snapshot): string | null {
  if (!snapshot.account.ok) return null;
  const { currentSpendPerHour: current, spendLimitPerHour: limit } = snapshot.account.value;
  if (current === null) return null;
  return `Spend: ${formatUsd(current)}/hr${limit === null ? '' : ` of ${formatUsd(limit)}/hr limit`}`;
}

const stockLine = ({ gpuStock }: Snapshot): string | null =>
  isFailure(gpuStock) ? `GPU stock unavailable: ${gpuStock.error}` : null;

const assertNever = (value: never): never => {
  throw new Error(`Unhandled problem: ${JSON.stringify(value)}`);
};

function describeProblem(problem: Problem): string {
  switch (problem.kind) {
    case 'fetch-failed':
      return `${problem.endpoint}: could not load worker and queue status (${problem.error})`;
    case 'no-max':
      return `${problem.endpoint}: ${problem.queued} jobs queued but max workers is 0`;
    case 'at-max':
      return `${problem.endpoint}: ${problem.queued} jobs queued and all ${problem.max} workers are busy, raise max workers to run more at once`;
    case 'throttled':
      return `${problem.endpoint}: ${problem.queued} jobs queued, ${problem.throttled} workers throttled waiting for GPUs (stock ${problem.availability ?? 'unknown'})`;
    case 'unhealthy':
      return `${problem.endpoint}: ${problem.unhealthy} workers failing health checks, check the worker logs in the RunPod console`;
    case 'over-cap':
      return `Total max workers (${problem.totalMax}) is above the account cap (${problem.cap}), so not every endpoint can reach its max at once`;
    case 'spend-near-limit':
      return `Spend ${formatUsd(problem.current)}/hr is close to the ${formatUsd(problem.limit)}/hr account limit, new workers may not start`;
    default:
      return assertNever(problem);
  }
}

function renderProblems(problems: readonly Problem[], options: RenderOptions): string {
  if (problems.length === 0) return paint('No problems found.', 'green', options);
  const lines = problems.map(
    (problem) => `${paint('!', PROBLEM_TONES[problem.kind], options)} ${describeProblem(problem)}`
  );
  return [paint('Problems', 'bold', options), ...lines].join('\n');
}

export function renderReport(snapshot: Snapshot, options: RenderOptions): string {
  const summary = [
    capacityLine(snapshot, options),
    spendLine(snapshot),
    stockLine(snapshot),
    paint(`Loaded at ${snapshot.fetchedAt.toLocaleTimeString()}`, 'dim', options),
  ].filter((line): line is string => line !== null);
  return [renderTable(snapshot, options), '', ...summary, '', renderProblems(diagnose(snapshot), options)].join('\n');
}

export function renderPlan(plan: MaxChangePlan, options: RenderOptions): string {
  const capText = plan.cap === null ? '' : ` / ${plan.cap} cap`;
  const lines = [
    `${paint(plan.endpoint.name, 'bold', options)}: max workers ${plan.from} → ${paint(String(plan.to), 'bold', options)}`,
    `Account total: ${plan.totalBefore} → ${plan.totalAfter}${capText}`,
  ];
  if (plan.overCapBy > 0) {
    lines.push(paint(`This puts the account ${plan.overCapBy} over its worker cap`, 'yellow', options));
  }
  return lines.join('\n');
}
