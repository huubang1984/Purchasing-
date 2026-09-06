// Entrypoint BỌC khóa — an toàn cho mọi service import.
// Đường MỞ khóa nằm ở "./unwrap.js" và chỉ apps/unseal-worker được chạm (ADR-006, INV-G1).
export { KeyError, type WrappedKey } from "./types.js";
// [S1.5] Một PHÉP KIỂM, không một khả năng nào — xem khối đầu `moi-truong.ts` để biết vì sao nó
// được mở ra cửa công khai trong khi `local-dev-shared.ts` thì không.
export { assertLocalDevAllowed } from "./moi-truong.js";
export { MasterKeyRing } from "./master-keys.js";
export { createLocalDevWrapper, type KeyWrapper } from "./local-dev-wrapper.js";
