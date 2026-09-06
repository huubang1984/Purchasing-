import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// =============================================================================================
// [INV-H14] BỘ DÒ ORACLE XUYÊN TỔ CHỨC QUA RÀNG BUỘC DUY NHẤT — LỚP CANH CỦA ADR-013
//
// VÌ SAO FILE NÀY TỒN TẠI, và lý do là hai phép đo có sẵn trong kho mã chứ không phải một linh
// cảm. Cả hai đo trên PostgreSQL 16.15, role đăng nhập thật `app_api_login`, RLS bật đầy đủ:
//
//   (1) `organizations.slug` UNIQUE toàn cục — 002 khối [CR3 — vòng fix 1]:
//         UPDATE ... SET slug='cong-ty-b'          -> ERROR: duplicate key
//         UPDATE ... SET slug='khong-ai-dung-slug' -> UPDATE 1
//       Hai thông báo khác nhau = MỘT ORACLE NHỊ PHÂN trên câu hỏi "đối thủ X có trên sàn không".
//   (2) `users_pkey` — 002 khối [vòng fix 2 — Minor]: cùng khuôn, khai thác thực tế ≈ 0 vì `id`
//       là 122 bit ngẫu nhiên, nhưng KHUÔN vẫn bị đóng.
//
// RLS KHÔNG che được lớp lỗi này, và đó là toàn bộ vấn đề: kiểm tra duy nhất chạy DƯỚI QUYỀN HỆ
// THỐNG trên TOÀN bảng, nên nó nhìn thấy hàng của mọi tổ chức trong khi `SELECT` của cùng phiên
// thì không. Mỗi ràng buộc duy nhất mới trên một bảng tenant là một lần rút thăm lại.
//
// ---------------------------------------------------------------------------------------------
// VỊ TỪ ĐÚNG KHÔNG PHẢI "MỌI UNIQUE PHẢI CÓ org_id ĐỨNG ĐẦU"
// ---------------------------------------------------------------------------------------------
// Cách viết hiển nhiên ấy ĐỎ OAN trên `users_pkey`, `suppliers_pkey`, `organizations_slug_key` —
// những ràng buộc mà 002 đã đóng BẰNG CÁCH KHÁC (thu hẹp quyền theo cột), và đóng đúng. Một lớp
// canh đỏ oan sẽ bị nới ra bằng một danh sách ngoại lệ, và danh sách ngoại lệ là đúng thứ đã hỏng
// ba lần ở S0 (khoản nợ 3, 16, 17).
//
// Vị từ được dùng ở đây suy từ CƠ CHẾ của chính cuộc tấn công:
//
//     MỘT RÀNG BUỘC DUY NHẤT CHỈ LÀM ORACLE ĐƯỢC KHI `app_api` GHI ĐƯỢC VÀO NÓ.
//
// Cụ thể, "ghi được" có hai đường và chỉ hai:
//   * INSERT: kẻ dò phải cung cấp GIÁ TRỊ cho MỌI cột khoá -> cần INSERT trên TẤT CẢ các cột đó;
//   * UPDATE: hàng đã có sẵn, kẻ dò chỉ cần đổi ĐỦ ĐỂ VA CHẠM -> cần UPDATE trên ÍT NHẤT MỘT cột.
// Ca (2) chính là ca `organizations.slug` đã đo. Ca (1) là ca `users (org_id, email)`.
//
// Ràng buộc nào GHI ĐƯỢC thì bắt buộc phải có `org_id` ở VỊ TRÍ CỘT ĐẦU TIÊN — khi đó mọi va
// chạm chỉ xảy ra trong phạm vi tổ chức của chính người gọi, và thông báo lỗi không nói gì về tổ
// chức khác.
//
// ---------------------------------------------------------------------------------------------
// PHẠM VI: `pg_index`, KHÔNG PHẢI `pg_constraint` — VÀ ĐÂY LÀ MỘT KHÁC BIỆT CÓ RĂNG
// ---------------------------------------------------------------------------------------------
// `CREATE UNIQUE INDEX` trần KHÔNG sinh hàng nào trong `pg_constraint`, nhưng nó cưỡng chế tính
// duy nhất y hệt và ném CÙNG MỘT lỗi `duplicate key`. Một bộ dò đọc `pg_constraint` sẽ MÙ với nó
// — và dự án ĐANG CÓ một chỉ mục như vậy: `outbox_jobs_dedupe_idx` (007). Đọc `pg_index` phủ trọn
// cả ba dạng: PRIMARY KEY, UNIQUE constraint, và unique index trần.
//
// `indnkeyatts` (không phải `indnatts`): cột `INCLUDE` không tham gia vào tính duy nhất nên không
// tham gia vào oracle. Hôm nay chưa có cột INCLUDE nào; đọc đúng trường ngay từ đầu rẻ hơn đi sửa
// một bộ dò đã xanh.
//
// `has_column_privilege` (không phải `information_schema`): hàm này tính CẢ quyền cấp ở MỨC BẢNG
// lẫn quyền cấp theo CỘT. 002 đã đo và ghi rằng quyền cột KHÔNG hiện ở `role_table_grants`; vế
// còn lại — quyền bảng có hiện đủ ở `role_column_grants` hay không — là một câu hỏi mà bộ dò này
// KHÔNG cần trả lời, vì nó không hỏi view nào cả.
//
// ---------------------------------------------------------------------------------------------
// LƯỢT ĐỘT BIẾN TRÊN MIGRATION THẬT — VÀ NÓ TÌM RA MỘT LỖI CỦA CHÍNH BỘ DÒ
// ---------------------------------------------------------------------------------------------
// Đo ngày 2026-08-29: sửa `UNIQUE (org_id, tax_code)` trong 008 thành `UNIQUE (tax_code)`.
//
//   LƯỢT ĐẦU -> ĐỎ, NHƯNG VÌ LÝ DO SAI: `TypeError: h.cac_cot.join is not a function`. Nguyên
//   nhân là một cái bẫy kiểu: `pg_attribute.attname` thuộc kiểu `name`, nên `array_agg` của nó
//   trả `name[]` (oid 1003) — node-pg KHÔNG có bộ phân tích cho oid đó và trả về NGUYÊN CHUỖI
//   `{org_id,tax_code}`. Bộ dò vẫn "đỏ", nhưng nó đỏ bằng một cú ném thay vì bằng một khẳng
//   định có tên, và ở một hình dạng khác (ví dụ chỉ có cột biểu thức) nó sẽ ném TRƯỚC khi kịp
//   phân loại. Đã sửa bằng `attname::text`.
//
//   LƯỢT SAU KHI SỬA -> ĐỎ ĐÚNG CHỖ, và thông điệp gọi tên chính xác thủ phạm:
//     "suppliers.suppliers_tax_code_key (tax_code) — app_api ghi được qua INSERT đủ mọi cột
//      + UPDATE ít nhất một cột"
//
// Bài học ghi ra vì nó vượt khỏi file này: MỘT LỚP CANH CHƯA CHẠY QUA MỘT LƯỢT ĐỎ THẬT THÌ CHƯA
// ĐƯỢC ĐO. Lượt xanh đầu tiên của bộ dò này KHÔNG hề chạm vào `moTa()`, nên khiếm khuyết trên
// nằm im ngay dưới một ô xanh.
// =============================================================================================

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/** Vai trò bị soi. Đây là role mà `api` chạy dưới — nơi một tiến trình web chạm tới CSDL. */
const VAI_TRO = "app_api";

const CAU_DO_ORACLE =
  "WITH bang_tenant AS ( " +
  "  SELECT c.oid AS bang_oid, c.relname AS bang " +
  "    FROM pg_class c " +
  "    JOIN pg_namespace n ON n.oid = c.relnamespace " +
  "   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') " +
  "     AND EXISTS (SELECT 1 FROM pg_attribute a " +
  "                  WHERE a.attrelid = c.oid AND a.attname = 'org_id' " +
  "                    AND a.attnum > 0 AND NOT a.attisdropped)), " +
  "chi_muc AS ( " +
  "  SELECT b.bang, b.bang_oid, ic.relname AS chi_muc, i.indkey, i.indnkeyatts " +
  "    FROM bang_tenant b " +
  "    JOIN pg_index i ON i.indrelid = b.bang_oid " +
  "    JOIN pg_class ic ON ic.oid = i.indexrelid " +
  "   WHERE i.indisunique), " +
  "cot AS ( " +
  "  SELECT m.bang, m.bang_oid, m.chi_muc, k.ord, k.attnum, a.attname::text AS attname " +
  "    FROM chi_muc m " +
  "    CROSS JOIN LATERAL unnest(m.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord) " +
  "    LEFT JOIN pg_attribute a " +
  "           ON a.attrelid = m.bang_oid AND a.attnum = k.attnum AND k.attnum <> 0 " +
  "   WHERE k.ord <= m.indnkeyatts) " +
  "SELECT bang, chi_muc, " +
  "       array_agg(coalesce(attname, '(bieu thuc)') ORDER BY ord) AS cac_cot, " +
  "       bool_or(attname IS NULL) AS co_bieu_thuc, " +
  "       bool_and(attname IS NOT NULL " +
  "                AND has_column_privilege($1, bang_oid, attname, 'INSERT')) AS insert_du_cot, " +
  "       bool_or(attname IS NOT NULL " +
  "               AND has_column_privilege($1, bang_oid, attname, 'UPDATE')) AS update_mot_cot, " +
  "       (array_agg(coalesce(attname, '(bieu thuc)') ORDER BY ord))[1]::text AS cot_dau " +
  "  FROM cot GROUP BY bang, chi_muc ORDER BY bang, chi_muc";

interface HangChiMuc {
  bang: string;
  chi_muc: string;
  cac_cot: string[];
  co_bieu_thuc: boolean;
  insert_du_cot: boolean;
  update_mot_cot: boolean;
  cot_dau: string;
}

/** Một chỉ mục duy nhất bị phân loại là ORACLE khi nó GHI ĐƯỢC và không dẫn đầu bằng `org_id`. */
function laOracle(h: HangChiMuc): boolean {
  const ghiDuoc = h.insert_du_cot || h.update_mot_cot;
  return ghiDuoc && h.cot_dau !== "org_id";
}

function moTa(h: HangChiMuc): string {
  const duong = [
    h.insert_du_cot ? "INSERT đủ mọi cột" : null,
    h.update_mot_cot ? "UPDATE ít nhất một cột" : null,
  ]
    .filter((x) => x !== null)
    .join(" + ");
  return `${h.bang}.${h.chi_muc} (${h.cac_cot.join(", ")}) — ${VAI_TRO} ghi được qua ${duong}`;
}

let db: TestDatabase;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("oracle xuyên tổ chức qua ràng buộc duy nhất", () => {
  it("[INV-H14] không chỉ mục duy nhất nào trên bảng tenant vừa GHI ĐƯỢC vừa thiếu org_id ở cột đầu", async () => {
    const { rows } = await db.pool.query<HangChiMuc>(CAU_DO_ORACLE, [VAI_TRO]);

    // Không bao giờ được rỗng ruột: một bộ dò không tìm thấy chỉ mục nào sẽ XANH VĨNH VIỄN, và
    // đó đúng là dạng bằng chứng giả mà evidence pack được dựng để loại. Ràng buộc (11) của dự
    // án: chỉ phân loại khi có DẤU HIỆU TÍCH CỰC rằng phép đo đã chạy.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((h) => h.bang)).toContain("suppliers");
    expect(rows.map((h) => h.bang)).toContain("supplier_contacts");

    // Một chỉ mục trên BIỂU THỨC không quy về được một cột nào, nên bộ dò KHÔNG phân loại nó —
    // và nó phải NÓI RA điều đó thay vì bỏ qua trong im lặng. Hôm nay chưa có cái nào; ngày có
    // cái đầu tiên, test này đỏ và người viết nó phải quyết định tại chỗ.
    const bieuThuc = rows.filter((h) => h.co_bieu_thuc);
    expect(
      bieuThuc.map(moTa),
      "Chỉ mục duy nhất trên BIỂU THỨC: bộ dò không quy được về cột nên không phân loại được. " +
        "Phải xem tay và mở rộng bộ dò, không được thêm vào một danh sách ngoại lệ.",
    ).toEqual([]);

    expect(
      rows.filter(laOracle).map(moTa),
      "ORACLE XUYÊN TỔ CHỨC (ADR-013): kiểm tra duy nhất chạy dưới quyền hệ thống trên TOÀN " +
        "bảng, nên thông báo lỗi trả lời được câu hỏi 'tổ chức khác có hàng này không'. Hai " +
        "cách đóng, và CHỈ hai: đưa `org_id` lên cột đầu tiên của ràng buộc, hoặc THU HẸP QUYỀN " +
        "THEO CỘT để app_api không ghi được vào nó (khuôn 002 với `slug` và `users_pkey`).",
    ).toEqual([]);
  });

  // ===========================================================================================
  // HAI BẢNG DÒ — BỘ DÒ TỰ CHỨNG MINH NÓ CÓ RĂNG, TRONG CÙNG MỘT LƯỢT CHẠY
  //
  // Một bộ dò luôn báo "sạch" thì vô dụng, và một bộ dò báo bừa thì sẽ bị nới bằng ngoại lệ. Hai
  // ca dưới đây đo CẢ HAI chiều trên một bảng thật, do chính test dựng lên rồi dọn đi — không
  // phải trên một chuỗi giả.
  // ===========================================================================================
  it("[INV-H14] bộ dò BẮT một UNIQUE toàn cục mà app_api ghi được — chiều dương", async () => {
    await db.pool.query(
      "CREATE TABLE do_oracle_duong (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), " +
        "org_id uuid NOT NULL, tax_code text, UNIQUE (tax_code))",
    );
    try {
      await db.pool.query("GRANT INSERT (org_id, tax_code) ON do_oracle_duong TO app_api");

      const { rows } = await db.pool.query<HangChiMuc>(CAU_DO_ORACLE, [VAI_TRO]);
      const bat = rows.filter(laOracle).map((h) => h.chi_muc);

      // Đây là hình dạng CHÍNH XÁC mà ADR-013 từ chối: `UNIQUE (tax_code)` toàn cục, ghi được.
      expect(bat).toContain("do_oracle_duong_tax_code_key");
    } finally {
      await db.pool.query("DROP TABLE do_oracle_duong");
    }
  });

  it("[INV-H14] bộ dò KHÔNG bắt cùng ràng buộc ấy khi app_api không ghi được — chiều âm", async () => {
    await db.pool.query(
      "CREATE TABLE do_oracle_am (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), " +
        "org_id uuid NOT NULL, tax_code text, UNIQUE (tax_code))",
    );
    try {
      // Chỉ SELECT. Đây là cách 002 đã đóng `organizations.slug`: giữ nguyên ràng buộc, cắt
      // quyền. Nếu bộ dò vẫn bắt ca này thì nó đỏ oan, và một lớp đỏ oan sẽ bị vô hiệu hoá bằng
      // danh sách ngoại lệ trong vòng một tuần.
      await db.pool.query("GRANT SELECT ON do_oracle_am TO app_api");

      const { rows } = await db.pool.query<HangChiMuc>(CAU_DO_ORACLE, [VAI_TRO]);
      const hang = rows.find((h) => h.chi_muc === "do_oracle_am_tax_code_key");

      // Dấu hiệu tích cực rằng bảng dò ĐÃ nằm trong phạm vi quét — không có nó, "không bị bắt"
      // cũng đúng với một bảng mà bộ dò không hề nhìn thấy.
      expect(hang, "bảng dò phải nằm trong phạm vi quét thì phép đo chiều âm mới có nghĩa").toBeDefined();
      expect(hang !== undefined && laOracle(hang)).toBe(false);
    } finally {
      await db.pool.query("DROP TABLE do_oracle_am");
    }
  });
});
