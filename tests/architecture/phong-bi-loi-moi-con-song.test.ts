// ==============================================================================================
// [S1.217 / khoản 250 / ADR-128] PHONG BÌ CỦA LỜI MỜI ĐÃ THU HỒI KHÔNG DỰ THẦU — BA BỘ ĐỌC, MỘT VẾ
//
// Thu hồi lời mời từ S1.217 LOẠI báo giá của lời mời ấy khỏi lượt mở thầu, bảng so sánh và lượt chấm.
// Ba bộ đọc chọn phong bì/bản rõ — worker mở thầu (`apps/unseal-worker/src/index.ts`), hai câu của
// `buildComparisonTable` (`packages/unseal/src/comparison.ts`) và `docBaoGia` (`packages/danh-gia/src/
// luot-danh-gia.ts`) — đã chia một luật từ §S1.108 mục 7d: *một hàng cho một luồng báo giá, phiên bản
// lớn nhất* (`DISTINCT ON (v.bid_id)` hay `PARTITION BY v.bid_id`). Vòng này thêm luật thứ hai, cùng ba
// chỗ: *chỉ luồng của lời mời CÒN SỐNG* — vế `i.revoked_at IS NULL` trên `rfq_invitations i`.
//
// VÌ SAO LÀ MỘT CỔNG TĨNH CHỨ KHÔNG MỘT NGUỒN DÙNG CHUNG: không gói nào đứng dưới cả ba mà mang nghĩa
// ấy — `packages/unseal` và `packages/danh-gia` chỉ phụ thuộc `audit` và `identity`; thêm một phụ thuộc
// workspace là chạm `pnpm-lock.yaml`; một hằng TypeScript nội suy vào câu SQL thì bộ đọc QT3 giữ chỗ
// `${…}` và không đọc vào trong (`qt3-doc-sql.ts`), tức mọi lớp canh SQL mù ở đúng vế ấy; một hàm hay
// view SQL là một migration mà lô không có. Nên ba mảnh CHÉP NGUYÊN VĂN, và lớp này đòi chúng bằng nhau.
//
// PHÁT BIỂU ĐÚNG MỨC: phép đọc theo văn bản câu SQL sản xuất (bộ đọc của QT3 — `moiCauSql`). Một câu
// chọn phong bì theo luồng là câu vừa nối `public.rfq_invitations i` vừa khử trùng theo `v.bid_id`;
// câu đọc `rfq_evaluation_lines` (bảng xếp hạng, bộ bằng chứng), câu kiểm bản mã đã lưu
// (`auditStoredCiphertexts`) và `countReceivedBids` KHÔNG khử trùng theo luồng nên đứng ngoài — hai
// câu đầu đọc thứ lượt chấm ĐÃ ghi, câu ba là kiểm toán mọi phong bì đã lưu, câu cuối là khoản 271.
// Một bộ đọc thứ tư chọn phong bì theo luồng mà bỏ vế ⇒ đỏ ở đây; một bộ đọc dùng bí danh khác `i`
// hay `v` thì lớp này mù — nói ra.
// ==============================================================================================
import { describe, expect, it } from "vitest";
import { moiCauSql, type CauSql } from "./qt3-doc-sql.js";

/** Vế lọc dùng chung — ba tệp chép NGUYÊN VĂN, lớp này đòi bằng nhau. */
const VE_LOI_MOI_CON_SONG = "i.revoked_at IS NULL";

/** Câu nối bảng lời mời dưới bí danh `i`. */
const NOI_LOI_MOI = /\bJOIN\s+public\.rfq_invitations\s+i\b/u;
/** Câu khử trùng theo luồng báo giá — luật §S1.108 mục 7d mà ba bộ đọc chia nhau. */
const KHU_TRUNG_THEO_LUONG = /DISTINCT ON \(v\.bid_id\)|PARTITION BY v\.bid_id\b/u;
const VE = /\bi\.revoked_at IS NULL\b/gu;

/** Câu CHỌN PHONG BÌ/BẢN RÕ THEO LUỒNG: nối lời mời VÀ khử trùng theo `v.bid_id`. */
function laCauChonPhongBi(sql: string): boolean {
  return NOI_LOI_MOI.test(sql) && KHU_TRUNG_THEO_LUONG.test(sql);
}

function soVe(sql: string): number {
  return sql.match(VE)?.length ?? 0;
}

/** Số câu chọn phong bì theo TỆP — đối chứng dương của lớp. */
function theoTep(cau: readonly CauSql[]): Record<string, number> {
  const ra: Record<string, number> = {};
  for (const c of cau) ra[c.tep] = (ra[c.tep] ?? 0) + 1;
  return ra;
}

describe("[S1.217 / khoản 250] phong bì của lời mời đã thu hồi không dự thầu — ba bộ đọc, một vế", () => {
  const chonPhongBi = moiCauSql().filter((c) => laCauChonPhongBi(c.sql));

  it("mọi câu SQL sản xuất chọn phong bì/bản rõ theo luồng và nối `rfq_invitations i` mang ĐÚNG MỘT vế `i.revoked_at IS NULL`", () => {
    const sai = chonPhongBi.filter((c) => soVe(c.sql) !== 1).map((c) => `${c.tep}:${String(c.dong)} (${String(soVe(c.sql))} vế)`);
    expect(sai, `câu chọn phong bì thiếu (hay lặp) vế \`AND ${VE_LOI_MOI_CON_SONG}\` — ba bộ đọc, một luật`).toEqual([]);
  });

  it("ĐỐI CHỨNG DƯƠNG: đúng BỐN câu ở đúng BA tệp — worker 1, bảng so sánh 2 (câu hàng, câu tổng hợp), lượt chấm 1", () => {
    // Nếu con số này đổi, câu hỏi là *bộ đọc mới có mang vế không* — phép kiểm trên đã trả lời; và một
    // bộ đọc biến mất khỏi danh sách là một câu chọn phong bì đã đổi hình dạng tới mức lớp này không
    // còn thấy nó — cũng phải đỏ.
    expect(theoTep(chonPhongBi)).toEqual({
      "apps/unseal-worker/src/index.ts": 1,
      "packages/danh-gia/src/luot-danh-gia.ts": 1,
      "packages/unseal/src/comparison.ts": 2,
    });
  });

  it("bộ đếm tự kiểm: câu chọn phong bì thiếu vế bị đếm, câu có vế thì không, câu không khử trùng theo luồng đứng ngoài", () => {
    const thieu = "SELECT DISTINCT ON (v.bid_id) v.id FROM public.vendor_bid_versions v JOIN public.rfq_invitations i ON i.id = b.invitation_id WHERE i.rfq_id = $1";
    const du = `${thieu} AND ${VE_LOI_MOI_CON_SONG}`;
    const lap = `${du} AND ${VE_LOI_MOI_CON_SONG}`;
    const cuaSo = `SELECT row_number() OVER (PARTITION BY v.bid_id ORDER BY v.version DESC) FROM public.rfq_unsealed_bids u JOIN public.rfq_invitations i ON i.id = b.invitation_id WHERE ${VE_LOI_MOI_CON_SONG}`;
    const ngoai = "SELECT count(*) FROM public.vendor_bids b JOIN public.rfq_invitations i ON i.id = b.invitation_id WHERE i.rfq_id = $1";
    expect([laCauChonPhongBi(thieu), soVe(thieu)]).toEqual([true, 0]);
    expect([laCauChonPhongBi(du), soVe(du)]).toEqual([true, 1]);
    expect([laCauChonPhongBi(lap), soVe(lap)]).toEqual([true, 2]);
    expect([laCauChonPhongBi(cuaSo), soVe(cuaSo)]).toEqual([true, 1]);
    expect(laCauChonPhongBi(ngoai)).toBe(false);
  });
});
