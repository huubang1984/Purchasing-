// ==============================================================================================
// [S1.85 / khoản 131] `moTaHangDongCuaLanTuChoi` — TÊN THÌ ĐƯỢC, GIÁ TRỊ THÌ KHÔNG.
//
// Hàm này là NGUỒN DUY NHẤT của phần hằng trong dòng log của hai lớp bọc lần ghi sổ từ chối, và
// cả `apps/api` lẫn `apps/unseal-worker` đều đọc nó. Nó đứng giữa một lần từ chối đã MẤT khỏi sổ
// và người vận hành đọc log sau sự cố, nên nó phải mang đủ để trả lời "lần từ chối NÀO" mà không
// mang một giá trị nào (A2).
//
// Hai vế được đo riêng, vì chúng hỏng theo hai hướng ngược nhau:
//   ⑴ KHÔNG RỖNG RUỘT — mọi mã trong `PERMISSIONS` phải đi qua được. Một hình dạng quá hẹp biến
//      mọi dòng log thật thành `HANG_LA` mà không cổng nào kêu; bản đầu của vòng này có đúng lỗi
//      ấy (`user.mfa_reset` có dấu gạch dưới, hình dạng đầu tiên không cho).
//   ⑵ KHÔNG RÒ — thứ mang hình dạng một GIÁ TRỊ phải ra `HANG_LA`, kể cả khi nó được đặt đúng vào
//      trường mà hàm này đọc.
// ==============================================================================================
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "./permissions.js";
import {
  DenialAuditFailedError,
  PermissionAuditFailedError,
  PermissionDeniedError,
  moTaHangDongCuaLanTuChoi,
} from "./rbac.js";

const GOC = new Error("thong diep goc");
const GIA_TRI = [
  "4111-1111-1111-1111",
  "ke-toan@vidu.vn",
  "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "1250000",
  "Nha cung cap X",
  "supplier.manage; DROP TABLE audit_events",
  "",
  "SUPPLIER SUPPLIER",
];

function boc(resourceType: string, permission: string): PermissionAuditFailedError {
  return new PermissionAuditFailedError(new PermissionDeniedError("u1", permission), resourceType, GOC);
}

describe("[S1.85 / khoản 131] moTaHangDongCuaLanTuChoi", () => {
  it("ĐỐI CHỨNG KHÔNG RỖNG RUỘT: MỌI mã trong PERMISSIONS đi qua nguyên vẹn — không mã nào thành HANG_LA", () => {
    const ma = Object.values(PERMISSIONS);
    expect(ma.length).toBeGreaterThanOrEqual(15);
    const hong = ma.filter((p) => moTaHangDongCuaLanTuChoi(boc("SUPPLIER", p)) !== `PERMISSION_DENIED SUPPLIER ${p}`);
    expect(hong, "một hình dạng quá hẹp biến dòng log thật thành HANG_LA mà không cổng nào kêu").toEqual([]);
  });

  it("`DenialAuditFailedError` ⇒ `action` và `resourceType`; `PermissionAuditFailedError` ⇒ thêm mã quyền", () => {
    expect(moTaHangDongCuaLanTuChoi(new DenialAuditFailedError("UNSEAL_APPROVAL_DENIED", "UNSEAL_REQUEST", GOC, GOC))).toBe(
      "UNSEAL_APPROVAL_DENIED UNSEAL_REQUEST",
    );
    expect(moTaHangDongCuaLanTuChoi(boc("SUPPLIER", PERMISSIONS.SUPPLIER_MANAGE))).toBe("PERMISSION_DENIED SUPPLIER supplier.manage");
  });

  it("[INV-A2] giá trị đặt ĐÚNG vào trường hàm này đọc vẫn không ra được dòng log — ra HANG_LA", () => {
    for (const v of GIA_TRI) {
      expect(moTaHangDongCuaLanTuChoi(boc(v, PERMISSIONS.SUPPLIER_MANAGE)), `resourceType=${v}`).toBe(
        "PERMISSION_DENIED HANG_LA supplier.manage",
      );
      expect(moTaHangDongCuaLanTuChoi(boc("SUPPLIER", v)), `permission=${v}`).toBe("PERMISSION_DENIED SUPPLIER HANG_LA");
      expect(moTaHangDongCuaLanTuChoi(new DenialAuditFailedError(v, "UNSEAL_REQUEST", GOC, GOC)), `action=${v}`).toBe(
        "HANG_LA UNSEAL_REQUEST",
      );
    }
  });

  it("đọc theo LỚP chứ không theo tên trường: một lỗi chỉ MANG TÊN của hai lớp ấy không mua được chỗ trong dòng log", () => {
    const giaMao = Object.assign(new Error("x"), {
      name: "PermissionAuditFailedError",
      resourceType: "SUPPLIER",
      action: "PERMISSION_DENIED",
      denial: { permission: "supplier.manage" },
    });
    expect(moTaHangDongCuaLanTuChoi(giaMao)).toBe("");
    for (const v of [new Error("x"), "chuoi", 42, null, undefined, { action: "X" }]) {
      expect(moTaHangDongCuaLanTuChoi(v), JSON.stringify(v)).toBe("");
    }
  });
});
