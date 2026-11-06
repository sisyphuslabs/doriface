/**
 * The decisions every enforcement point makes with the one policy {@link PlanPolicy}. A gate is a pure function of
 * the policy and of what is already in use: it never reads the environment, a file or a service, so each call site
 * stays one line and the open default is the same in a test as in a running host.
 */

import { FEATURE_LABELS, type PlanFeature, type PlanLimit, type PlanPolicy } from "./policy.ts";

/** Why a gate refused, in the shape a caller closes a session or fails a command with. */
export type PlanRefusal =
  | {
      readonly allowed: false;
      readonly reason: "feature_missing";
      readonly feature: PlanFeature;
      readonly message: string;
    }
  | {
      readonly allowed: false;
      readonly reason: "limit_reached";
      readonly limit: PlanLimit;
      readonly max: number;
      readonly message: string;
    };

export type PlanDecision = { readonly allowed: true } | PlanRefusal;

const PERMITTED: PlanDecision = { allowed: true };

/** How a refusal ends for the person reading it: what frees a place, and where more room is when this build knows. */
const RELIEF: Readonly<Record<PlanLimit, string>> = {
  machines: "Remove a machine from the mesh to make room.",
  devices: "Remove a device to make room.",
  sessions: "Close a session to make room.",
};

const allowed = (policy: PlanPolicy): string =>
  policy.upgradeUrl === undefined ? "" : ` More room: ${policy.upgradeUrl}`;

const count = (howMany: number, noun: string): string => `${howMany} ${noun}${howMany === 1 ? "" : "s"}`;

/** What is already in use, as the first half of a limit's refusal. */
const inUse = (limit: PlanLimit, current: number): string => {
  if (limit === "sessions") return current === 1 ? "1 session is open" : `${count(current, "session")} are open`;
  if (limit === "devices") return `This computer has ${count(current, "paired device")}`;
  return `This mesh has ${count(current, "machine")}`;
};

/**
 * The feature gate: a plan that withholds `feature` refuses, naming the plan and the feature. Every feature is carried
 * by {@link OPEN_POLICY}, and by any plan whose document does not name it.
 */
export function requireFeature(policy: PlanPolicy, feature: PlanFeature): PlanDecision {
  if (!policy.withoutFeatures.includes(feature)) return PERMITTED;
  return {
    allowed: false,
    reason: "feature_missing",
    feature,
    message: `The ${policy.plan} plan does not include ${FEATURE_LABELS[feature]}.${allowed(policy)}`,
  };
}

/**
 * The count gate: `current` is what is already in use, and one more is admitted only while it is below the plan's
 * limit for `limit`. Unlimited unless the policy names that limit, so a build with no policy admits any count.
 */
export function requireWithin(policy: PlanPolicy, limit: PlanLimit, current: number): PlanDecision {
  const max = policy.limits[limit];
  if (current < max) return PERMITTED;
  return {
    allowed: false,
    reason: "limit_reached",
    limit,
    max,
    message: `${inUse(limit, current)}, and the ${policy.plan} plan allows ${max}. ${RELIEF[limit]}${allowed(policy)}`,
  };
}
