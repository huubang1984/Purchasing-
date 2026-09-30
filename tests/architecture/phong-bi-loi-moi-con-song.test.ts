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
// câu đọc `rfq_evaluation_lines` (bảng xếp hạng, bộ bằng chứng)~~, câu kiểm bản mã đã lưu
// (`auditStoredCiphertexts`) và `countReceivedBids` KHÔNG khử trùng theo luồng nên đứng ngoài — hai
// câu đầu đọc thứ lượt chấm ĐÃ ghi, câu ba là kiểm toán mọi phong bì đã lưu, câu cuối là khoản 271.~~
// **[S1.9135 / khoản 271]** và câu kiểm bản mã đã lưu (`auditStoredCiphertexts`) KHÔNG khử trùng theo
// luồng nên đứng ngoài — hai câu đầu đọc thứ lượt chấm ĐÃ ghi, câu ba là kiểm toán mọi phong bì đã lưu.
// `countReceivedBids` nay đứng TRONG, qua tiêu chí hình dạng thứ hai ở khối cuối tệp (câu ĐẾM luồng).
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

// ==============================================================================================
// [S1.9135 / khoản 271] CÂU ĐẾM LUỒNG BÁO GIÁ CŨNG MANG VẾ — SỐ BÁO GIÁ LÀ SỐ SẼ DỰ THẦU
//
// Chủ dự án chốt ngày 2026-09-30 (kế hoạch đợt 3, câu 7): con số của `countReceivedBids` là số báo giá
// SẼ DỰ THẦU, không phải số đã nhận — khớp ADR-128 (thu hồi là loại). Câu đếm (`FROM public.vendor_bids b
// JOIN public.rfq_invitations i … count(*)`) KHÔNG khử trùng theo `v.bid_id`: nó không đọc phiên bản nào,
// và `vendor_bids` vốn là một hàng mỗi luồng (`018`) — nên tiêu chí ở khối trên KHÔNG thấy nó (chính văn
// bản `ngoai` của ca tự kiểm trên là câu ấy). Tiêu chí thứ hai, theo HÌNH DẠNG chứ không theo danh sách
// tệp: câu đọc `public.vendor_bids b` VÀ `public.rfq_invitations i` (sau `FROM` hay `JOIN`, thứ tự nào
// cũng được) VÀ gọi `count(`. Mọi câu như thế mang đúng MỘT vế `i.revoked_at IS NULL` — cùng luật.
//
// PHÁT BIỂU ĐÚNG MỨC: cùng bộ đọc, cùng điểm mù bí danh đã nói ở khối đầu (`b`, `i` khác tên ⇒ mù); và một
// hệ quả có chủ đích: một câu đếm luồng mai sau CỐ Ý kể cả luồng đã thu hồi (một phép đếm kiểm toán) sẽ
// đỏ ở đây — nó phải nói ra vì sao, không được lặng lẽ đếm theo nghĩa cũ. Hôm nay tiêu chí thấy HAI câu:
// câu của `countReceivedBids`, và câu tổng hợp của bảng so sánh (`count(*)` trên CTE `moi_nhat`) vốn đã
// thuộc tiêu chí trên — một câu thuộc cả hai vẫn chỉ phải mang MỘT vế.
// ==============================================================================================
/** Câu đọc bảng luồng báo giá dưới bí danh `b`. */
const DOC_LUONG_BAO_GIA = /\b(?:FROM|JOIN)\s+public\.vendor_bids\s+b\b/u;
/** Câu đọc bảng lời mời dưới bí danh `i` — sau `FROM` hay `JOIN`: câu đếm bắt đầu từ bảng nào cũng được. */
const DOC_LOI_MOI = /\b(?:FROM|JOIN)\s+public\.rfq_invitations\s+i\b/u;
const GOI_DEM = /\bcount\s*\(/u;

/** Câu ĐẾM LUỒNG BÁO GIÁ theo lời mời: đọc `vendor_bids b` và `rfq_invitations i`, và đếm. */
function laCauDemLuong(sql: string): boolean {
  return DOC_LUONG_BAO_GIA.test(sql) && DOC_LOI_MOI.test(sql) && GOI_DEM.test(sql);
}

/** Vi phạm luật "đúng MỘT vế" trên một tập câu — rỗng là xanh. Cùng một hàm cho mã sản xuất và cho văn bản mẫu. */
function viPhamMotVe(cau: readonly CauSql[]): readonly string[] {
  return cau.filter((c) => soVe(c.sql) !== 1).map((c) => `${c.tep}:${String(c.dong)} (${String(soVe(c.sql))} vế)`);
}

describe("[S1.9135 / khoản 271] câu ĐẾM luồng báo giá qua lời mời cũng mang đúng một vế — số báo giá là số sẽ dự thầu", () => {
  const demLuong = moiCauSql().filter((c) => laCauDemLuong(c.sql));

  it("mọi câu SQL sản xuất đọc `vendor_bids b` và `rfq_invitations i` rồi ĐẾM mang ĐÚNG MỘT vế `i.revoked_at IS NULL`", () => {
    expect(
      viPhamMotVe(demLuong),
      `câu đếm luồng báo giá thiếu (hay lặp) vế \`AND ${VE_LOI_MOI_CON_SONG}\` — số báo giá là số SẼ DỰ THẦU (câu 7, ADR-128)`,
    ).toEqual([]);
  });

  it("ĐỐI CHỨNG DƯƠNG: tiêu chí thấy đúng HAI câu ở `comparison.ts`, và đúng MỘT câu ngoài tiêu chí khử trùng — câu của `countReceivedBids`", () => {
    // Một câu đếm biến mất khỏi danh sách là một câu đã đổi hình dạng tới mức tiêu chí không còn thấy nó — cũng phải đỏ.
    expect(theoTep(demLuong)).toEqual({ "packages/unseal/src/comparison.ts": 2 });
    const chiDem = demLuong.filter((c) => !laCauChonPhongBi(c.sql));
    expect(chiDem.map((c) => c.tep)).toEqual(["packages/unseal/src/comparison.ts"]);
    expect(chiDem[0]?.sql, "câu ngoài tiêu chí khử trùng phải là câu đếm `vendor_bids` của `countReceivedBids`").toMatch(
      /^\s*SELECT pg_catalog\.count\(\*\)::pg_catalog\.int4 AS n\s+FROM public\.vendor_bids b\b/u,
    );
  });

  it("văn bản mẫu: câu đếm THIẾU vế ⇒ vi phạm (đỏ), có vế ⇒ không, lặp ⇒ vi phạm; thứ tự FROM/JOIN đảo vẫn bị thấy; câu không đếm, hay đếm thứ khác, đứng ngoài", () => {
    const thieu = "SELECT count(*) FROM public.vendor_bids b JOIN public.rfq_invitations i ON i.id = b.invitation_id WHERE i.rfq_id = $1";
    const du = `${thieu} AND ${VE_LOI_MOI_CON_SONG}`;
    const lap = `${du} AND ${VE_LOI_MOI_CON_SONG}`;
    const daoThuTu = "SELECT pg_catalog.count(*) FROM public.rfq_invitations i JOIN public.vendor_bids b ON b.invitation_id = i.id WHERE i.rfq_id = $1";
    // Câu kiểm bản mã (`auditStoredCiphertexts`): đọc cả hai bảng nhưng không đếm và không khử trùng — ngoài cả hai tiêu chí.
    const kiemBanMa =
      "SELECT v.id, v.envelope FROM public.vendor_bid_versions v JOIN public.vendor_bids b ON b.id = v.bid_id " +
      "JOIN public.rfq_invitations i ON i.id = b.invitation_id WHERE i.rfq_id = $1";
    // Đếm LỜI MỜI, không đếm luồng báo giá: không đọc `vendor_bids`.
    const demLoiMoi = "SELECT count(*) FROM public.rfq_invitations i WHERE i.rfq_id = $1";
    const mau = (sql: string): CauSql => ({ tep: "mau.ts", dong: 1, sql });

    expect([laCauDemLuong(thieu), viPhamMotVe([mau(thieu)])]).toEqual([true, ["mau.ts:1 (0 vế)"]]);
    expect([laCauDemLuong(du), viPhamMotVe([mau(du)])]).toEqual([true, []]);
    expect([laCauDemLuong(lap), viPhamMotVe([mau(lap)])]).toEqual([true, ["mau.ts:1 (2 vế)"]]);
    expect([laCauDemLuong(daoThuTu), viPhamMotVe([mau(daoThuTu)])]).toEqual([true, ["mau.ts:1 (0 vế)"]]);
    expect([laCauDemLuong(kiemBanMa), laCauChonPhongBi(kiemBanMa)]).toEqual([false, false]);
    expect(laCauDemLuong(demLoiMoi)).toBe(false);
  });
});
