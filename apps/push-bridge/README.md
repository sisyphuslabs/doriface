# @doriface/push-bridge

Forwards the host's Web Push notices to the iOS and Android apps (#705). The host posts to the bridge exactly what it posts to a browser's push service: one RFC 8291 `aes128gcm` record signed with its VAPID key. The bridge checks the request and hands the ciphertext, unchanged, to APNs or FCM. Only the app holds the key that opens it.

| Endpoint                               | Forwarded to                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /v1/apns/<device token>`         | APNs production, an alert with `mutable-content` for the Notification Service Extension |
| `POST /v1/apns-sandbox/<device token>` | APNs development (debug builds)                                                         |
| `POST /v1/fcm/<registration token>`    | FCM HTTP v1, a data-only message                                                        |

Answers: 201 sent, 410 the token is unregistered (the host drops the subscription), 429 throttled, 401 no valid VAPID token for this origin, 400 or 413 not one small `aes128gcm` record, 503 the provider is not configured, 502 anything else upstream.

`createBridge` in `src/bridge.ts` is a plain `fetch` handler, so it runs on Workers, Bun or Node. `src/worker.ts` is the Workers entry; `wrangler.toml` deploys it at `push-doriface.omo.dev`.

Credentials (owner step, not in the repo): an APNs auth key (`APNS_PRIVATE_KEY`, the `.p8` file, with `APNS_KEY_ID` and `APNS_TEAM_ID`), the app's bundle id (`APNS_TOPIC`), and a Firebase service account JSON (`FCM_SERVICE_ACCOUNT`). A provider with no credentials answers 503 and the other keeps working.
