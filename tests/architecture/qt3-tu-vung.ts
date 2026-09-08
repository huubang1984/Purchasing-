// ==============================================================================================
// [INV-H21] TỪ VỰNG CỦA QT3 — VÀ CẢ BA DANH SÁCH ĐỀU ĐƯỢC **ĐO**, KHÔNG ĐƯỢC TIN
//
// Tệp này KHÔNG phải test. Nó tồn tại vì ba danh sách dưới đây được HAI nơi đọc, và hai bản sao
// của một danh sách là đúng thứ ADR-029 đặt tên:
//
//   `qt3-ghim-schema.test.ts`   (T1) — bỏ qua những tên này khi đi tìm chỗ chưa ghim schema;
//   `qt3-ngu-phap.int.test.ts`  (T3) — hỏi PostgreSQL THẬT xem lời miễn ấy có đúng không.
//
// Review lượt 14 (H14-4) tìm ra vì sao vế "đo" phải phủ CẢ BA chứ không chỉ danh sách đầu: bản
// trước gộp mọi từ khoá vào một danh sách `TU_KHOA` **không được đo bằng gì cả**, và trong đó có
// `unnest`, `generate_series`, `left`, `right` — bốn HÀM THẬT của `pg_catalog`. Mã sản xuất thì
// GHIM `unnest` (`packages/db/src/vai-tro.ts:79` viết `pg_catalog.unnest(…)`) vì nó cướp được,
// trong khi lớp canh lại MIỄN nó vì tưởng nó là ngữ pháp. Hai phát biểu mâu thuẫn nhau, cách nhau
// vài trăm dòng, và cái sai là cái không được đo.
// ==============================================================================================

/**
 * CẤU TRÚC NGỮ PHÁP, không phải hàm — viết TRẦN là ĐÚNG, và viết `pg_catalog.<tên>` là SAI.
 *
 * `pg_catalog.coalesce(...)` ném 42883 — đã đo ở Task 8 vòng fix 2, và chú thích của
 * `packages/outbox/src/enqueue.ts` ghi nguyên văn phép đo ấy. Cùng lý do đó, chúng cũng KHÔNG
 * cướp được bằng `search_path`: bộ phân tích cú pháp nhận ra chúng TRƯỚC mọi phép phân giải tên.
 *
 * Bản đầu của danh sách này có thêm `extract`, `substring`, `overlay`, `position`, `normalize` —
 * chép theo trí nhớ về "SQL grammar". Phép đo `pg_proc` bác cả năm: cả năm CÓ hàm thật trong
 * `pg_catalog`, tức cả năm GHIM ĐƯỢC, tức cả năm PHẢI bị ghim.
 *
 * **[S1.24, review lượt 15] KẾT LUẬN VỪA RỒI ĐÚNG MỘT NỬA, VÀ NỬA THIẾU ĐÃ LÀM HỎNG HAI CÂU.**
 * `pg_proc` chứng minh **dạng LỜI GỌI HÀM** ghim được — `pg_catalog.extract('epoch', ts)` chạy.
 * Nó KHÔNG nói gì về **dạng NGỮ PHÁP** `EXTRACT(field FROM source)`, thứ được kích hoạt bởi chính
 * token từ khoá `EXTRACT` và đi qua một production riêng: `pg_catalog.extract(epoch FROM now())`
 * ném 42601. Vòng S1.24 ghim tự động theo kết luận nửa vời ấy và làm hỏng hai câu bucket hạn mức
 * OTP; khuôn đúng đã nằm sẵn trong kho từ migration `039` — `pg_catalog.date_part('epoch', …)`.
 *
 * Nên với năm tên này, câu đúng là: **hàm thì ghim được, ngữ pháp thì không — và một cái tên có
 * thể là CẢ HAI.** Thứ phân xử không phải `pg_proc` mà là một lượt `PREPARE` trên chính câu ấy:
 * `tests/architecture/qt3-cu-phap.int.test.ts`.
 */
export const NGU_PHAP_KHONG_GHIM: readonly string[] = [
  "coalesce",
  "nullif",
  "greatest",
  "least",
  "cast",
  "trim",
  "collation",
  "grouping",
  "xmlelement",
];

/**
 * Từ khoá SQL đứng ngay trước `(` mà KHÔNG phải một lời gọi hàm — `VALUES (…)`, `IN (…)`,
 * `EXISTS (…)`, `OVER (…)`…
 *
 * ĐIỀU KIỆN để một tên được nằm ở đây, và `qt3-ngu-phap.int.test.ts` cưỡng chế cả hai: nó phải là
 * một TỪ KHOÁ của PostgreSQL (`pg_get_keywords()`) **và** không có hàm nào cùng tên trong
 * `pg_catalog`. Vế thứ hai là vế đóng H14-4.
 */
export const TU_KHOA_TRUOC_NGOAC: readonly string[] = [
  "and", "or", "not", "on", "using", "where", "select", "from", "join", "by", "set", "returning",
  "do", "update", "insert", "into", "delete", "with", "as", "when", "then", "else", "end", "order",
  "group", "limit", "offset", "having", "distinct", "union", "except", "intersect", "for", "of",
  "check", "if", "values", "row", "exists", "in", "any", "all", "some", "array", "over", "filter",
  "within", "lateral", "only", "key", "operator",
];

/**
 * Từ khoá đứng sau `FROM` / `JOIN` / `INTO` / `UPDATE` / `USING` mà KHÔNG phải một tên bảng —
 * `FROM ONLY t`, `JOIN LATERAL (…)`, `FOR UPDATE SKIP LOCKED`, `INSERT INTO … SELECT`…
 *
 * Chúng phải là TỪ KHOÁ thật (`pg_get_keywords()`); ở vị trí này một tên trùng với một hàm là
 * chuyện bình thường (`FROM generate_series(…)`), nên vế `pg_proc` KHÔNG áp ở đây — và vị từ
 * `RE_BANG` cũng đã loại mọi tên có `(` theo sau.
 */
export const TU_KHOA_SAU_FROM: readonly string[] = [
  "only", "lateral", "select", "set", "skip", "locked", "nowait", "share", "values", "left",
  "right", "inner", "outer", "full", "cross", "natural", "join", "on", "using", "where", "update",
  "all", "distinct", "as",
];
