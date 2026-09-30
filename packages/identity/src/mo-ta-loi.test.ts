// ==============================================================================================
// [S1.222 / khoản 166] BỘ MÔ TẢ LỖI DÙNG CHUNG — LUẬT A2 ĐO Ở CHÍNH GÓI GIỮ NÓ.
//
// `apps/api/src/mo-ta-loi.test.ts` đo trọn luật (S1.67 / khoản 118, S1.68 / khoản 119) qua cửa xuất lại của `api`, và vẫn đứng. Tệp
// này đo hai ca mà khoản 166 gọi tên, trên LỚP LỖI THẬT chứ không trên một `Error` gán tên: `DenialAuditFailedError` mang `cause` là
// lỗi Postgres `55P03` — đúng thứ worker ném khi khoá ghi sổ bị giữ quá trần 2 s của `050` — và `TenantError`. Bản rút gọn của worker
// tới trước vòng này cho ca đầu `DenialAuditFailedError UNSEAL_EXECUTION_DENIED UNSEAL_REQUEST`, không `<- error 55P03`.
// ==============================================================================================
import { describe, expect, it } from "vitest";
import { TenantError } from "@trustprocure/tenancy";
import { moTaLoiKhongGiaTri } from "./mo-ta-loi.js";
import { PERMISSIONS } from "./permissions.js";
import { DenialAuditFailedError, PermissionAuditFailedError, PermissionDeniedError } from "./rbac.js";

const GIA_TRI = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/** Lỗi Postgres như `pg` ném: `name` là `error`, `code` là SQLSTATE, `message` mang câu của máy chủ. */
function loiPg(code: string): Error {
  return Object.assign(new Error(`canceling statement due to lock timeout ${GIA_TRI}`), { name: "error", code });
}

describe("[INV-A2] [S1.222 / khoản 166] moTaLoiKhongGiaTri — một bản cho hai tiến trình", () => {
  it("`DenialAuditFailedError` mang cause 55P03 ⇒ tên lớp, hai hằng đóng, rồi đúng MỘT tầng cause: tên và SQLSTATE — không message, không giá trị", () => {
    const loi = new DenialAuditFailedError("UNSEAL_EXECUTION_DENIED", "UNSEAL_REQUEST", new Error(`tu choi ${GIA_TRI}`), loiPg("55P03"));
    const dong = moTaLoiKhongGiaTri(loi);
    expect(dong).toBe("DenialAuditFailedError UNSEAL_EXECUTION_DENIED UNSEAL_REQUEST <- error 55P03");
    expect(dong).not.toContain(GIA_TRI);
    expect(dong).not.toContain("lock timeout");
  });

  it("`PermissionAuditFailedError` mang cause 55P03 ⇒ thêm mã quyền, cùng luật", () => {
    const loi = new PermissionAuditFailedError(new PermissionDeniedError("u1", PERMISSIONS.SUPPLIER_MANAGE), "SUPPLIER", loiPg("55P03"));
    expect(moTaLoiKhongGiaTri(loi)).toBe("PermissionAuditFailedError PERMISSION_DENIED SUPPLIER supplier.manage <- error 55P03");
  });

  it("`TenantError` ⇒ tên và mã, nhận theo LỚP; message không vào dòng; có `cause` cũng không nêu — nó có `code`", () => {
    expect(moTaLoiKhongGiaTri(new TenantError("SESSION_STATE_LEFT", `thong diep mang ${GIA_TRI}`))).toBe("TenantError SESSION_STATE_LEFT");
    expect(moTaLoiKhongGiaTri(Object.assign(new TenantError("CONNECT_WAIT_EXCEEDED", "x"), { cause: loiPg("55P03") }))).toBe(
      "TenantError CONNECT_WAIT_EXCEEDED",
    );
  });

  it("thứ không phải Error ⇒ `loi khong ro`; mã không mang hình dạng SQLSTATE ⇒ chỉ tên", () => {
    expect(moTaLoiKhongGiaTri(GIA_TRI)).toBe("loi khong ro");
    expect(moTaLoiKhongGiaTri(loiPg("ECONNREFUSED"))).toBe("error");
  });
});
