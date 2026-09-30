// ==============================================================================================
// [S1.241 / khoản 279] MÃ LÝ DO ĐI VÀO DÒNG LOG KHI LẦN GHI SỔ `RFQ_STATE_DENIED` GÃY — ĐO Ở MỨC HÀM
//
// `nemTuChoi` ghi một hàng `RFQ_STATE_DENIED` payload `{ ma: loi.lyDo }` ở giao dịch ĐỘC LẬP qua `throwAuditedDenial` (ADR-060).
// Khi lần ghi ấy gãy — khoá ghi sổ của tổ chức bị giữ quá trần 2 s của `050` ⇒ `55P03` (§S1.225) —, dòng log của bộ điều phối là
// thứ duy nhất còn lại, và tới trước vòng này nó là
//
//     DenialAuditFailedError RFQ_STATE_DENIED RFQ nguoi=<băm> <- error 55P03
//
// cho cả chín mã vào sổ: người vận hành không biết người ấy đã cố đi tắt bước NÀO (chấm, đề xuất, duyệt, rút, huỷ, mở hay đóng vòng
// BAFO) — trong khi đó chính là câu mà hàng sổ trả lời (khoản 279). Nay `loi.lyDo` đi làm VẾ: đối số thứ năm của
// `throwAuditedDenial` ⇒ `DenialAuditFailedError.clause` ⇒ dòng log qua phép thuộc-tập `DANH_MUC_VE_CONG` của `@trustprocure/identity`.
//
// Pool giả: lần lấy kết nối của lần ghi sổ ném một `pg.DatabaseError` mang SQLSTATE `55P03` — đúng lớp và mã §S1.225 đo được. Phần
// còn lại của chuỗi là mã thật. Không nhãn `[INV-…]` (cùng lý do `packages/identity/src/chot-kiem-soat.test.ts`).
// ==============================================================================================
import { createHash } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { DenialAuditFailedError, moTaLoiKhongGiaTri } from "@trustprocure/identity";
import { VAO_SO, nemTuChoi, type LoiTuChoiTrangThai, type MaTuChoiTrangThai } from "./tu-choi-vao-so.js";

const ORG = "1b2c3d4e-5f60-4a71-8b82-9c0d1e2f3a4b";
const RFQ = "2c3d4e5f-6071-4b82-9c93-0d1e2f3a4b5c";
const NGUOI = "3d4e5f60-7182-4c93-8da4-1e2f3a4b5c6d";

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

/**
 * Một lỗi từ chối trạng thái theo HÌNH DẠNG chung `LoiTuChoiTrangThai` — ba lớp lỗi thật (`DanhGiaTuChoiError`,
 * `VongBafoTuChoiError`, `TraoThauTuChoiError`) thoả nó theo cấu trúc, mỗi lớp một tập con của từ vựng; hình dạng chung phủ cả
 * mười bốn mã một lần. Thông điệp mang một tên gói thầu — một GIÁ TRỊ, và nó không được ra dòng log.
 */
function loiTuChoi(lyDo: MaTuChoiTrangThai): LoiTuChoiTrangThai {
  return Object.assign(new Error(`Goi thau "Mua may chu 4111-1111" khong o trang thai ${lyDo}`), { lyDo });
}

async function batLoi(viec: Promise<unknown>): Promise<unknown> {
  try {
    await viec;
  } catch (loi) {
    return loi;
  }
  throw new Error("lời hứa lẽ ra phải NÉM — nemTuChoi không có đường trả về");
}

const MA = Object.keys(VAO_SO) as MaTuChoiTrangThai[];
const MA_VAO_SO = MA.filter((ma) => VAO_SO[ma].vaoSo);
const MA_KHONG_VAO_SO = MA.filter((ma) => !VAO_SO[ma].vaoSo);

describe("[S1.241 / khoản 279] lần ghi sổ `RFQ_STATE_DENIED` gãy 55P03 ⇒ dòng log mang MÃ LÝ DO", () => {
  it("đối chứng chống rỗng ruột: bảng có mã vào sổ lẫn mã không vào sổ — hai nhánh dưới đây đều có ca", () => {
    expect(MA_VAO_SO.length).toBeGreaterThan(0);
    expect(MA_KHONG_VAO_SO.length).toBeGreaterThan(0);
    expect(MA_VAO_SO.length + MA_KHONG_VAO_SO.length).toBe(MA.length);
  });

  it.each(MA_VAO_SO)("%s ⇒ `DenialAuditFailedError` mang mã ở `clause`, và dòng log nói đúng bước nào bị đi tắt", async (ma) => {
    const { pool, soLanLay } = poolGay();
    const tuChoi = loiTuChoi(ma);
    const loi = await batLoi(nemTuChoi(pool, ORG, NGUOI, RFQ, tuChoi));
    expect(loi).toBeInstanceOf(DenialAuditFailedError);
    const boc = loi as DenialAuditFailedError;
    expect(boc.clause).toBe(ma);
    expect(boc.denial).toBe(tuChoi);
    expect(moTaLoiKhongGiaTri(loi)).toBe(`DenialAuditFailedError RFQ_STATE_DENIED RFQ ${ma} nguoi=${bamRutGon(NGUOI)} <- error 55P03`);
    expect(soLanLay()).toBe(1);
  });

  it.each(MA_KHONG_VAO_SO)("đối chứng: %s (`vaoSo: false`) ⇒ ném CHÍNH lỗi, KHÔNG chạm pool, không dòng mất sổ nào", async (ma) => {
    const { pool, soLanLay } = poolGay();
    const tuChoi = loiTuChoi(ma);
    const loi = await batLoi(nemTuChoi(pool, ORG, NGUOI, RFQ, tuChoi));
    expect(loi).toBe(tuChoi);
    expect(soLanLay()).toBe(0);
  });

  it("[A2] dòng log KHÔNG mang một giá trị nào: không id tổ chức, gói, người; không thông điệp của lỗi từ chối hay của lỗi `pg`", async () => {
    const { pool } = poolGay();
    const loi = await batLoi(nemTuChoi(pool, ORG, NGUOI, RFQ, loiTuChoi("RFQ_KHONG_CHAM_DUOC")));
    const dong = moTaLoiKhongGiaTri(loi);
    for (const gt of [ORG, RFQ, NGUOI, "4111-1111", "Mua may chu", "lock timeout"]) expect(dong).not.toContain(gt);
    expect(dong).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/u);
  });
});
