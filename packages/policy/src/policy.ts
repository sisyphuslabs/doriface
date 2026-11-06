/**
 * The one typed source a plan gate reads (Q: doriface works without a paid plan, and a plan can be enforced later
 * without a rewrite). Every limit is unlimited and every feature is carried unless one policy document names the
 * opposite, so a build with no policy — today's default — admits everything:
 *
 * - a count added later is unlimited until the document narrows it, and a feature added later stays carried until a
 *   policy withholds it, so a new call site cannot start refusing people by being written;
 * - a gate is therefore always an explicit narrowing of this document, never an accidental default, and every call
 *   site reads the same limits rather than carrying a number of its own.
 *
 * Nothing here knows about an account, a bill or a service: a policy is data this build was handed, and the one
 * document can later be filled from an account's plan without touching an enforcement point.
 */

/** The counts a plan can narrow. Every other cap in this repository is a safety cap, which a plan can never widen. */
export const PLAN_LIMITS = ["machines", "devices", "sessions"] as const;
export type PlanLimit = (typeof PLAN_LIMITS)[number];

/** The features a plan can withhold. A feature a build does not list here is not a gate at all: it is simply open. */
export const PLAN_FEATURES = ["pairing"] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** What each limit counts, in the words a person reads in a refusal. */
export const LIMIT_LABELS: Readonly<Record<PlanLimit, string>> = {
  machines: "machines in a mesh",
  devices: "paired devices",
  sessions: "open sessions",
};

/** What each feature does, in the words a person reads in a refusal. */
export const FEATURE_LABELS: Readonly<Record<PlanFeature, string>> = {
  pairing: "pairing a device",
};

export interface PlanLimits {
  /** Machines in one mesh. */
  readonly machines: number;
  /** Devices paired to one host. */
  readonly devices: number;
  /** Sessions a host serves at once. */
  readonly sessions: number;
}

export interface PlanPolicy {
  /** What a refusal calls this plan, e.g. `free`. */
  readonly plan: string;
  readonly limits: PlanLimits;
  /** The features this plan does not carry; empty carries every one of them. */
  readonly withoutFeatures: readonly PlanFeature[];
  /** Where a refusal points a person, when this build has somewhere to point at. Absent today. */
  readonly upgradeUrl?: string;
}

/** The plan of a build it was handed no policy for: every limit unlimited, every feature carried. */
export const OPEN_POLICY: PlanPolicy = {
  plan: "open",
  limits: {
    machines: Number.POSITIVE_INFINITY,
    devices: Number.POSITIVE_INFINITY,
    sessions: Number.POSITIVE_INFINITY,
  },
  withoutFeatures: [],
};

/** Where a build reads its one policy document. Unset, today's default, is {@link OPEN_POLICY}. */
export const POLICY_ENV = "DORIFACE_POLICY";

/**
 * A policy document that cannot be read as one. Loud on purpose: a misspelled limit or feature that parsed as
 * "nothing named" would read as an open plan, which is the one failure a gate must never have.
 */
export class PolicyError extends Error {
  override readonly name = "PolicyError";
}

const UNNAMED_PLAN = "custom";

const KNOWN_KEYS = ["plan", "limits", "withoutFeatures", "upgradeUrl"] as const;

const LIMIT_NAMES: ReadonlySet<string> = new Set(PLAN_LIMITS);
const FEATURE_NAMES: ReadonlySet<string> = new Set(PLAN_FEATURES);
const KNOWN_KEY_NAMES: ReadonlySet<string> = new Set(KNOWN_KEYS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPlanLimit = (name: string): name is PlanLimit => LIMIT_NAMES.has(name);

const isPlanFeature = (name: string): name is PlanFeature => FEATURE_NAMES.has(name);

const shown = (value: unknown): string => (value === undefined ? "nothing" : JSON.stringify(value));

function parseName(value: unknown): string {
  if (value === undefined) return UNNAMED_PLAN;
  if (typeof value !== "string" || value.trim() === "") {
    throw new PolicyError(`${POLICY_ENV}: plan must be a name such as "free", got ${shown(value)}`);
  }
  return value;
}

function parseLimits(value: unknown): PlanLimits {
  let machines = Number.POSITIVE_INFINITY;
  let devices = Number.POSITIVE_INFINITY;
  let sessions = Number.POSITIVE_INFINITY;
  if (value === undefined) return { machines, devices, sessions };
  if (!isRecord(value)) throw new PolicyError(`${POLICY_ENV}: limits must be an object, got ${shown(value)}`);
  for (const [name, at] of Object.entries(value)) {
    if (!isPlanLimit(name)) {
      throw new PolicyError(
        `${POLICY_ENV}: limits has ${JSON.stringify(name)}, which is not a limit; known: ${PLAN_LIMITS.join(", ")}`,
      );
    }
    if (typeof at !== "number" || !Number.isSafeInteger(at) || at < 1) {
      throw new PolicyError(`${POLICY_ENV}: limits.${name} must be a whole count of at least 1, got ${shown(at)}`);
    }
    if (name === "machines") machines = at;
    else if (name === "devices") devices = at;
    else sessions = at;
  }
  return { machines, devices, sessions };
}

function parseFeatures(value: unknown): readonly PlanFeature[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new PolicyError(`${POLICY_ENV}: withoutFeatures must be a list, got ${shown(value)}`);
  }
  return value.map((entry: unknown) => {
    if (typeof entry !== "string" || !isPlanFeature(entry)) {
      throw new PolicyError(
        `${POLICY_ENV}: withoutFeatures has ${shown(entry)}, which is not a feature; known: ${PLAN_FEATURES.join(", ")}`,
      );
    }
    return entry;
  });
}

function parseUpgrade(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) {
    throw new PolicyError(`${POLICY_ENV}: upgradeUrl must be an http(s) address, got ${shown(value)}`);
  }
  return value;
}

/**
 * Reads this build's one policy document. A document that is absent or empty is {@link OPEN_POLICY}; a document that
 * names a limit or a feature narrows exactly that and nothing else.
 *
 * Unknown names are an error rather than ignored: the mapping from a service's answer to this document (which owns
 * compatibility with newer services) narrows to {@link PLAN_LIMITS} and {@link PLAN_FEATURES} before it gets here.
 */
export function parsePolicy(raw: string | undefined): PlanPolicy {
  if (raw === undefined || raw.trim() === "") return OPEN_POLICY;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new PolicyError(`${POLICY_ENV} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) throw new PolicyError(`${POLICY_ENV} must be a JSON object, got ${shown(value)}`);
  for (const key of Object.keys(value)) {
    if (!KNOWN_KEY_NAMES.has(key)) {
      throw new PolicyError(
        `${POLICY_ENV} has ${JSON.stringify(key)}, which is not a setting; known: ${KNOWN_KEYS.join(", ")}`,
      );
    }
  }
  const upgradeUrl = parseUpgrade(value["upgradeUrl"]);
  return {
    plan: parseName(value["plan"]),
    limits: parseLimits(value["limits"]),
    withoutFeatures: parseFeatures(value["withoutFeatures"]),
    ...(upgradeUrl === undefined ? {} : { upgradeUrl }),
  };
}

/** The policy a build reads off its environment; the key's absence is {@link OPEN_POLICY}. */
export function policyFromEnv(env: Readonly<Record<string, string | undefined>>, key: string = POLICY_ENV): PlanPolicy {
  return parsePolicy(env[key]);
}
