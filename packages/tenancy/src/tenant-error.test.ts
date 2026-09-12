// ==============================================================================================
// [S1.66 / lượt soi ngang 59b-1] LOẠI CỦA TenantError SUY TỪ MÃ — `input` thành 401 câm, `protocol` thành 500 có log
//
// `apps/api/src/loi-giao-thuc.int.test.ts` đo hai đầu của hợp đồng qua HTTP: lỗi giao thức ra 500 có log, lỗi đầu vào ra 401 câm.
// Nhưng đối chứng đầu vào ở đó (cookie hỏng, token khách lạ) không bắt buộc phải đi qua một TenantError, nên bảng phân loại mã cần
// một phép đo ở mức lớp. Bảng dưới gõ kiểu `Record<TenantErrorCode, …>`: một mã mới thêm vào union mà không có dòng ở đây thì tsc
// (T0) đỏ trước khi test chạy.
// ==============================================================================================
import { describe, expect, it } from "vitest";
import { TenantError, type TenantErrorCode } from "./with-tenant.js";

const LOAI_THEO_MA: Readonly<Record<TenantErrorCode, "input" | "protocol">> = {
  INVALID_ORG_ID: "input",
  INVALID_GUEST_SESSION_ID: "input",
  GUEST_SESSION_NOT_FOUND: "input",
  MULTI_STATEMENT_UNSUPPORTED: "protocol",
  SESSION_DEFAULT_PRESET: "protocol",
  REPLICA_AT_COMMIT: "protocol",
  TRANSACTION_ABORTED: "protocol",
  COMMIT_NOT_APPLIED: "protocol",
  SESSION_SCOPE_LEAK: "protocol",
  SESSION_STATE_LEFT: "protocol",
  GUEST_SETTINGS_INEFFECTIVE: "protocol",
};

describe("[S1.66 / lượt soi ngang 59b-1] loại của TenantError suy từ mã", () => {
  it("đúng ba mã đầu vào là input, mọi mã khác là protocol", () => {
    const thucTe = Object.fromEntries(
      (Object.keys(LOAI_THEO_MA) as TenantErrorCode[]).map((ma) => [ma, new TenantError(ma, "x").kind]),
    );
    expect(thucTe).toEqual(LOAI_THEO_MA);
  });
});
