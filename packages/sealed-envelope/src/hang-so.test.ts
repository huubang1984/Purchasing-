// ==============================================================================================
// HAI HẰNG SỐ ĐƯỢC CHÉP RA BA NƠI — VÀ BA NƠI ẤY PHẢI KHỚP NHAU BẰNG MỘT PHÉP ĐO
//
// Dự án đã lập tiền lệ này ở S1.2 với `RFQ_TRANSITIONS`: một bảng dữ liệu tồn tại ở CẢ TypeScript
// LẪN SQL thì phải có một test đọc thẳng file SQL và đòi hai bên khớp — nếu không, hai bản chép
// sẽ trôi khỏi nhau, và bản trôi sẽ là bản không ai chạy.
//
// Ở S1.4 có HAI cặp như thế, và cặp thứ hai là cặp đáng ngại hơn nhiều:
//
//   (1) THUẬT TOÁN MẶC ĐỊNH — `DEFAULT_KEY_AGREEMENT_ALGORITHM` (TS) và
//       `public.rfq_thuat_toan_mac_dinh()` (SQL, migration 017). Bản có thẩm quyền là bản SQL:
//       trigger `rfq_packages_kiem_khoa_khi_mo` đọc nó, và trigger canh MỌI đường.
//
//   (2) TẬP MÃ THUẬT TOÁN — `KEY_AGREEMENT_ALGORITHMS` (TS), ràng buộc `CHECK (algorithm IN ...)`
//       (SQL), và **máy dò `tools/do-webcrypto/index.html`**. Nơi thứ ba mới là nơi từng đứt:
//       máy dò gắn nhãn `"ECDH P-256"` cho người đọc, còn hệ thống so khớp `"ECDH_P256"`. Hai
//       chuỗi ấy KHÔNG bằng nhau, nên mục 2 của ADR-011 — *chọn thuật toán là một phép ĐO LÚC
//       CHẠY* — từng là một câu **chưa có dây nối**: máy dò in ra một trang cho người đọc và
//       không gì đi tiếp. Test dưới đây là thứ giữ cho dây ấy còn nối.
//
// GIỚI HẠN, ghi ra thay vì để người đọc sau tự phát hiện: các phép kiểm dưới đây đi theo MỘT
// CHIỀU — mọi mã trong gói phải xuất hiện ở SQL và ở máy dò. Chiều ngược lại (một mã lạ chỉ có
// trong SQL) được `CHECK` của Postgres chặn ở tầng dữ liệu; còn một nhãn lạ trong máy dò thì
// KHÔNG lớp nào bắt, vì máy dò là HTML và không có bộ phân tích nào ở đây đọc nó thành cây.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEY_AGREEMENT_ALGORITHMS } from "./index.js";
import { DEFAULT_KEY_AGREEMENT_ALGORITHM } from "./key-material.js";

const SQL_017 = readFileSync(
  fileURLToPath(new URL("../../../db/migrations/017_rfq_key_material.sql", import.meta.url)),
  "utf8",
);
const MAY_DO = readFileSync(
  fileURLToPath(new URL("../../../tools/do-webcrypto/index.html", import.meta.url)),
  "utf8",
);

describe("hằng số của S1.4 khớp giữa TypeScript, SQL và máy dò", () => {
  it("chống rỗng ruột: đọc được cả hai file và chúng không rỗng", () => {
    expect(SQL_017.length).toBeGreaterThan(1000);
    expect(MAY_DO.length).toBeGreaterThan(1000);
    expect(KEY_AGREEMENT_ALGORITHMS.length).toBeGreaterThan(1);
  });

  it("[INV-C5] thuật toán mặc định của gói khớp `public.rfq_thuat_toan_mac_dinh()` trong 017", () => {
    const khop = /rfq_thuat_toan_mac_dinh\(\)[\s\S]*?SELECT '([A-Z0-9_]+)'::text/.exec(SQL_017);
    expect(khop, "không đọc được hằng thuật toán mặc định từ migration 017").not.toBeNull();
    expect(khop?.[1]).toBe(DEFAULT_KEY_AGREEMENT_ALGORITHM);
  });

  it("[INV-C5] thuật toán mặc định nằm trong tập mã hợp lệ — hai hằng không được rời nhau", () => {
    // Không có vế này, hai hằng ở trên khớp nhau mà cùng sai: một `DEFAULT` trỏ tới một mã mà
    // `CHECK` của bảng từ chối sẽ làm MỌI lần mở RFQ hỏng, và test trên vẫn xanh.
    expect(KEY_AGREEMENT_ALGORITHMS).toContain(DEFAULT_KEY_AGREEMENT_ALGORITHM);
  });

  it("mọi mã thuật toán của gói có mặt trong ràng buộc CHECK của `rfq_key_material`", () => {
    const khop = /algorithm\s+text NOT NULL CHECK \(algorithm IN \(([^)]*)\)\)/.exec(SQL_017);
    expect(khop, "không đọc được ràng buộc CHECK của cột algorithm").not.toBeNull();
    const trongSql = (khop?.[1] ?? "")
      .split(",")
      .map((x) => x.trim().replace(/^'|'$/g, ""))
      .filter((x) => x.length > 0)
      .sort();
    expect(trongSql).toEqual([...KEY_AGREEMENT_ALGORITHMS].sort());
  });

  it("[ADR-011 mục 2] máy dò WebCrypto phát ra ĐÚNG các mã chính tắc, không phát nhãn người đọc", () => {
    // Đây là phép kiểm giữ cho "chọn thuật toán là một phép ĐO LÚC CHẠY" còn là một dây nối chứ
    // không quay lại thành một câu. Thêm một thuật toán vào gói mà quên sửa máy dò là ĐỎ ở đây.
    for (const ma of KEY_AGREEMENT_ALGORITHMS) {
      expect(MAY_DO, `máy dò không phát mã chính tắc "${ma}"`).toContain(`"${ma}"`);
    }
    // Và nó phải phát chúng qua MỘT CỬA CÓ TÊN, không phải nằm rải rác trong văn bản.
    expect(MAY_DO).toContain("window.trustprocureKeyAgreementSupport");
  });

  it("đối chứng âm: phép kiểm trên biết ĐỎ với một mã không tồn tại", () => {
    // Nếu `toContain` được gọi trên một chuỗi luôn khớp (vd. vì `MAY_DO` rỗng hay vì biểu thức
    // sai), vòng lặp trên là trang trí. Vế này chứng minh nó biết phân biệt.
    expect(MAY_DO).not.toContain('"MOT_THUAT_TOAN_KHONG_TON_TAI"');
    expect(SQL_017).not.toContain("'MOT_THUAT_TOAN_KHONG_TON_TAI'");
  });
});
