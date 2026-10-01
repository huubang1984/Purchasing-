// ==============================================================================================
// [S1.251 / S4.4b] BỘ QUÉT GIÁ DẠNG RÕ TRÊN MỌI QUAN HỆ — một bản, bốn người gọi (spec S4 §2.1, §2.5 ⒅; ADR-054; ADR-140).
//
// Trước vòng này bốn tệp chép cùng một vòng lặp — kịch bản 41 qua HTTP và không qua HTTP, `unseal-worker.int`, `luot-danh-gia.int`
// — và cả bốn chỉ đọc `relkind IN ('r', 'p')`. Một view hay materialized view chứa giá dạng rõ đi qua cả bốn mà không dòng nào
// đỏ. Mục (C) `CAU_DOC_VONG` của `hardening.always.sql` đã từ chối mọi materialized view ngoài danh sách lúc `migrate()`; chỗ hở
// còn lại là một đối tượng dựng LÚC CHẠY, ngoài migration — đúng thứ bộ quét sau một kịch bản nhìn thấy. Đo trên `f0e7eef`:
// schema `public` có 58 bảng `r`, 0 `p`, 0 `v`, 0 `m` — nới tập không lật một kết quả nào hôm nay; nó đóng chỗ hở cho ngày mai.
//
// `db/unique-oracle.int.test.ts` cũng đọc `relkind IN ('r', 'p')` nhưng KHÔNG phải bộ quét giá: nó dò oracle qua chỉ mục duy
// nhất (H14) — view không có chỉ mục, materialized view thì `app_api` không ghi được. Spec §2.1 đếm nó là bộ thứ năm; chủ dự án
// chốt 2026-10-01 để nguyên nó.
//
// PHẠM VI: schema `public` — như bốn bản chép trước. Quan hệ ở schema khác không được quét (hôm nay không có quan hệ nào ngoài
// `public`, cùng phép đo); nói ra ở biên bản §S1.251. Phép quét là `t::text LIKE '%kim%'` dưới vai người gọi pool — mọi người
// gọi dùng pool CHỦ CỤM, tức đúng vế *"kể cả bằng role quản trị"* của A3, và view chạy dưới quyền chủ cụm. Một materialized view
// chưa nạp (`WITH NO DATA`) làm câu quét NÉM: đỏ, không lặng lẽ bỏ qua.
// ==============================================================================================
import type pg from "pg";

/** Bốn loại quan hệ chứa được hàng: bảng, bảng cha phân mảnh, view, materialized view. */
export const RELKIND_QUET_GIA: readonly string[] = ["r", "p", "v", "m"];

export interface KetQuaQuetGia {
  /** Quan hệ có ít nhất một hàng chứa kim, xếp theo tên. */
  readonly dinh: readonly string[];
  /** Số quan hệ đã quét — người gọi đòi nó lớn hơn một sàn, chống rỗng ruột. */
  readonly soQuanHe: number;
}

/**
 * Quét MỌI quan hệ của schema `public` tìm một chuỗi đã biết trong văn bản của cả hàng.
 *
 * MỘT câu, tên quan hệ dựng PHÍA MÁY CHỦ (`format('%I')` trong `query_to_xml`), không nội suy ở TypeScript: gói này nằm trong tầm
 * của hai cổng QT3 (`qt3-ghim-schema`, `qt3-cu-phap` — mọi tệp `src/` không phải test), và cổng `PREPARE` thay mỗi chỗ nội suy bằng
 * một số nguyên — `FROM public.${ten}` thành `FROM public.1`, hỏng cú pháp. Cùng ngữ nghĩa với bốn bản chép cũ: `LIKE` trên
 * `t::text`, dưới vai của pool người gọi.
 */
export async function quetGiaMoiQuanHe(pool: pg.Pool, kim: string): Promise<KetQuaQuetGia> {
  if (kim.length < 6) throw new Error("kim quá ngắn — một chuỗi ngắn trùng ngẫu nhiên với UUID, băm hay thời điểm");
  const { rows } = await pool.query<{ ten: string; co: boolean }>(
    "SELECT c.relname AS ten, " +
      "pg_catalog.query_to_xml(pg_catalog.format('SELECT 1 AS co FROM public.%I t WHERE t::pg_catalog.text LIKE %L LIMIT 1', " +
      "c.relname, '%' OPERATOR(pg_catalog.||) $2::pg_catalog.text OPERATOR(pg_catalog.||) '%'), false, true, '')::pg_catalog.text " +
      "OPERATOR(pg_catalog.<>) '' AS co " +
      "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace " +
      "WHERE n.nspname OPERATOR(pg_catalog.=) 'public' AND c.relkind OPERATOR(pg_catalog.=) ANY ($1::pg_catalog.\"char\"[]) " +
      "ORDER BY c.relname",
    [RELKIND_QUET_GIA, kim],
  );
  return { dinh: rows.filter((r) => r.co).map((r) => r.ten), soQuanHe: rows.length };
}
