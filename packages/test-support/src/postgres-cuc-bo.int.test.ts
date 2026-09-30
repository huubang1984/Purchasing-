// ==============================================================================================
// [S1.9130 / khoản 9401] TIMEZONE MẶC ĐỊNH CỦA CỤM THỬ — `UTC` TRÊN CẢ HAI ĐƯỜNG CỦA `startPostgres()`
//
// `postgres:16-alpine` của CI dựng cụm với `TimeZone` = `UTC`; `initdb` của cụm cục bộ (S1.211) lấy múi giờ theo MÁY — `Etc/UTC`
// trên Ubuntu của phiên đám mây, và là múi giờ thật của máy người phát triển (`Asia/Ho_Chi_Minh`…) ở chỗ khác. Ca «ĐỌC TRƯỚC, DỌN
// SAU» của `packages/db/src/vai-tro.int.test.ts` (khoản 104) viết cứng `Etc/UTC`, xanh ở mọi lượt đo cục bộ của hai đợt trả nợ và đỏ
// ở lần đầu nhánh chạy T3 (PR #216, §S1.214 mục 9). `khoiDongCumCucBo` nay chạy `initdb` dưới `TZ=UTC`, nên `postgresql.conf` của
// cụm cục bộ mang `timezone = 'UTC'` như cụm của ảnh container.
//
// Ca dưới đi qua `startPostgres()`, không gọi thẳng `khoiDongCumCucBo`: nó đo CẢ HAI đường — trên CI nó ghim giá trị của container
// (mốc, đã thấy ở T3 của #216), trên máy không Docker nó đo cụm cục bộ — và không bị bỏ qua ở đường nào. Riêng đường cục bộ đo thêm
// NGUỒN của giá trị (`postgresql.conf`, không phải cờ dòng lệnh): đột biến "đổi `TZ=UTC` thành `-c timezone=UTC`" giữ nguyên giá
// trị nên SỐNG qua vế giá trị (đo, §S1.9130), và vế nguồn là thứ giết nó.
// ==============================================================================================
import { describe, expect, it } from "vitest";
import { cauHinhCumCucBo } from "./postgres-cuc-bo.js";
import { startPostgres } from "./postgres.js";

describe("[S1.9130 / khoản 9401] TimeZone mặc định của cụm thử", { timeout: 120_000 }, () => {
  it("SHOW TimeZone trên kết nối mới của cụm vừa dựng là 'UTC' — cùng giá trị với postgres:16-alpine, không phải múi giờ của máy", async () => {
    const db = await startPostgres();
    try {
      const { rows } = await db.pool.query<{ TimeZone: string }>("SHOW TimeZone");
      expect(rows[0]?.TimeZone, "cụm cục bộ phải khởi tạo dưới TZ=UTC như container (khoản 9401)").toBe("UTC");
      if (cauHinhCumCucBo() !== undefined) {
        // Đường cục bộ: giá trị đến từ `postgresql.conf` mà `initdb` ghi (nguồn `configuration file`), không từ một cờ dòng lệnh —
        // cơ chế đã chọn ở đầu `postgres-cuc-bo.ts`, vì cờ dòng lệnh đè `ALTER SYSTEM` còn ở container thì không (đo trên hai cụm tạm).
        const { rows: nguon } = await db.pool.query<{ source: string }>("SELECT source FROM pg_settings WHERE name = 'TimeZone'");
        expect(nguon[0]?.source, "cụm cục bộ: TimeZone phải đến từ postgresql.conf như container").toBe("configuration file");
      }
    } finally {
      await db.stop();
    }
  });
});
