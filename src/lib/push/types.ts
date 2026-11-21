export interface PushMessage {
  title: string;
  body: string;
  /** Same-site path opened on tap (NativeBridge runs it through safeReturnPath). */
  url: string;
  badge?: number;
}

export interface PushResult {
  token: string;
  ok: boolean;
  /** The device token is permanently invalid — disable it. */
  dead: boolean;
  error?: string;
}
