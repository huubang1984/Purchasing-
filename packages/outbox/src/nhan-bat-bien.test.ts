import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ============================================================================================
// CANH CÁI NHÃN, KHÔNG CANH CÁI TEST — VÀ ĐÂY LÀ MỘT LỚP KHIẾM KHUYẾT ĐÃ ĐO CỦA DỰ ÁN NÀY
//
// Bộ sinh của Task 11 gom test theo MÃ trong thẻ `[INV-<mã>]` và ghi mỗi test thành một dòng
// trong `evidence/INV-matrix.md`. Vì vậy một cái thẻ SAI không phải chuyện vệ sinh: nó ghi một
// dòng "passed" vào hàng của một bất biến CHƯA CÓ LỚP NÀO, và làm một lỗ trống TRÔNG NHƯ ĐÃ VÁ.
// Task 9 vừa trả giá đúng ở đó: bốn test biên giới module mang thẻ `[INV-G3]` trong khi G3 là
// "xoay master key không làm mất khả năng giải mã báo giá cũ", và sau khi nhãn được sửa thì
// hàng G2 về 0 test — tức nó LẼ RA ĐÃ TRỐNG TỪ ĐẦU và cái nhãn sai đã che điều đó.
//
// Brief của Task 10 liệt kê C2, D4, B3 là "bất biến liên quan" và gắn `[INV-C2]` cho một test.
// Ba phép đo, viết đủ ở "LỆCH KHỎI BRIEF (9/9)" của db/migrations/007_outbox.sql:
//   C2 — chủ ngữ của C2 (RFQ, deadline, báo giá muộn) CHƯA TỒN TẠI trong 001–007;
//   D4 — outbox là POLL, độ trễ của nó bị chặn dưới bởi `pollIntervalMs`, nên nó MÂU THUẪN với
//        chính vế "tức thì" của D4; đường đúng là NOTIFY/LISTEN hoặc một đường đồng bộ;
//   B3 — B3 nói về chuỗi hash của `audit_events` và bộ kiểm chứng của nó (Task 6 đã phủ thật).
//
// Test này là lớp CƯỠNG CHẾ cho ba câu đó, để lần sau ai gắn một trong ba thẻ ấy vào gói này
// thì đó là một quyết định NHÌN THẤY ĐƯỢC (phải sửa cả file này), không phải một dòng lặng lẽ.
//
// PHẠM VI, nói đúng mức: nó chỉ canh `packages/outbox/src/`. Nó KHÔNG canh việc một task sau
// gắn thẻ sai ở gói khác — lớp đó chưa tồn tại và được ghi vào sổ nợ. Và nó canh THẺ TRÊN TÊN
// TEST, đúng thứ bộ sinh gom; thẻ xuất hiện trong chú thích (như chính khối này) là tài liệu,
// không phải bằng chứng, và cố ý không bị chặn.
// ============================================================================================

const THU_MUC = fileURLToPath(new URL(".", import.meta.url));

/** Mã bất biến mà gói này KHÔNG được phép tự nhận là đã phủ. */
const MA_BI_CAM = ["C2", "D4", "B3"] as const;

/** Cùng regex với bộ sinh của Task 11 (`NHAN_BAT_BIEN`). */
const NHAN_BAT_BIEN = /\[INV-([A-H]\d+)\]/g;

/** Dòng khai báo một test — đúng thứ bộ sinh gom, không phải mọi dòng của file. */
const DONG_KHAI_TEST = /^\s*it(?:\.each\b|\.skip\b|\.todo\b|\.only\b)?\s*[(<`]/;

interface TheTimDuoc {
  readonly file: string;
  readonly ma: string;
  readonly dong: string;
}

function quetTheTrenTenTest(): TheTimDuoc[] {
  const ketQua: TheTimDuoc[] = [];
  for (const ten of readdirSync(THU_MUC)) {
    if (!ten.endsWith(".test.ts")) continue;
    const noiDung = readFileSync(join(THU_MUC, ten), "utf8");
    for (const dong of noiDung.split("\n")) {
      if (!DONG_KHAI_TEST.test(dong)) continue;
      for (const khop of dong.matchAll(NHAN_BAT_BIEN)) {
        ketQua.push({ file: ten, ma: khop[1]!, dong: dong.trim() });
      }
    }
  }
  return ketQua;
}

describe("thẻ bất biến của gói outbox", () => {
  it("[T10-E] không test nào của gói này tự nhận đã phủ C2, D4 hay B3", () => {
    const viPham = quetTheTrenTenTest().filter((t) =>
      (MA_BI_CAM as readonly string[]).includes(t.ma),
    );
    expect(
      viPham.map((t) => `${t.file}: ${t.dong}`),
      "Một trong ba mã C2/D4/B3 vừa xuất hiện trên tên một test của gói outbox. Cả ba đã được " +
        "ĐO là không phủ được ở đây (xem LỆCH KHỎI BRIEF (9/9) ở db/migrations/007_outbox.sql). " +
        "Nếu lớp cưỡng chế thật sự đã ra đời thì sửa cả file này kèm phép đo; nếu không, thẻ đó " +
        "sẽ ghi một dòng 'passed' vào evidence/INV-matrix.md dưới một bất biến trống rỗng.",
    ).toEqual([]);
  });

  it("[T10-E] bộ quét KHÔNG rỗng ruột — nó thật sự đọc được thẻ trên tên test", () => {
    // Vế chống rỗng ruột. Không có nó, test trên xanh y hệt khi regex hỏng, khi thư mục đọc
    // nhầm, hay khi gói này không còn test nào. Gói này CÓ dùng đúng một mã bất biến — F1 —
    // và đó là mã duy nhất được dùng đúng nghĩa đen ở đây: `outbox_jobs` là một bảng tenant
    // mới, cách ly bằng RLS ở tầng CSDL.
    const the = quetTheTrenTenTest();
    expect(the.length, "không đọc được thẻ nào — bộ quét đang mù").toBeGreaterThan(0);
    expect([...new Set(the.map((t) => t.ma))].sort()).toEqual(["F1"]);
  });
});
