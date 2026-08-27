// Entrypoint MỞ khóa. CHỈ apps/unseal-worker được import file này.
// Ranh giới bảo mật quan trọng nhất của hệ thống — ADR-006, bất biến G1.
import type { WrappedKey } from "./index.js";

export interface KeyUnwrapper {
  readonly name: string;
  unwrap(orgId: string, wrapped: WrappedKey): Promise<Uint8Array>;
}
