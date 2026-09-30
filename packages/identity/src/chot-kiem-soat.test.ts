// ==============================================================================================
// [S1.9125 / khoản 279] MÃ CHỐT ĐI VÀO DÒNG LOG KHI LẦN GHI SỔ `CONTROL_DENIED` GÃY — ĐO Ở MỨC HÀM
//
// `tuChoiTheoChotTaiNguyen` ghi một hàng `CONTROL_DENIED` payload `{ ma }` ở giao dịch ĐỘC LẬP qua `throwAuditedDenial`
// (ADR-108 ⑵). Khi lần ghi ấy gãy — khoá ghi sổ của tổ chức bị giữ quá trần 2 s của `050` ⇒ `55P03` (§S1.225) —, thứ còn lại
// là dòng log của bộ điều phối, dựng từ `moTaLoiKhongGiaTri`. Tới trước vòng này dòng ấy là
//
//     DenialAuditFailedError CONTROL_DENIED RFQ nguoi=<băm> <- error 55P03
//
// cho MỌI mã vào sổ của bảng — mười bảy mã chung một `action`/`resourceType` —, và mã chốt chỉ sống ở payload của chính hàng không
// ghi được (khoản 279). Nay mã đi làm VẾ: đối số thứ năm của `throwAuditedDenial` ⇒ `DenialAuditFailedError.clause` ⇒ dòng log qua
// phép thuộc-tập `DANH_MUC_VE_CONG` (`rbac.ts`) — cơ chế của khoản 179, không cơ chế mới.
//
// Pool giả: lần lấy kết nối của lần ghi sổ ném một `pg.DatabaseError` mang SQLSTATE `55P03` — đúng lớp và mã mà `lock_timeout` của
// `noi_chuoi_kiem_toan()` ném (§S1.225: `<- error 55P03`). Phần còn lại của chuỗi — `tuChoiTheoChot*`, `throwAuditedDenial`,
// `withTenant`, lớp lỗi, `moTaLoiKhongGiaTri` — là mã thật. Đường có khoá ghi sổ THẬT trên PostgreSQL 16 đo một lần ở biên bản
// §S1.9125 mục 3 (phép đo tạm, không vào kho); tệp này là lớp giữ lại.
//
// Không nhãn `[INV-…]`: tệp đo nội dung chẩn đoán của một dòng log, không một bất biến của `TEST-PLAN` (cùng lý do
// `danh-muc-tu-choi.test.ts`, §S1.225 mục 5).
// ==============================================================================================
import { createHash } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { CHOT_VAO_SO, ChotKiemSoatError, tuChoiTheoChot, tuChoiTheoChotTaiNguyen, type MaChotKiemSoat } from "./chot-kiem-soat.js";
import { moTaLoiKhongGiaTri } from "./mo-ta-loi.js";
import { DenialAuditFailedError } from "./rbac.js";

const ORG = "6d1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const RFQ = "7e2a3b4c-5d6e-4f70-9a1b-2c3d4e5f6a7b";
const NCC = "8f3b4c5d-6e7f-4a81-8b2c-3d4e5f6a7b8c";
const NGUOI = "9a4c5d6e-7f80-4b92-9c3d-4e5f6a7b8c9d";

/** Băm rút gọn mà ADR-127 khai — tính LẠI ở đây, độc lập với `rbac.ts`. */
function bamRutGon(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex").slice(0, 12);
}

/** Lỗi `pg` của lần ghi sổ gãy vì khoá ghi sổ bị giữ quá trần: lớp `DatabaseError`, tên `error`, SQLSTATE `55P03`. */
function loiKhoaGhiSo(): pg.DatabaseError {
  const loi = new pg.DatabaseError("canceling statement due to lock timeout", 0, "error");
  loi.code = "55P03";
  return loi;
}

/** Pool giả: mỗi lần lấy kết nối gãy `55P03`; đếm số lần lấy để đối chứng nhánh không vào sổ không chạm pool. */
function poolGay(): { readonly pool: pg.Pool; readonly soLanLay: () => number } {
  let soLan = 0;
  const pool = {
    connect: (): Promise<never> => {
      soLan += 1;
      return Promise.reject(loiKhoaGhiSo());
    },
  } as unknown as pg.Pool;
  return { pool, soLanLay: () => soLan };
}

async function batLoi(viec: Promise<unknown>): Promise<unknown> {
  try {
    await viec;
  } catch (loi) {
    return loi;
  }
  throw new Error("lời hứa lẽ ra phải NÉM — tuChoiTheoChot không có đường trả về");
}

const MA = Object.keys(CHOT_VAO_SO) as MaChotKiemSoat[];
const MA_VAO_SO = MA.filter((ma) => CHOT_VAO_SO[ma].vaoSo);
const MA_KHONG_VAO_SO = MA.filter((ma) => !CHOT_VAO_SO[ma].vaoSo);

describe("[S1.9125 / khoản 279] lần ghi sổ `CONTROL_DENIED` gãy 55P03 ⇒ dòng log mang MÃ CHỐT", () => {
  it("đối chứng chống rỗng ruột: bảng có mã vào sổ lẫn mã không vào sổ — hai nhánh dưới đây đều có ca", () => {
    expect(MA_VAO_SO.length).toBeGreaterThan(0);
    expect(MA_KHONG_VAO_SO.length).toBeGreaterThan(0);
    expect(MA_VAO_SO.length + MA_KHONG_VAO_SO.length).toBe(MA.length);
  });

  it.each(MA_VAO_SO)("%s ⇒ `DenialAuditFailedError` mang mã ở `clause`, và dòng log nói đúng chốt nào", async (ma) => {
    const { pool, soLanLay } = poolGay();
    const loi = await batLoi(tuChoiTheoChot(pool, ORG, { type: "USER", id: NGUOI }, RFQ, ma));
    expect(loi).toBeInstanceOf(DenialAuditFailedError);
    const boc = loi as DenialAuditFailedError;
    expect(boc.clause).toBe(ma);
    // Lần từ chối mà lẽ ra phải vào sổ vẫn đi kèm — người điều tra đọc `denial`, không mất gì so với trước.
    expect(boc.denial).toBeInstanceOf(ChotKiemSoatError);
    expect((boc.denial as ChotKiemSoatError).lyDo).toBe(ma);
    expect(moTaLoiKhongGiaTri(loi)).toBe(`DenialAuditFailedError CONTROL_DENIED RFQ ${ma} nguoi=${bamRutGon(NGUOI)} <- error 55P03`);
    expect(soLanLay()).toBe(1);
  });

  it("tài nguyên không phải gói thầu (K8a trên NHÀ CUNG CẤP, `tuChoiTheoChotTaiNguyen`) ⇒ cùng khe vế, `resourceType` của chính lời gọi", async () => {
    for (const ma of ["K8A_NGUOI_TAO_TU_XAC_MINH", "K8A_NGUOI_MOI_XAC_MINH"] as const) {
      const { pool } = poolGay();
      const loi = await batLoi(tuChoiTheoChotTaiNguyen(pool, ORG, { type: "USER", id: NGUOI }, { resourceType: "SUPPLIER", resourceId: NCC }, ma));
      expect(moTaLoiKhongGiaTri(loi), ma).toBe(`DenialAuditFailedError CONTROL_DENIED SUPPLIER ${ma} nguoi=${bamRutGon(NGUOI)} <- error 55P03`);
    }
  });

  it.each(MA_KHONG_VAO_SO)("đối chứng: %s (`vaoSo: false`) ⇒ `ChotKiemSoatError` thẳng, KHÔNG chạm pool, không dòng mất sổ nào", async (ma) => {
    const { pool, soLanLay } = poolGay();
    const loi = await batLoi(tuChoiTheoChot(pool, ORG, { type: "USER", id: NGUOI }, RFQ, ma));
    expect(loi).toBeInstanceOf(ChotKiemSoatError);
    expect(soLanLay()).toBe(0);
  });

  it("[A2] dòng log KHÔNG mang một giá trị nào: không id tổ chức, gói, người; không thông điệp của lỗi `pg` hay của chốt", async () => {
    const { pool } = poolGay();
    const loi = await batLoi(tuChoiTheoChot(pool, ORG, { type: "USER", id: NGUOI }, RFQ, "THIEU_NGAN_SACH"));
    const dong = moTaLoiKhongGiaTri(loi);
    for (const gt of [ORG, RFQ, NGUOI, "lock timeout", CHOT_VAO_SO.THIEU_NGAN_SACH.thongDiep]) expect(dong).not.toContain(gt);
    expect(dong).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/u);
  });
});
