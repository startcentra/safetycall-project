/** In-memory per-process guard for LOCAL development. NOT a durable production rate limiter. */
export class BudgetExceededError extends Error {
  constructor(message: string) { super(message); this.name = "BudgetExceededError"; }
}
export class LiveRequestGate {
  private issued = 0;
  private readonly active = new Set<string>();
  private readonly seen = new Set<string>();
  readonly maxCalls: number;
  constructor(maxCalls: number) {
    this.maxCalls = maxCalls;
    if (!Number.isInteger(maxCalls) || maxCalls < 0) throw new Error("Invalid maxCalls");
  }
  reserve(fingerprint: string) {
    if (this.active.has(fingerprint) || this.seen.has(fingerprint)) throw new BudgetExceededError("동일 발화의 중복 유료 요청을 차단했습니다.");
    if (this.issued >= this.maxCalls) throw new BudgetExceededError("서버 프로세스의 유료 API 요청 상한에 도달했습니다.");
    this.issued++;
    this.active.add(fingerprint);
    this.seen.add(fingerprint);
  }
  finish(fingerprint: string) { this.active.delete(fingerprint); }
  get stats() { return { used: this.issued, max: this.maxCalls }; }
}
