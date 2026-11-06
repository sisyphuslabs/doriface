import { type BridgeConfig, createBridge } from "./bridge.ts";

/** Worker secrets and vars; a provider whose values are missing answers 503 rather than failing the other one. */
export interface BridgeEnv {
  readonly APNS_TEAM_ID?: string;
  readonly APNS_KEY_ID?: string;
  readonly APNS_PRIVATE_KEY?: string;
  readonly APNS_TOPIC?: string;
  /** The Firebase service account JSON as Google issues it (`project_id`, `client_email`, `private_key`). */
  readonly FCM_SERVICE_ACCOUNT?: string;
}

export function configOf(env: BridgeEnv): BridgeConfig {
  const { APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY, APNS_TOPIC, FCM_SERVICE_ACCOUNT } = env;
  const apns =
    APNS_TEAM_ID && APNS_KEY_ID && APNS_PRIVATE_KEY && APNS_TOPIC
      ? { teamId: APNS_TEAM_ID, keyId: APNS_KEY_ID, privateKey: APNS_PRIVATE_KEY, topic: APNS_TOPIC }
      : undefined;
  let fcm: BridgeConfig["fcm"];
  if (FCM_SERVICE_ACCOUNT) {
    const account: unknown = JSON.parse(FCM_SERVICE_ACCOUNT);
    const field = (name: string): unknown =>
      typeof account === "object" && account !== null ? Reflect.get(account, name) : undefined;
    const projectId = field("project_id");
    const clientEmail = field("client_email");
    const privateKey = field("private_key");
    if (typeof projectId === "string" && typeof clientEmail === "string" && typeof privateKey === "string") {
      fcm = { projectId, clientEmail, privateKey };
    }
  }
  return { apns, fcm };
}

let handler: ((request: Request) => Promise<Response>) | undefined;

export default {
  fetch(request: Request, env: BridgeEnv): Promise<Response> {
    handler ??= createBridge(configOf(env), { log: (line) => console.error(line) });
    return handler(request);
  },
};
