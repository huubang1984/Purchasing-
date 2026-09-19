// ==============================================================================================
// [S1.85 / khoản 147] BỘ LỌC D2 CỦA `approveUnseal` PHẢI KHỚP NGUYÊN VĂN CÁC CÂU `RAISE` CỦA `019`.
//
// Bất biến D5 nói một lần THỬ vi phạm D2 phải để lại dấu vết. `approveUnseal` nhận biết một lần
// thử như thế bằng THÔNG ĐIỆP của trigger `unseal_kiem_nguoi_duyet` — tức bất biến ấy sống trong
// HAI bản: thân trigger ở `019_unseal.sql`, và biểu thức chính quy ở `requests.ts`. Hai bản lệch
// nhau thì lớp cưỡng chế vẫn chặn (trigger đúng) nhưng DẤU VẾT mất, và không gì kêu lên.
//
// VÀ NÓ ĐÃ LỆCH, năm vòng liền: bộ lọc viết `phai o mot PHIEN khac` trong khi câu `RAISE` thật là
// `Phe duyet phai den tu mot PHIEN KHAC voi phien da yeu cau (D2)`. Chuỗi cũ khớp một câu `RAISE`
// KHÁC — của nhánh break-glass trên bảng `unseal_requests`, và câu ấy ở `022_security_review_s1.sql`
// chứ không ở `019` như §S1.78 ghi (đo ở vế cuối tệp này) — nên nó là một vế CHẾT đối với câu
// `INSERT INTO unseal_approvals`: trigger break-glass ấy không nổ từ câu INSERT này.
//
// KHÔNG PHÉP ĐO HÀNH VI NÀO BẮT ĐƯỢC, và đó là lý do tệp này tồn tại: ca ấy không TỚI ĐƯỢC qua `approveUnseal` (danh tính
// người duyệt là dẫn xuất của phiên, nên vế TỰ PHÊ DUYỆT nổ trước). Đột biến đo được (§S1.85): trả bộ lọc về chuỗi cũ thì
// trọn `unseal.int.test.ts` vẫn XANH — 40/40. Một vế chỉ có test hành vi canh là một vế sẽ chết lại.
//
// Tệp này là lớp bắt: nó ĐỌC migration thay vì chép lại chuỗi, cùng khuôn §R3 đã dùng cho
// `ma-tran-quyen.test.ts` và cho thân `noi_chuoi_kiem_toan()`.
// ==============================================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { laViPhamD2TheoThongDiep } from "./requests.js";

const THU_MUC_MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const SQL_019 = readFileSync(join(THU_MUC_MIGRATIONS, "019_unseal.sql"), "utf8");

/** Mọi câu `RAISE EXCEPTION` của MỌI migration — dùng cho vế đối chứng về chuỗi cũ. */
function moiCauRaiseCuaKho(): { tep: string; cau: string }[] {
  return readdirSync(THU_MUC_MIGRATIONS)
    .filter((t) => t.endsWith(".sql"))
    .flatMap((t) =>
      [...readFileSync(join(THU_MUC_MIGRATIONS, t), "utf8").matchAll(/RAISE EXCEPTION '([^']+)'/gu)].map((m) => ({
        tep: t,
        cau: m[1] ?? "",
      })),
    );
}

/** Thân hàm `unseal_kiem_nguoi_duyet()` — trigger DUY NHẤT của `unseal_approvals` nói "không" vì D2. */
function thanKiemNguoiDuyet(): string {
  const dau = SQL_019.indexOf("CREATE OR REPLACE FUNCTION public.unseal_kiem_nguoi_duyet()");
  expect(dau, "không tìm thấy `unseal_kiem_nguoi_duyet()` trong 019 — migration đã đổi tên hàm?").toBeGreaterThan(0);
  const cuoi = SQL_019.indexOf("CREATE TRIGGER unseal_approvals_kiem_nguoi_duyet", dau);
  expect(cuoi).toBeGreaterThan(dau);
  return SQL_019.slice(dau, cuoi);
}

/** Mọi câu `RAISE EXCEPTION '…'` của thân ấy, NGUYÊN VĂN — `%` giữ nguyên, nó không đổi kết quả khớp. */
function cauRaise(than: string): string[] {
  return [...than.matchAll(/RAISE EXCEPTION '([^']+)'/gu)].map((m) => m[1] ?? "");
}

/** Hai câu D2 — hai vế mà bộ lọc PHẢI nhận. Nêu bằng mảnh khoá, không chép cả câu: cả câu đọc từ `019`. */
const MANH_D2 = ["khong duoc tu phe duyet", "PHIEN KHAC"];

describe("[INV-D2] [INV-D5] [S1.85 / khoản 147] bộ lọc D2 đối chiếu với 019", () => {
  it("ĐỐI CHỨNG: đọc ra đủ các câu `RAISE` của `unseal_kiem_nguoi_duyet()` — một phép đọc 0 câu là một cổng rỗng ruột", () => {
    const cau = cauRaise(thanKiemNguoiDuyet());
    expect(cau.length, `đọc ra: ${JSON.stringify(cau)}`).toBeGreaterThanOrEqual(4);
  });

  it("bộ lọc khớp ĐÚNG hai câu D2 của `019`, NGUYÊN VĂN — không câu nào trong hai câu ấy là vế chết", () => {
    const cau = cauRaise(thanKiemNguoiDuyet());
    const d2 = cau.filter((c) => MANH_D2.some((m) => c.includes(m)));
    expect(d2, `hai câu D2 phải còn trong 019: ${JSON.stringify(cau)}`).toHaveLength(2);
    const truot = d2.filter((c) => !laViPhamD2TheoThongDiep(new Error(c)));
    expect(
      truot,
      "một câu `RAISE` D2 mà bộ lọc KHÔNG khớp là một vế chết: trigger vẫn chặn, nhưng `UNSEAL_APPROVAL_DENIED` không được ghi",
    ).toEqual([]);
  });

  it("bộ lọc KHÔNG khớp các câu `RAISE` còn lại của cùng thân — chúng không phải vi phạm D2", () => {
    const cau = cauRaise(thanKiemNguoiDuyet());
    const khac = cau.filter((c) => !MANH_D2.some((m) => c.includes(m)));
    expect(khac.length, `phải còn ít nhất một câu không-D2 để đối chứng: ${JSON.stringify(cau)}`).toBeGreaterThanOrEqual(2);
    const lot = khac.filter((c) => laViPhamD2TheoThongDiep(new Error(c)));
    expect(lot, "một câu không phải D2 mà bộ lọc nhận sẽ ghi `UNSEAL_APPROVAL_DENIED` cho một ca không phải từ chối D2").toEqual([]);
  });

  it("§R3: hai câu D2 của `019` có mặt NGUYÊN VĂN trong bản CƯỠNG CHẾ ở `hardening.always.sql` — bản ấy mới là bản chạy ở mọi lần migrate", () => {
    // `hardening.always.sql` áp lại thân `unseal_kiem_nguoi_duyet()` ở MỌI lần `migrate()`, nên
    // thông điệp mà một cụm thật ném ra là thông điệp của BẢN ẤY, không phải của `019`. Tệp này
    // đọc `019` cho dễ đọc; vế này là thứ giữ cho phép đọc ấy không nói về một bản đã bị thay.
    const hardening = readFileSync(join(THU_MUC_MIGRATIONS, "hardening.always.sql"), "utf8");
    const d2 = cauRaise(thanKiemNguoiDuyet()).filter((c) => MANH_D2.some((m) => c.includes(m)));
    expect(d2).toHaveLength(2);
    expect(
      d2.filter((c) => !hardening.includes(c)),
      "một câu D2 của `019` KHÔNG có trong bản cưỡng chế: bộ lọc đối chiếu với một bản không chạy",
    ).toEqual([]);
  });

  it("chuỗi CŨ `phai o mot PHIEN khac` không khớp câu `RAISE` nào của thân ấy — nó là chuỗi của nhánh break-glass, một trigger KHÁC trên bảng `unseal_requests`", () => {
    const cuNo = /phai o mot PHIEN khac/iu;
    expect(cauRaise(thanKiemNguoiDuyet()).filter((c) => cuNo.test(c))).toEqual([]);
    // ĐỐI CHỨNG, và nó sửa một lời khai của sổ nợ: §S1.78 ghi rằng chuỗi cũ khớp một câu `RAISE` của nhánh break-glass
    // "trên bảng `unseal_requests`" — đúng bảng, nhưng câu ấy KHÔNG nằm ở `019`, nó ở `022_security_review_s1.sql`
    // (và bản cưỡng chế ở `hardening.always.sql`). Bản đầu của vế này quét đúng `019` và ĐỎ; phép đo sửa lời khai,
    // không phải nới phép đo.
    const trung = moiCauRaiseCuaKho().filter((x) => cuNo.test(x.cau));
    expect(
      trung.map((x) => x.tep).filter((t) => t !== "hardening.always.sql"),
      "chuỗi cũ phải khớp một câu RAISE có thật ở đâu đó — nếu 0 thì lời khai `nó khớp nhánh break-glass` đã thiu",
    ).toEqual(["022_security_review_s1.sql"]);
  });
});
