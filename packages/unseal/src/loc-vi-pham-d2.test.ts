// ==============================================================================================
// [S1.85 / khoản 147] BỘ LỌC D2 CỦA `approveUnseal` PHẢI KHỚP NGUYÊN VĂN CÁC CÂU `RAISE` CỦA ~~`019`~~
// [S1.242 / khoản 181] THÂN TRIGGER MÀ `hardening.always.sql` ÁP LẠI Ở MỌI LƯỢT `migrate()` — `019` LÀ VẾ LỊCH SỬ.
//
// Bất biến D5 nói một lần THỬ vi phạm D2 phải để lại dấu vết. `approveUnseal` nhận biết một lần
// thử như thế bằng THÔNG ĐIỆP của trigger `unseal_kiem_nguoi_duyet` — tức bất biến ấy sống trong
// HAI bản: thân trigger ~~ở `019_unseal.sql`~~ [S1.242 / khoản 181] (bản CHẠY: bản hardening áp lại; `019` là bản
// dựng đầu), và biểu thức chính quy ở `requests.ts`. Hai bản lệch
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
//
// [S1.242 / khoản 181] NGUỒN ĐỔI TỪ `019` SANG HARDENING. `019` là một migration ĐÃ ÁP — thân lẫn chú thích khoá bằng checksum
// (khoản 19) —, nên nó là tệp KHÔNG thể trôi: neo bộ lọc vào đó là neo vào một hằng số. Thân chạy trên MỌI cụm là thân mà hàng
// `hàm + trigger unseal_kiem_nguoi_duyet (019)` của `hardening.always.sql` áp lại khi thân hiện tại lệch bản chuẩn. Bản cũ đọc bộ lọc
// với `019` và chỉ hỏi "câu D2 của `019` có mặt Ở ĐÂU ĐÓ trong hardening" (`includes` trên cả tệp, kể cả hậu điều kiện và chú thích).
// Đo trước (§S1.242): sửa câu D2 ở thân câu sửa của hàng ấy, không sửa bộ lọc ⇒ bản cũ XANH 5/5 — bản `$than$` của hậu điều kiện
// vẫn giữ câu cũ nên `includes` thoả. Nay: ⑴ bộ lọc đối chiếu với các câu `RAISE` của THÂN CÂU SỬA ấy; ⑵ thân câu sửa và thân
// chuẩn (`$than$`, hậu điều kiện) của CÙNG hàng phải nói cùng các câu; ⑶ `019` là vế LỊCH SỬ — các câu của nó phải khớp từng chữ,
// đúng thứ tự, với thân hardening, không còn là nguồn duy nhất.
// ==============================================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { laViPhamD2TheoThongDiep } from "./requests.js";

const THU_MUC_MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const SQL_019 = readFileSync(join(THU_MUC_MIGRATIONS, "019_unseal.sql"), "utf8");
const HARDENING = readFileSync(join(THU_MUC_MIGRATIONS, "hardening.always.sql"), "utf8");

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

/**
 * Thân hàm `unseal_kiem_nguoi_duyet()` ~~— trigger DUY NHẤT của `unseal_approvals` nói "không" vì D2~~ [S1.242 / khoản 181] ở
 * `019` — bản DỰNG ĐẦU, vế lịch sử. Trigger ấy vẫn là trigger DUY NHẤT của `unseal_approvals` nói "không" vì D2.
 */
function thanTrong019(): string {
  const dau = SQL_019.indexOf("CREATE OR REPLACE FUNCTION public.unseal_kiem_nguoi_duyet()");
  expect(dau, "không tìm thấy `unseal_kiem_nguoi_duyet()` trong 019 — migration đã đổi tên hàm?").toBeGreaterThan(0);
  const cuoi = SQL_019.indexOf("CREATE TRIGGER unseal_approvals_kiem_nguoi_duyet", dau);
  expect(cuoi).toBeGreaterThan(dau);
  return SQL_019.slice(dau, cuoi);
}

/**
 * [S1.242 / khoản 181] Nhãn của hàng hardening ghim thân hàm + trigger — đọc nguyên văn, đúng một lần trong tệp.
 * [S1.245 / khoản 266] Nhãn đổi theo khuôn các hàng "thân từ 074": thân nay từ `098_khong_tim_thay_yeu_cau_co_ten.sql` (nhánh không
 * thấy yêu cầu mang `USING CONSTRAINT`; câu thông điệp không đổi, nên các vế dưới — kể cả vế LỊCH SỬ — đọc cùng các câu `RAISE`).
 */
const NHAN_HANG = "$q$hàm + trigger unseal_kiem_nguoi_duyet (019, thân từ 098_khong_tim_thay_yeu_cau_co_ten.sql)$q$";

/** [S1.242 / khoản 181] Văn bản của hàng ấy, từ nhãn tới dòng đóng `    ],` của nó. */
function hangHardening(): string {
  const dau = HARDENING.indexOf(NHAN_HANG);
  expect(dau, "không tìm thấy hàng ghim `unseal_kiem_nguoi_duyet` trong hardening.always.sql — hàng đã đổi nhãn?").toBeGreaterThan(0);
  expect(HARDENING.indexOf(NHAN_HANG, dau + 1), "nhãn hàng phải có đúng một lần").toBe(-1);
  const cuoi = HARDENING.indexOf("\n    ],", dau);
  expect(cuoi).toBeGreaterThan(dau);
  return HARDENING.slice(dau, cuoi);
}

/**
 * [S1.242 / khoản 181] Thân CÂU SỬA của hàng ấy — `CREATE OR REPLACE FUNCTION public.unseal_kiem_nguoi_duyet() … AS $<thẻ>$ … $<thẻ>$`,
 * đúng văn bản hardening dựng lại khi thân hiện tại lệch bản chuẩn: nguồn NGUYÊN VĂN của các vế dưới.
 */
function thanCauSua(): string {
  const hang = hangHardening();
  const dau = hang.indexOf("CREATE OR REPLACE FUNCTION public.unseal_kiem_nguoi_duyet()");
  expect(dau, "hàng không còn câu sửa `CREATE OR REPLACE FUNCTION public.unseal_kiem_nguoi_duyet()`").toBeGreaterThan(0);
  const the = /\bAS\s+(\$[A-Za-z_]*\$)/u.exec(hang.slice(dau));
  expect(the, "câu sửa không có `AS $<thẻ>$`").not.toBeNull();
  const moDau = dau + the!.index + the![0].length;
  const dong = hang.indexOf(the![1]!, moDau);
  expect(dong, `thẻ ${the![1]!} không đóng`).toBeGreaterThan(moDau);
  return hang.slice(moDau, dong);
}

/** [S1.242 / khoản 181] Thân CHUẨN của CÙNG hàng — `$than$…$than$` ở hậu điều kiện, bản đã chuẩn hoá khoảng trắng mà mọi cụm phải khớp. */
function thanChuan(): string {
  const hang = hangHardening();
  const dau = hang.indexOf("$than$");
  expect(dau, "hậu điều kiện của hàng không còn `$than$`").toBeGreaterThan(0);
  const cuoi = hang.indexOf("$than$", dau + 6);
  expect(cuoi, "`$than$` không đóng").toBeGreaterThan(dau);
  return hang.slice(dau + 6, cuoi);
}

/** Mọi câu `RAISE EXCEPTION '…'` của thân ấy, NGUYÊN VĂN — `%` giữ nguyên, nó không đổi kết quả khớp. */
function cauRaise(than: string): string[] {
  return [...than.matchAll(/RAISE EXCEPTION '([^']+)'/gu)].map((m) => m[1] ?? "");
}

/** Hai câu D2 — hai vế mà bộ lọc PHẢI nhận. Nêu bằng mảnh khoá, không chép cả câu: cả câu đọc từ ~~`019`~~ [S1.242 / khoản 181] thân hardening. */
const MANH_D2 = ["khong duoc tu phe duyet", "PHIEN KHAC"];

describe("[INV-D2] [INV-D5] [S1.85 / khoản 147] bộ lọc D2 đối chiếu với thân trigger CHẠY — bản hardening áp lại; 019 là vế lịch sử", () => {
  it("ĐỐI CHỨNG: đọc ra đủ các câu `RAISE` của `unseal_kiem_nguoi_duyet()` ở cả thân hardening lẫn 019 — một phép đọc 0 câu là một cổng rỗng ruột", () => {
    const cau = cauRaise(thanCauSua());
    expect(cau.length, `đọc ra từ hardening: ${JSON.stringify(cau)}`).toBeGreaterThanOrEqual(4);
    expect(cauRaise(thanTrong019()).length, "đọc ra từ 019").toBeGreaterThanOrEqual(4);
  });

  it("bộ lọc khớp ĐÚNG hai câu D2 của thân hardening, NGUYÊN VĂN — không câu nào trong hai câu ấy là vế chết", () => {
    const cau = cauRaise(thanCauSua());
    const d2 = cau.filter((c) => MANH_D2.some((m) => c.includes(m)));
    expect(d2, `hai câu D2 phải còn trong thân hardening: ${JSON.stringify(cau)}`).toHaveLength(2);
    const truot = d2.filter((c) => !laViPhamD2TheoThongDiep(new Error(c)));
    expect(
      truot,
      "một câu `RAISE` D2 mà bộ lọc KHÔNG khớp là một vế chết: trigger vẫn chặn, nhưng `UNSEAL_APPROVAL_DENIED` không được ghi",
    ).toEqual([]);
  });

  it("bộ lọc KHÔNG khớp các câu `RAISE` còn lại của cùng thân — chúng không phải vi phạm D2", () => {
    const cau = cauRaise(thanCauSua());
    const khac = cau.filter((c) => !MANH_D2.some((m) => c.includes(m)));
    expect(khac.length, `phải còn ít nhất một câu không-D2 để đối chứng: ${JSON.stringify(cau)}`).toBeGreaterThanOrEqual(2);
    const lot = khac.filter((c) => laViPhamD2TheoThongDiep(new Error(c)));
    expect(lot, "một câu không phải D2 mà bộ lọc nhận sẽ ghi `UNSEAL_APPROVAL_DENIED` cho một ca không phải từ chối D2").toEqual([]);
  });

  it("§R3: thân CÂU SỬA và thân CHUẨN (`$than$`) của cùng hàng hardening nói CÙNG các câu `RAISE` — bản dựng lại khi lệch và bản mọi cụm phải khớp là một", () => {
    // ~~`hardening.includes(c)` trên CẢ TỆP~~ [S1.242 / khoản 181] Hai biểu diễn của CÙNG thân trong CÙNG hàng: câu sửa là văn bản
    // hardening dựng lại, `$than$` là văn bản mà thân đang chạy phải khớp (khoảng trắng đã chuẩn hoá). Lệch nhau thì câu nào chạy tuỳ
    // lịch sử của từng cụm — và bộ lọc chỉ được đối chiếu với một trong hai.
    expect(cauRaise(thanChuan()), "câu RAISE ở hậu điều kiện khác câu RAISE ở câu sửa").toEqual(cauRaise(thanCauSua()));
  });

  it("vế LỊCH SỬ: mọi câu `RAISE` của thân ở `019` khớp TỪNG CHỮ, ĐÚNG THỨ TỰ, với thân hardening áp lại — 019 là bản dựng đầu, không còn là nguồn", () => {
    // [S1.242 / khoản 181] `019` không đổi được (checksum, khoản 19); hardening thì đổi được ở mỗi vòng. Hai bản phải khớp: đổi một
    // câu ở hardening là đổi thông điệp mà mọi cụm đang chạy ném ra — việc ấy phải đi qua một quyết định nhìn thấy được (sửa vế này có
    // lý do), không lặng lẽ.
    expect(
      cauRaise(thanCauSua()),
      "câu RAISE của thân hardening lệch câu RAISE của 019 — thông điệp của mọi cụm đã đổi so với bản dựng đầu",
    ).toEqual(cauRaise(thanTrong019()));
  });

  it("chuỗi CŨ `phai o mot PHIEN khac` không khớp câu `RAISE` nào của thân ấy — nó là chuỗi của nhánh break-glass, một trigger KHÁC trên bảng `unseal_requests`", () => {
    const cuNo = /phai o mot PHIEN khac/iu;
    expect(cauRaise(thanCauSua()).filter((c) => cuNo.test(c))).toEqual([]);
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
