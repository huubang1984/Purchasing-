/** Một khóa đã được bọc. `keyVersion` cho biết master key nào bọc nó — nền tảng của việc xoay khóa. */
export interface WrappedKey {
  readonly ciphertext: Uint8Array;
  readonly keyVersion: string;
}

export class KeyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KeyError";
  }
}
