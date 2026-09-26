import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RFQ_STATUSES, RFQ_TRANSITIONS } from "./rfq.js";

// =============================================================================================
// BẢNG CẠNH TỒN TẠI HAI NƠI — VÀ MỘT LỚP CANH SỰ ĐỒNG BỘ
//
// `CANH_HOP_LE` trong 009 là lớp CƯỠNG CHẾ. `RFQ_TRANSITIONS` trong rfq.ts là bản sao ĐỂ ĐỌC.
// Nhân bản có chủ đích, nhưng lệch nhau thì không vô hại: giao diện dựng từ bản TS sẽ mời người
// dùng bấm một nút mà CSDL từ chối, hoặc giấu một nút mà CSDL cho phép. Cả hai đều là lỗi báo cho
// người dùng một mô hình sai về hệ thống.
//
// Cùng khuôn `HINH_DANG_CHUAN` (db/rls-coverage.int.test.ts ↔ hardening.always.sql) và
// `TAX_CODE_PATTERN` (packages/supplier ↔ 008).
// =============================================================================================

// [S1.107 / lượt soi ngang 77] LẦN THỨ HAI bảng cạnh SỐNG dời tệp: `058` thêm
// `EVALUATING->CANCELLED` bằng `CREATE OR REPLACE`, nên `011` nay cũng là một bản ĐÃ CHẾT.
// Con trỏ dưới đây phải dời theo — và đó chính là lớp lỗi mà khối ngay dưới đã gọi tên một
// lần rồi. Quy ước đọc được: con trỏ trỏ migration CUỐI CÙNG định nghĩa `CANH_HOP_LE`, cùng
// quy ước với trường `migration` của bảng ghim trong `db/migrations.int.test.ts`.
//
// [Vòng sửa sau review an ninh] Bảng cạnh SỐNG nay nằm ở 011, không ở 009: 011 thay thế thân
// `rfq_kiem_chuyen_trang_thai` bằng `CREATE OR REPLACE`. Đọc 009 sau vòng sửa là đọc một bản
// đã CHẾT — test vẫn xanh nhưng nó không còn canh thứ đang chạy. Đây đúng lớp lỗi mà chính
// file này sinh ra để chống, chỉ khác là nó đến từ phía migration.
// [S1.108 / S2.5] LẦN THỨ BA. `059` thêm NĂM cạnh của vòng BAFO, cũng bằng `CREATE OR REPLACE`,
// nên `058` nay cũng là một bản ĐÃ CHẾT. Ba lần dời trong ba vòng liên tiếp là một nhịp, không
// một sự cố: mỗi migration đổi bảng cạnh sẽ dời con trỏ này, và quy ước ở trên là thứ làm việc
// dời trở thành cơ học chứ không thành một câu hỏi.
//
// [S1.110 / S2.6] LẦN THỨ TƯ — và lần này việc dời con trỏ là thứ suýt che một khiếm khuyết
// THẬT, nên nhịp ở trên phải đọc kèm phép đo dưới đây.
//
// `061` thêm HAI cạnh (`EVALUATING->AWARDED`, `AWARDED->EVALUATING`) và nó viết lại thân hàm
// bằng `CREATE OR REPLACE`. Bản thảo đầu của `061` được viết BẰNG TAY và **rơi 45 dòng** cưỡng
// chế còn sống của `059`: vế phê duyệt kép của D2 trên băm nội dung, vế C4 *không rút ngắn
// deadline*, ba vế *mốc chỉ đặt một lần*, cửa sổ thầu tối thiểu, và vế *không mở RFQ rỗng*.
// Ba lớp đều KHÔNG kêu: `migrate()` xanh, hardening ÂM THẦM phục hồi thân `059` lên trên (nên
// migration thành no-op), và một phép tự kiểm `prosrc LIKE '%EVALUATING->AWARDED%'` trả CÓ vì
// nó khớp một CHÚ THÍCH trong thân `059` giải thích vì sao cạnh ấy vắng.
//
// Quy tắc rút ra, và nó rộng hơn tệp này: một hàm ĐÃ GHIM thì không hand-write `CREATE OR
// REPLACE` — trích nguyên thân đang sống bằng script rồi CỘNG vào, và kiểm bằng phần tử mảng
// CÓ NHÁY (`'%''EVALUATING->AWARDED''%'`) hay bằng hành vi, chứ đừng bằng một chuỗi con trần.
//
// [S1.137 / khoản 240] LẦN THỨ NĂM, và lần đầu hai thứ tệp này đọc TÁCH khỏi nhau. `067` viết lại
// thân hàm — nên mang lại nguyên khối `CANH_HOP_LE` — mà KHÔNG dựng lại `rfq_packages_status_check`.
// Một con trỏ chung cho cả hai sẽ đọc bảng cạnh ở một bản đã chết, hoặc tìm tập đóng ở một tệp
// không có nó. Hai con trỏ, mỗi cái theo quy tắc *migration CUỐI CÙNG* của thứ nó đọc.
const DUONG_DAN_BANG_CANH = fileURLToPath(
  new URL("../../../db/migrations/067_dem_chu_ky_o_canh_mo_goi.sql", import.meta.url),
);
const DUONG_DAN_TAP_DONG = fileURLToPath(
  new URL("../../../db/migrations/061_trao_thau.sql", import.meta.url),
);

/** Tập đóng của `status` ĐANG SỐNG, bóc từ `CHECK` mà `061` vừa dựng lại. */
function bocTrangThaiTuSql(): string[] {
  const sql = readFileSync(DUONG_DAN_TAP_DONG, "utf8");
  const khoi = /ADD CONSTRAINT rfq_packages_status_check\s*CHECK \(status IN \(([\s\S]*?)\)\);/
    .exec(sql);
  if (khoi?.[1] === undefined) {
    throw new Error(
      "Không tìm thấy ràng buộc rfq_packages_status_check trong 061_trao_thau.sql. Nếu tập đóng " +
        "đã dời tệp, con trỏ này phải dời CÙNG LÚC — không được xoá.",
    );
  }
  return [...khoi[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string).sort();
}

/** Bóc các chuỗi 'A->B' trong khối `CANH_HOP_LE constant text[] := ARRAY[...]` đang SỐNG. */
function bocCanhTuSql(): string[] {
  const sql = readFileSync(DUONG_DAN_BANG_CANH, "utf8");
  const khoi = /CANH_HOP_LE constant text\[\] :=\s*ARRAY\[([\s\S]*?)\]\s*;/.exec(sql);
  if (khoi?.[1] === undefined) {
    throw new Error(
      "Không tìm thấy khối CANH_HOP_LE trong 067_dem_chu_ky_o_canh_mo_goi.sql. Nếu bảng cạnh đã được " +
        "viết lại một cách khác, lớp canh này phải được viết lại CÙNG LÚC — không được xoá.",
    );
  }
  return [...khoi[1].matchAll(/'([A-Z_]+->[A-Z_]+)'/g)].map((m) => m[1] as string).sort();
}

describe("bảng cạnh của máy trạng thái RFQ", () => {
  it("bản TS và bảng cạnh SỐNG (067) là MỘT — hai bản sao không được trôi khỏi nhau", () => {
    const tuTs = RFQ_TRANSITIONS.map(([tu, den]) => `${tu}->${den}`).sort();
    const tuSql = bocCanhTuSql();

    // Chống rỗng ruột: một regex hỏng trả mảng rỗng cũng "khớp" với một mảng rỗng.
    expect(tuSql.length).toBeGreaterThan(0);
    expect(tuTs).toEqual(tuSql);
  });

  it("`CLOSED->OPEN` KHÔNG có mặt — cạnh quan trọng nhất là cạnh không tồn tại", () => {
    // Nêu ĐÍCH DANH thay vì để nó nằm im trong phép so sánh ở trên: nếu ai đó thêm cạnh này, test
    // trên cũng đỏ, nhưng thông báo sẽ là "hai mảng khác nhau" thay vì tên của thứ vừa bị phá.
    // Một RFQ mở lại sau khi đã đóng thì phong bì đã nộp vẫn nằm đó — tính niêm phong mất trong
    // im lặng.
    expect(bocCanhTuSql()).not.toContain("CLOSED->OPEN");
    expect(RFQ_TRANSITIONS.some(([tu, den]) => tu === "CLOSED" && den === "OPEN")).toBe(false);
  });

  it("mọi trạng thái trong bảng cạnh đều nằm trong tập trạng thái hợp lệ", () => {
    const hopLe = new Set<string>(RFQ_STATUSES);
    const la = RFQ_TRANSITIONS.flat().filter((s) => !hopLe.has(s));
    expect(la).toEqual([]);
  });

  // [S1.108 / S2.5] Vế NGƯỢC LẠI của ca ngay trên, và nó là vế thiếu suốt từ `009`. Ca kia đọc
  // *"bảng cạnh không nhắc trạng thái lạ"*; nó KHÔNG đọc *"`RFQ_STATUSES` bằng tập đóng của
  // CSDL"*. Chênh lệch ấy đi lọt theo cả hai chiều: một giá trị thêm vào `CHECK` mà quên bản TS
  // làm giao diện không biết trạng thái ấy tồn tại, còn một giá trị thêm vào bản TS mà quên
  // `CHECK` làm mọi câu `UPDATE` tới nó chết ở tầng CSDL với một thông điệp về ràng buộc.
  it("`RFQ_STATUSES` bằng ĐÚNG tập đóng của `rfq_packages_status_check` đang sống", () => {
    const tuSql = bocTrangThaiTuSql();
    expect(tuSql.length).toBeGreaterThan(0);
    expect([...RFQ_STATUSES].sort()).toEqual(tuSql);
  });

  // [S1.108 / S2.5] Ba cạnh KHÔNG tồn tại, nêu ĐÍCH DANH cùng khuôn `CLOSED->OPEN` ở trên. Cả ba
  // là những đường mà một người đọc spec §4.3 sẽ tưởng có.
  it("`BAFO_CLOSED->EVALUATING` KHÔNG có mặt — chấm lại phải đi qua `BAFO_UNSEALED`", () => {
    // Spec §4.3 khai đúng cạnh này. Nó bị THAY, không bị bỏ sót: nối thẳng sẽ cho một lượt chấm
    // lại chạy trong khi phong bì vòng hai còn nguyên niêm, và bảng xếp hạng khi ấy vẫn là bảng
    // của vòng một — không lớp nào kêu, vì `rfq_kiem_yeu_cau_mo_thau` chỉ nổ ở cạnh vào
    // `UNSEALED`/`BAFO_UNSEALED`. Xem khối mục (8) của `059`.
    expect(bocCanhTuSql()).not.toContain("BAFO_CLOSED->EVALUATING");
    expect(RFQ_TRANSITIONS.some(([tu, den]) => tu === "BAFO_CLOSED" && den === "EVALUATING"))
      .toBe(false);
  });

  it("`EVALUATING->BAFO_UNSEALED` KHÔNG có mặt — không nhảy tắt qua cửa nộp và cửa đóng", () => {
    expect(bocCanhTuSql()).not.toContain("EVALUATING->BAFO_UNSEALED");
  });

  it("`BAFO_CLOSED->CANCELLED`, `BAFO_UNSEALED->CANCELLED` và `AWARDED->CANCELLED` KHÔNG có mặt — khoản 225, BA cặp", () => {
    // Đây KHÔNG phải một tính chất mong muốn: nó là cùng câu hỏi nghiệp vụ mà `CLOSED` và
    // `UNSEALED` đang treo ở khoản 225, chép sang ảnh BAFO. Ghim để ngày nào khoản ấy được quyết
    // thì CẢ HAI cặp cùng đỏ — không một cặp.
    //
    // [S1.110 / S2.6] Và nay là cặp THỨ BA: `061` thêm `AWARDED` mà KHÔNG thêm
    // `AWARDED->CANCELLED`, cùng một lý do và cùng một khoản. `cancelRfq` cũng không nhận
    // `AWARDED` trong danh sách trắng của nó, nên hai lớp nói cùng một câu. Đường ra khỏi
    // `AWARDED` mà vòng này DỰNG là `AWARDED->EVALUATING` — huỷ AWARD, không huỷ gói thầu.
    const canh = bocCanhTuSql();
    expect(canh).not.toContain("AWARDED->CANCELLED");
    expect(RFQ_TRANSITIONS.some(([tu, den]) => tu === "AWARDED" && den === "CANCELLED")).toBe(false);
    expect(canh).not.toContain("CLOSED->CANCELLED");
    expect(canh).not.toContain("UNSEALED->CANCELLED");
    expect(canh).not.toContain("BAFO_CLOSED->CANCELLED");
    expect(canh).not.toContain("BAFO_UNSEALED->CANCELLED");
    // Và đối chứng DƯƠNG: hai trạng thái *đang nhận báo giá* thì huỷ ĐƯỢC, ở cả hai vòng. Không
    // có vế này, bốn khẳng định trên cũng xanh với một bảng cạnh không có cạnh huỷ nào.
    expect(canh).toContain("OPEN->CANCELLED");
    expect(canh).toContain("BAFO_OPEN->CANCELLED");
  });
});
