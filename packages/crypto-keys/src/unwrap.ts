// Entrypoint MỞ khóa. CHỈ apps/unseal-worker được import file này.
// Quy tắc "khong-giai-ma-ngoai-unseal-worker" trong .dependency-cruiser.cjs cưỡng chế
// điều này ở tầng T0 — vi phạm làm CI đỏ ngay tại commit (ADR-006, bất biến G1).
export { createLocalDevUnwrapper, type KeyUnwrapper } from "./local-dev-unwrapper.js";
