// Entrypoint BỌC khóa — an toàn cho mọi service import.
// Đường MỞ khóa nằm ở "./unwrap.js" và chỉ apps/unseal-worker được chạm (ADR-006, INV-G1).
export { KeyError, type WrappedKey } from "./types.js";
export { MasterKeyRing } from "./master-keys.js";
export { createLocalDevWrapper, type KeyWrapper } from "./local-dev-wrapper.js";
