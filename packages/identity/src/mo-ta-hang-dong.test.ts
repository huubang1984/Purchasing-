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
//      [S1.9161 / khoản 189] Và mọi mã trong BA danh mục đóng của `rbac.ts` — hành động từ chối,
//      loại tài nguyên, vế cổng — cũng phải đi qua được: một danh mục thiếu một mã biến dòng log
//      của đúng lần từ chối ấy thành `HANG_LA`. Vế "danh mục phủ MỌI chỗ gọi" đo ở
//      `danh-muc-tu-choi.test.ts`.
//   ⑵ KHÔNG RÒ — ~~thứ mang hình dạng một GIÁ TRỊ phải ra `HANG_LA`~~ [S1.9161 / khoản 189] thứ
//      KHÔNG THUỘC danh mục đóng phải ra `HANG_LA`, kể cả khi nó được đặt đúng vào trường mà hàm
//      này đọc, và kể cả khi nó mang ĐÚNG hình dạng mã định danh viết hoa (bí mật TOTP base32,
//      UUID viết hoa bỏ gạch nối, hex viết hoa) hay đúng khuôn chấm chữ thường của một mã quyền
//      (`supplier.delete` — không có trong `PERMISSIONS`). Đo trên mã trước vòng này (phép canh
//      theo HÌNH DẠNG): ba chuỗi viết hoa ĐI LỌT vào dòng log ở cả ba trường viết hoa, và
//      `supplier.delete` đi lọt ở trường mã quyền.
//
// [S1.9161 / khoản 179] `DenialAuditFailedError` nay mang thêm hằng thứ ba — VẾ cổng đã từ chối
// (`clause` của cổng mở thầu và của worker lúc giải mã, trạng thái RFQ của A4) — và nó đi qua cùng
// phép thuộc-tập; không mang vế thì dòng vẫn là hai hằng như trước.
//
// [S1.9161 / khoản 185] Mỗi giá trị của `GIA_TRI` là MỘT `it` (`it.each`): trước vòng này tám giá
// trị chạy trong một vòng `for` của một `it`, nên giá trị đầu đỏ thì bảy giá trị sau không bao giờ
// được chạy.
// ==============================================================================================
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "./permissions.js";
import {
  DANH_MUC_HANH_DONG_TU_CHOI,
  DANH_MUC_LOAI_TAI_NGUYEN,
  DANH_MUC_VE_CONG,
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
  // [S1.9161 / khoản 189] Ba chuỗi mang ĐÚNG hình dạng `^[A-Z][A-Z0-9_]{0,63}$` — lớp bí mật mà
  // kho này tự sinh ra (`base32()` ở `apps/api/src/routes/auth.ts` phát bí mật TOTP theo RFC 4648,
  // bắt đầu bằng chữ cái 26/32 số lần), một UUID viết hoa bỏ gạch nối (bắt đầu bằng chữ cái — 6/16
  // số lần; bắt đầu bằng chữ số thì hình dạng cũ đã chặn), một chuỗi hex viết hoa — và một chuỗi
  // đúng khuôn mã quyền nhưng không có trong `PERMISSIONS`.
  "JBSWY3DPEHPK3PXP",
  "C9BF9E5716854C89BAFBFF5AF830BE8A",
  "DEADBEEFCAFEBABE",
  "supplier.delete",
  // Một MÃ có thật trong sổ nhưng ở SAI trường: hành động ghi thành công không phải hành động từ
  // chối, và không phải loại tài nguyên hay vế cổng.
  "RFQ_CREATED",
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

  it("[S1.9161 / khoản 189] ĐỐI CHỨNG KHÔNG RỖNG RUỘT: MỌI mã trong ba danh mục đóng đi qua nguyên vẹn ở đúng trường của nó", () => {
    expect(DANH_MUC_HANH_DONG_TU_CHOI.size).toBeGreaterThanOrEqual(2);
    expect(DANH_MUC_LOAI_TAI_NGUYEN.size).toBeGreaterThanOrEqual(2);
    expect(DANH_MUC_VE_CONG.size).toBeGreaterThanOrEqual(2);
    const hong: string[] = [];
    for (const a of DANH_MUC_HANH_DONG_TU_CHOI) {
      if (moTaHangDongCuaLanTuChoi(new DenialAuditFailedError(a, "RFQ", GOC, GOC)) !== `${a} RFQ`) hong.push(`action=${a}`);
    }
    for (const r of DANH_MUC_LOAI_TAI_NGUYEN) {
      if (moTaHangDongCuaLanTuChoi(boc(r, PERMISSIONS.SUPPLIER_MANAGE)) !== `PERMISSION_DENIED ${r} supplier.manage`) hong.push(`resourceType=${r}`);
      if (moTaHangDongCuaLanTuChoi(new DenialAuditFailedError("UNSEAL_DENIED", r, GOC, GOC)) !== `UNSEAL_DENIED ${r}`) hong.push(`resourceType(denial)=${r}`);
    }
    for (const v of DANH_MUC_VE_CONG) {
      if (moTaHangDongCuaLanTuChoi(new DenialAuditFailedError("UNSEAL_DENIED", "RFQ", GOC, GOC, v)) !== `UNSEAL_DENIED RFQ ${v}`) hong.push(`clause=${v}`);
    }
    expect(hong, "một danh mục thiếu một mã biến dòng log của đúng lần từ chối ấy thành HANG_LA").toEqual([]);
  });

  it("`DenialAuditFailedError` ⇒ `action` và `resourceType`; `PermissionAuditFailedError` ⇒ thêm mã quyền", () => {
    expect(moTaHangDongCuaLanTuChoi(new DenialAuditFailedError("UNSEAL_APPROVAL_DENIED", "UNSEAL_REQUEST", GOC, GOC))).toBe(
      "UNSEAL_APPROVAL_DENIED UNSEAL_REQUEST",
    );
    expect(moTaHangDongCuaLanTuChoi(boc("SUPPLIER", PERMISSIONS.SUPPLIER_MANAGE))).toBe("PERMISSION_DENIED SUPPLIER supplier.manage");
  });

  it("[S1.9161 / khoản 179] `DenialAuditFailedError` mang VẾ cổng ⇒ dòng in thêm hằng thứ ba; không mang vế ⇒ hai hằng như trước", () => {
    // Bốn vế của cổng mở thầu (`UNSEAL_CLAUSES`), hai vế của worker lúc giải mã, trạng thái RFQ của A4 — mỗi nguồn một ca.
    expect(moTaHangDongCuaLanTuChoi(new DenialAuditFailedError("UNSEAL_DENIED", "UNSEAL_REQUEST", GOC, GOC, "POLICY_GATE"))).toBe(
      "UNSEAL_DENIED UNSEAL_REQUEST POLICY_GATE",
    );
    expect(moTaHangDongCuaLanTuChoi(new DenialAuditFailedError("UNSEAL_DENIED", "UNSEAL_REQUEST", GOC, GOC, "RFQ_CLOSED"))).toBe(
      "UNSEAL_DENIED UNSEAL_REQUEST RFQ_CLOSED",
    );
    expect(moTaHangDongCuaLanTuChoi(new DenialAuditFailedError("UNSEAL_EXECUTION_DENIED", "UNSEAL_REQUEST", GOC, GOC, "MFA_FRESH"))).toBe(
      "UNSEAL_EXECUTION_DENIED UNSEAL_REQUEST MFA_FRESH",
    );
    expect(moTaHangDongCuaLanTuChoi(new DenialAuditFailedError("COMPARISON_DENIED", "RFQ", GOC, GOC, "OPEN"))).toBe(
      "COMPARISON_DENIED RFQ OPEN",
    );
    expect(moTaHangDongCuaLanTuChoi(new DenialAuditFailedError("MFA_RESET_APPROVAL_DENIED", "MFA_RESET_REQUEST", GOC, GOC))).toBe(
      "MFA_RESET_APPROVAL_DENIED MFA_RESET_REQUEST",
    );
  });

  it.each(GIA_TRI)(
    "[INV-A2] giá trị %j đặt ĐÚNG vào trường hàm này đọc vẫn không ra được dòng log — ra HANG_LA ở cả bốn trường",
    (v) => {
      expect(moTaHangDongCuaLanTuChoi(boc(v, PERMISSIONS.SUPPLIER_MANAGE)), "resourceType").toBe(
        "PERMISSION_DENIED HANG_LA supplier.manage",
      );
      expect(moTaHangDongCuaLanTuChoi(boc("SUPPLIER", v)), "permission").toBe("PERMISSION_DENIED SUPPLIER HANG_LA");
      expect(moTaHangDongCuaLanTuChoi(new DenialAuditFailedError(v, "UNSEAL_REQUEST", GOC, GOC)), "action").toBe(
        "HANG_LA UNSEAL_REQUEST",
      );
      expect(moTaHangDongCuaLanTuChoi(new DenialAuditFailedError("UNSEAL_DENIED", "UNSEAL_REQUEST", GOC, GOC, v)), "clause").toBe(
        "UNSEAL_DENIED UNSEAL_REQUEST HANG_LA",
      );
    },
  );

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
