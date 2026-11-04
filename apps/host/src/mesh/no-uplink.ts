/** This host keeps no relay uplink, so it dials no member: that says nothing about the member, and gates nothing. */
export class NoUplinkError extends Error {
  override readonly name = "NoUplinkError";

  constructor() {
    super("this host keeps no relay uplink, so it dials no member");
  }
}
