// [S1.164 / khoản 244] TẬP ĐƠN VỊ TIỀN CÓ BỐN BẢN CHÉP, VÀ CHÚNG PHẢI LÀ MỘT TẬP.
//
// ⑴ `CURRENCIES` của gói này — thứ API người mua dùng để từ chối một chính sách hay ngân sách lạ.
// ⑵ `CHECK (currency IN (…))` của `057` — thứ CSDL dùng để từ chối một lượt chấm lạ.
// ⑶ Hai giá trị `RETURN '…'` của `public.bid_currency` (`070`) — tập ĐÍCH của phép chuẩn hoá.
// ⑷ Các `<option>` của `#tien-te` ở trang nộp thầu — thứ nhà cung cấp được chọn.
//
// `apps/web` cố ý không phụ thuộc gói nào (ADR-044: `dependencies` rỗng là một bảo đảm), nên nó không
// import được ⑴; test đặt ở đây và ĐỌC ba bản kia như tệp — cùng khuôn `transitions.test.ts` đọc bảng
// cạnh. Một đơn vị thêm ở một bản mà quên bản khác sẽ đỏ ở đây: thêm `EUR` vào ô chọn mà không vào hàm
// chuẩn hoá thì mọi báo giá EUR bị lượt chấm từ chối — đúng hình dạng khoản 244, chỉ khác chuỗi.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CURRENCIES } from "./procurement-policy.js";

const doc = (duong: string): string => readFileSync(new URL(duong, import.meta.url), "utf8");

describe("[S1.164 / khoản 244] tập đơn vị tiền đồng bộ", () => {
  it("CURRENCIES = CHECK của 057 = đích của bid_currency = các lựa chọn ở trang nộp thầu", () => {
    const tapTs = [...CURRENCIES].sort();

    const check = /currency\s+text\s+NOT NULL\s+CHECK\s*\(currency IN \(([^)]*)\)\)/u.exec(
      doc("../../../db/migrations/057_luot_danh_gia.sql"),
    );
    expect(check, "không tìm thấy CHECK tiền tệ của rfq_evaluations trong 057").not.toBeNull();
    const tapCheck = [...(check?.[1] ?? "").matchAll(/'([A-Z]{3})'/gu)].map((m) => m[1]).sort();

    const tapHam = [
      ...new Set([...doc("../../../db/migrations/070_bid_currency.sql").matchAll(/RETURN '([A-Z]{3})'/gu)].map((m) => m[1])),
    ].sort();

    const html = doc("../../../apps/web/trang/nop-thau.html");
    const chon = /<select id="tien-te">([\s\S]*?)<\/select>/u.exec(html);
    expect(chon, "ô tiền tệ của trang nộp thầu phải là một <select>, không phải ô gõ tự do").not.toBeNull();
    const tapTrang = [...(chon?.[1] ?? "").matchAll(/<option value="([^"]+)"/gu)].map((m) => m[1]).sort();

    expect(tapCheck).toEqual(tapTs);
    expect(tapHam).toEqual(tapTs);
    expect(tapTrang).toEqual(tapTs);
    // VND là lựa chọn mặc định: nhà cung cấp không phải chạm vào ô nào để báo giá bằng đồng.
    expect(chon?.[1]).toMatch(/<option value="VND" selected>/u);
  });
});
