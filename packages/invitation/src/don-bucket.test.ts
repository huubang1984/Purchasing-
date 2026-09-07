import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OTP_RATE_WINDOW_SECONDS } from "./invitation.js";

// =============================================================================================
// [sổ nợ 57 / 044] SÀN DỌN CỦA `otp_rate_limits` — MỘT CON SỐ, BA CHỖ, KHÔNG ĐƯỢC LỆCH
//
// Policy `otp_rate_limits_don_cua_so_cu` cho phép xoá hàng cũ hơn một SÀN viết cứng trong SQL
// (`make_interval(secs => 1800)`). Sàn ấy tồn tại vì bộ dọn chạy trên kết nối chưa gắn tổ chức,
// tức nó KHÔNG kiểm được gì về nghiệp vụ — thứ duy nhất bảo vệ cửa sổ đang đếm là con số ấy.
//
// Quan hệ phải giữ: SÀN ≥ MỘT CỬA SỔ. Nếu cửa sổ mai sau dài hơn sàn thì có một khoảng thời gian
// mà hàng vừa quá sàn nhưng cửa sổ của nó CÒN SỐNG — và bộ dọn xoá mất một trần đang có hiệu lực,
// tức mở lại đúng đường mà hạn mức OTP tồn tại để đóng. Không lớp nào ở CSDL nói được điều đó
// (nó không biết `OTP_RATE_WINDOW_SECONDS`), nên lớp nói là test này.
//
// Ba chỗ phải khớp, và đó KHÔNG phải sự thừa thãi: SQL của `044` là nơi sàn có hiệu lực; bản ghim
// trong `hardening.always.sql` là nơi nó được KHÔI PHỤC nếu ai đó sửa policy trên cụm — hai bản
// lệch nhau nghĩa là `migrate()` lặng lẽ dựng lại một sàn khác với sàn đã review.
// =============================================================================================

const THU_MUC_MIGRATION = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const doc = (ten: string): string => readFileSync(`${THU_MUC_MIGRATION}/${ten}`, "utf8");

describe("[sổ nợ 57] sàn dọn của otp_rate_limits", () => {
  it("sàn trong 044 và sàn trong bản ghim hardening là CÙNG một số", () => {
    const trong044 = /make_interval\(secs => (\d+)\)/.exec(doc("044_don_bucket_otp.sql"));
    expect(trong044, "không tìm thấy sàn trong 044_don_bucket_otp.sql").not.toBeNull();

    // Bản ghim là chuỗi hậu điều kiện `$than57$…$than57$` — chính chuỗi mà `pg_get_expr` phải trả
    // về. Nó viết sàn theo cách PostgreSQL deparse: `make_interval(secs => (1800)::double precision)`.
    const hardening = doc("hardening.always.sql");
    const trongGhim = /\$than57\$[\s\S]*?make_interval\(secs => \((\d+)\)::double precision\)[\s\S]*?\$than57\$/.exec(
      hardening,
    );
    expect(trongGhim, "không tìm thấy sàn trong bản ghim hardening").not.toBeNull();
    // Và câu SỬA của cùng mục ấy (câu dựng lại policy) phải mang đúng số đó, không chỉ câu phán xét.
    const trongCauSua = /pg_catalog\.make_interval\(secs => (\d+)\)/.exec(hardening);
    expect(trongCauSua, "không tìm thấy sàn trong câu sửa của hardening").not.toBeNull();

    expect(trongGhim![1]).toBe(trong044![1]);
    expect(trongCauSua![1]).toBe(trong044![1]);
  });

  it("sàn KHÔNG NGẮN HƠN một cửa sổ đếm — nếu không, bộ dọn xoá được một trần đang sống", () => {
    const san = Number(/make_interval\(secs => (\d+)\)/.exec(doc("044_don_bucket_otp.sql"))![1]);
    expect(san).toBeGreaterThan(0);
    expect(
      OTP_RATE_WINDOW_SECONDS,
      `OTP_RATE_WINDOW_SECONDS = ${OTP_RATE_WINDOW_SECONDS} > sàn ${san}: một hàng quá sàn mà cửa ` +
        "sổ còn sống sẽ bị bộ dọn xoá. Sửa sàn trong 044 VÀ trong bản ghim hardening, hoặc rút cửa sổ.",
    ).toBeLessThanOrEqual(san);
  });

  it("mốc mặc định của bộ dọn (hai cửa sổ) không NGẮN HƠN sàn — nếu ngắn hơn, `soCuaSo` là hình thức", () => {
    const san = Number(/make_interval\(secs => (\d+)\)/.exec(doc("044_don_bucket_otp.sql"))![1]);
    // Đây KHÔNG phải một vế an toàn — hai mốc AND với nhau nên vế ngắn hơn luôn bị vế dài hơn
    // nuốt, và cả hai chiều đều fail-closed. Nó là một vế TRUNG THỰC: nếu mốc mặc định chui xuống
    // dưới sàn thì `soCuaSo` không còn điều khiển gì cả, và ai đọc mã sẽ tin ngược lại.
    expect(OTP_RATE_WINDOW_SECONDS * 2).toBeGreaterThanOrEqual(san);
  });
});
