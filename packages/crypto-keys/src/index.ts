// Entrypoint BỌC khóa — an toàn cho mọi service import.
export interface WrappedKey {
  readonly ciphertext: Uint8Array;
  readonly keyVersion: string;
}
