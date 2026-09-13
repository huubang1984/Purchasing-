// ==============================================================================================
// [S1.67 / khoản 118] MÔ TẢ LỖI CHO DÒNG LOG: TÊN, CỘNG MÃ CỐ ĐỊNH — KHÔNG MESSAGE, ~~KHÔNG CAUSE~~ [S1.68 / lượt soi 62b-4] KHÔNG CAUSE NGUYÊN
//
// Các chỗ ghi log được đo qua HTTP và qua tiến trình dựng như sản xuất (`loi-giao-thuc.int.test.ts`, `composition.int.test.ts`). Mọi lỗi
// ở đó mang một SQLSTATE thật hay một mã `TenantError`, nên chúng không phủ nửa còn lại của hợp đồng: một `code` không mang hình dạng
// SQLSTATE — mã hệ thống dài hơn năm ký tự, chữ thường, một chuỗi có giá trị — thì KHÔNG được ghi. Tệp này đo nửa ấy ở mức hàm.
// ==============================================================================================
import { describe, expect, it } from "vitest";
import { TenantError } from "@trustprocure/tenancy";
import { moTaLoiKhongGiaTri } from "./mo-ta-loi.js";

const GIA_TRI = "4111-1111-1111-1111";

function loiMang(name: string, code: unknown): Error {
  return Object.assign(new Error(`thong diep mang ${GIA_TRI}`), { name, code, cause: new Error(`cau lenh mang ${GIA_TRI}`) });
}

describe("[S1.67 / khoản 118] moTaLoiKhongGiaTri", () => {
  it("lỗi Postgres ⇒ tên và SQLSTATE (cả mã riêng của dự án); TenantError ⇒ tên và mã; message và cause không vào dòng", () => {
    const ra = [
      moTaLoiKhongGiaTri(loiMang("error", "42501")),
      moTaLoiKhongGiaTri(loiMang("error", "TP096")),
      moTaLoiKhongGiaTri(new TenantError("SESSION_STATE_LEFT", `thong diep mang ${GIA_TRI}`)),
    ];
    expect(ra).toEqual(["error 42501", "error TP096", "TenantError SESSION_STATE_LEFT"]);
    for (const dong of ra) expect(dong).not.toContain(GIA_TRI);
  });

  it("mã không mang hình dạng SQLSTATE thì không được ghi — chỉ tên", () => {
    for (const code of ["4250", "425011", "42s01", "ECONNREFUSED", `gia tri ${GIA_TRI}`, 42501, null, undefined]) {
      expect(moTaLoiKhongGiaTri(loiMang("error", code)), String(code)).toBe("error");
    }
  });

  it("thứ bị ném không phải Error ⇒ `loi khong ro`, không nội suy gì từ nó", () => {
    for (const v of [GIA_TRI, { name: "error", code: "42501" }, 42, undefined]) {
      expect(moTaLoiKhongGiaTri(v)).toBe("loi khong ro");
    }
  });
});

describe("[S1.68 / khoản 119] moTaLoiKhongGiaTri nêu thêm MỘT tầng `cause` cho lỗi không có trường `code`", () => {
  it("lỗi không có trường `code`, `cause` là Error ⇒ `tên <- mô tả của cause` theo cùng luật tên và mã; đúng một tầng; cause không phải Error ⇒ không nêu; lỗi CÓ trường `code` — kể cả mã không mang hình dạng được ghi — ⇒ không nêu cause; message của mọi tầng không vào dòng", () => {
    const pg42501 = loiMang("error", "42501");
    const boc = Object.assign(new Error(`thong diep mang ${GIA_TRI}`, { cause: pg42501 }), { name: "DenialAuditFailedError" });
    const ra = [
      moTaLoiKhongGiaTri(boc),
      moTaLoiKhongGiaTri(Object.assign(new Error(`thong diep mang ${GIA_TRI}`, { cause: boc }), { name: "BocNgoai" })),
      moTaLoiKhongGiaTri(Object.assign(new Error(`thong diep mang ${GIA_TRI}`, { cause: GIA_TRI }), { name: "PermissionAuditFailedError" })),
      moTaLoiKhongGiaTri(Object.assign(new Error("x", { cause: new TenantError("SESSION_STATE_LEFT", `thong diep mang ${GIA_TRI}`) }), { name: "DenialAuditFailedError" })),
      moTaLoiKhongGiaTri(Object.assign(new TenantError("SESSION_STATE_LEFT", `thong diep mang ${GIA_TRI}`), { cause: pg42501 })),
      moTaLoiKhongGiaTri(pg42501),
      moTaLoiKhongGiaTri(loiMang("error", "ECONNREFUSED")),
    ];
    expect(ra).toEqual([
      "DenialAuditFailedError <- error 42501",
      "BocNgoai <- DenialAuditFailedError",
      "PermissionAuditFailedError",
      "DenialAuditFailedError <- TenantError SESSION_STATE_LEFT",
      "TenantError SESSION_STATE_LEFT",
      "error 42501",
      "error",
    ]);
    for (const dong of ra) expect(dong).not.toContain(GIA_TRI);
  });
});
