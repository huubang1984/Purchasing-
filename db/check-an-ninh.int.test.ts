// ==============================================================================================
// [khoản 105] MỌI `CHECK` CỦA LƯỢC ĐỒ THUỘC ĐÚNG MỘT TRONG HAI TẬP — VÀ CA ĐỘT BIẾN MÀ SỔ NỢ ĐÃ ĐO
//
// `hardening.always.sql` khai `CHECK_AN_NINH_KHAI`: ràng buộc mà gỡ đi là mở một đường phá một bất biến (tiêu chí ở khối
// trên hằng ấy). Mục phán xét của nó chỉ canh cái ĐÃ KHAI — và một danh sách tên thì mù đúng ở chỗ nó thiếu (khoản 3, 16).
// Nên tệp này đòi thêm một điều ở tầng test: mọi `CHECK` thật của lược đồ `public` sau `migrate()` phải thuộc ĐÚNG MỘT trong
// hai tập — khai an ninh ở hardening, hay MIỄN ở đây kèm một lý do thuộc một nhóm đã đặt tên. Một `CHECK` mới mà không ai
// quyết định thì ĐỎ; một dòng miễn không còn ràng buộc nào tương ứng cũng ĐỎ.
// ==============================================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const HARDENING = fileURLToPath(new URL("./migrations/hardening.always.sql", import.meta.url));

/** Lý do MIỄN — mỗi nhóm một câu, để một dòng miễn là một phân loại chứ không một khẩu vị. */
export const LY_DO = {
  DO_DAI: "hình dạng: độ dài chuỗi/byte trong một khoảng — chống dữ liệu rác, không canh một bất biến an ninh nào",
  DINH_DANG: "định dạng nghiệp vụ (mã số thuế, số điện thoại, tên kind) — sai thì sai dữ liệu, không mở quyền nào",
  MIEN: "miền giá trị của một cột phân loại — máy trạng thái an ninh nằm ở trigger chuyển trạng thái, không ở ràng buộc này",
  SO: "số đếm / số thứ tự / tham số không âm — toàn vẹn dữ liệu",
  HUU_HAN: "số hữu hạn (không NaN/Infinity) — toàn vẹn tiền tệ; phép tính J2 phán xử lại ở tầng ứng dụng và bộ kiểm độc lập",
  JSON: "hình dạng JSON — bộ đọc ở ứng dụng và ở bộ kiểm độc lập phán xử lại từng trường",
  MOC: "nhất quán giữa trạng thái và mốc thời gian của một hàng — mốc ĐÓNG thầu (thứ phán xử hạn) nằm ở tập an ninh",
} as const;

const MIEN_TRU: Readonly<Record<string, keyof typeof LY_DO>> = {
  audit_events_actor_type_check: "MIEN",
  audit_events_payload_la_doi_tuong: "JSON",
  bid_receipts_canonical_text_check: "DO_DAI",
  bid_receipts_signature_check: "DO_DAI",
  caller_rate_limits_hits_check: "SO",
  // [S1.281 / S3.4a] Ghi chú tuỳ chọn của khai báo xung đột: độ dài và đã cắt — hai ràng buộc hình dạng; hai ràng buộc K9
  // (`trang_thai`, `hinh_dang`) ở `CHECK_AN_NINH_KHAI`.
  coi_declarations_ghi_chu_check: "DO_DAI",
  coi_declarations_ghi_chu_da_cat: "DINH_DANG",
  // [S1.197 / S4.2a] Hàng chuẩn: hình dạng mã, tên, thuộc tính; miền trạng thái.
  canonical_item_versions_ten_hinh_dang: "DINH_DANG",
  canonical_item_versions_thuoc_tinh_hinh_dang: "JSON",
  canonical_item_versions_trang_thai_mien: "MIEN",
  canonical_item_versions_trong_yeu_co_gia_tri: "JSON",
  canonical_items_ma_hinh_dang: "DINH_DANG",
  // [S1.272 / S4.6a] Mốc ngoài và lịch sử ngoài hệ thống: hình dạng hàng dữ liệu / hàng rút, đơn giá dương hữu hạn, khoá đơn vị đã
  // làm sạch, miền tiền tệ, độ dài nguồn và tên nhà cung cấp. Luật GHI (quy đổi được, rút đúng đích) ở trigger, không ở CHECK.
  external_price_references_don_gia_duong: "HUU_HAN",
  external_price_references_don_vi_da_lam_sach: "DINH_DANG",
  external_price_references_hinh_dang: "DINH_DANG",
  external_price_references_nguon_hinh_dang: "DINH_DANG",
  external_price_references_tien_te_mien: "MIEN",
  external_purchase_history_don_gia_duong: "HUU_HAN",
  external_purchase_history_don_vi_da_lam_sach: "DINH_DANG",
  external_purchase_history_hinh_dang: "DINH_DANG",
  external_purchase_history_nguon_hinh_dang: "DINH_DANG",
  external_purchase_history_nha_cung_cap_hinh_dang: "DINH_DANG",
  external_purchase_history_tien_te_mien: "MIEN",
  // [S1.203 / S3.6b1] Ba cột phân loại của tín hiệu và lý do ghi nhận. Tín hiệu được CHỐT theo bằng chứng mà CSDL tính (trigger
  // `governance_signals_tinh`) và vị từ `rfq_chot_tin_hieu` so bằng chứng — không đọc ba cột này.
  governance_signal_acks_ly_do_check: "DO_DAI",
  governance_signals_do_tin_cay_check: "MIEN",
  governance_signals_loai_check: "MIEN",
  governance_signals_nguon_check: "MIEN",
  guest_sessions_verified_channel_check: "MIEN",
  invitation_otp_challenges_channel_check: "MIEN",
  invitation_otp_challenges_destination_hash_check: "DO_DAI",
  invitation_otp_challenges_failed_attempts_check: "SO",
  invitation_otp_challenges_pepper_version_check: "DO_DAI",
  // [S1.197 / S4.2a] Bí danh hàng, quy đổi riêng: dạng sạch, hàng rút, hệ số dương, hai đầu khác nhau.
  item_aliases_bi_danh_sach_da_lam_sach: "DINH_DANG",
  item_aliases_rut_khong_hang: "DINH_DANG",
  item_uom_conversions_hai_dau_khac: "DINH_DANG",
  // [S1.256 / lượt soi S4.5b] Hệ số quy đổi riêng hữu hạn — `'NaN' > 0` là đúng trong Postgres.
  item_uom_conversions_he_so_huu_han: "HUU_HAN",
  item_uom_conversions_rut_khong_he_so: "SO",
  item_uom_conversions_tu_don_vi_da_lam_sach: "DINH_DANG",
  master_key_check_values_kcv_check: "DO_DAI",
  master_key_check_values_key_version_check: "DO_DAI",
  mfa_credentials_failed_attempts_check: "SO",
  mfa_credentials_kind_check: "MIEN",
  mfa_credentials_last_used_counter_check: "SO",
  mfa_credentials_secret_key_version_check: "DO_DAI",
  mfa_credentials_secret_wrapped_check: "DO_DAI",
  mfa_reset_requests_reason_check: "DO_DAI",
  mfa_reset_requests_status_check: "MIEN",
  org_key_pairs_key_version_check: "DO_DAI",
  org_key_pairs_public_key_check: "DO_DAI",
  org_key_pairs_wrapped_private_key_check: "DO_DAI",
  // [S1.156 / S3.1a] Phiên bản có bậc phải khai hai cột mức chính sách — nhất quán giữa các cột của MỘT
  // hàng, cùng khuôn `danh_gia_du_bo`. Bậc giá trị do trigger `chinh_sach_kiem_bac` phán xử, không ở đây.
  org_procurement_policies_bac_kem_muc_s3: "MOC",
  org_procurement_policies_bafo_top_n_khong_am: "SO",
  // [S1.256 / S4.5b] Nhóm khoá `benchmark`: hình dạng và biên GIẢ ĐỊNH. Bộ đọc `docNhomBenchmark` phán lại từng khoá và NÉM khi lệch
  // — gỡ ràng buộc này không làm nhãn nào tính trên ngưỡng lạ, chỉ làm lượt chấm dưới phiên bản ấy dừng.
  org_procurement_policies_benchmark_hinh_dang: "JSON",
  org_procurement_policies_currency_check: "MIEN",
  org_procurement_policies_danh_gia_du_bo: "MOC",
  org_procurement_policies_dual_approval_threshold_check: "HUU_HAN",
  org_procurement_policies_eval_components_hinh_dang: "JSON",
  org_procurement_policies_eval_components_la_mang: "JSON",
  org_procurement_policies_hieu_luc_khong_lui: "MOC",
  org_procurement_policies_key_purge_grace_hours_check: "SO",
  // [S1.156 / S3.1a] Hai cột mức chính sách: tất-cả-hoặc-không (khuôn `danh_gia_du_bo`), và dương.
  org_procurement_policies_muc_s3_du_bo: "MOC",
  org_procurement_policies_muc_s3_duong: "SO",
  // [S1.279 / S4.7a] Nhóm khoá `tco`: hình dạng, cặp hai khoá, biên GIẢ ĐỊNH của ba tỷ lệ và số ngày. Luật chịu lực của L8 (mã có
  // nguồn, hệ số mã tiền bằng 1, đủ tham số) chạy LÚC CHẤM ở `kiemChinhSachTco`; gỡ ràng buộc này thì một tỷ lệ sai định dạng làm
  // lượt chấm NÉM, không ra một con số — biên là vệ sinh cấu hình, phiên bản vẫn ghim lúc mở, trước khi giá lộ.
  org_procurement_policies_tco_hinh_dang: "JSON",
  org_procurement_policies_version_check: "SO",
  otp_rate_limits_bucket_kind_check: "MIEN",
  // [S1.9101 / S3.7a1 / ADR-081] Passport: kênh và lý do là miền; băm đích, phiên bản pepper, danh sách là độ dài; số lần sai là số;
  // MST là định dạng. Mười hai ràng buộc an ninh (băm token/phiên/mã, hạn, kênh link, mục đích, số tài khoản, văn bản) ở hardening.
  passport_otp_challenges_bam_dich: "DO_DAI",
  passport_otp_challenges_kenh: "MIEN",
  passport_otp_challenges_phien_ban_pepper: "DO_DAI",
  passport_otp_challenges_so_lan_sai: "SO",
  passport_sessions_kenh: "MIEN",
  supplier_passport_requests_ly_do_check: "MIEN",
  supplier_passport_versions_danh_sach: "DO_DAI",
  supplier_passport_versions_mst: "DINH_DANG",
  otp_rate_limits_hits_check: "SO",
  outbox_jobs_attempts_check: "SO",
  outbox_jobs_check: "MOC",
  outbox_jobs_check1: "MOC",
  outbox_jobs_dedupe_key_check: "DO_DAI",
  outbox_jobs_kind_check: "DINH_DANG",
  outbox_jobs_last_failure_reason_check: "MIEN",
  // [S1.256 / S4.5b] Kết quả và đầu vào benchmark: miền, đủ bộ, số. Luật chịu lực của L7 là phép tính lại; vế *"ghi một lần, cùng
  // lượt chấm, cùng phiên bản ghim"* là khoá ngoại `…_cua_luot_cham_fk`, không phải `CHECK`.
  price_benchmark_inputs_hoi_to_mien: "MIEN",
  price_benchmark_inputs_line_no_duong: "SO",
  price_benchmark_inputs_tien_te_mien: "MIEN",
  price_benchmark_results_chieu_khi_lech: "MOC",
  price_benchmark_results_chieu_mien: "MIEN",
  price_benchmark_results_cua_so_truoc_moc: "MOC",
  price_benchmark_results_do_duoc_du_bo: "MOC",
  price_benchmark_results_hoi_to_mien: "MIEN",
  price_benchmark_results_line_no_duong: "SO",
  price_benchmark_results_ly_do_mien: "MIEN",
  price_benchmark_results_nhan_mien: "MIEN",
  price_benchmark_results_phuong_phap_mien: "MIEN",
  price_benchmark_results_so_dem_khong_am: "SO",
  price_benchmark_results_tien_te_mien: "MIEN",
  // [S1.260 / S4.5c1] Bản lưu của bảng so sánh: cùng miền, đủ bộ, số của `103`; mốc trước lúc ghi. Vế *"một lần mỗi lần mở thầu,
  // cùng giao dịch, phiên bản ghim"* là `UNIQUE` và hai khoá ngoại `…_cung_ban_luu_fk`, `…_phien_ban_ghim_fk`, không phải `CHECK`.
  // [S1.276 / S4.6b] Nhãn theo dải lịch sử ngoài trong bản lưu: miền, số đếm, cửa sổ ngày. Vế *"cùng giao dịch, đúng dòng đo được"* là
  // hai khoá ngoại `…_cung_ban_luu_fk`, `…_dong_do_duoc_fk`, không phải `CHECK`.
  price_benchmark_snapshot_external_lines_chieu_khi_lech: "MOC",
  price_benchmark_snapshot_external_lines_chieu_mien: "MIEN",
  price_benchmark_snapshot_external_lines_co_dai: "SO",
  price_benchmark_snapshot_external_lines_cua_so: "MOC",
  price_benchmark_snapshot_external_lines_line_no_duong: "SO",
  price_benchmark_snapshot_external_lines_nhan_mien: "MIEN",
  price_benchmark_snapshot_external_lines_so_dem: "SO",
  price_benchmark_snapshot_external_lines_tien_te_mien: "MIEN",
  price_benchmark_snapshot_lines_chieu_khi_lech: "MOC",
  price_benchmark_snapshot_lines_chieu_mien: "MIEN",
  price_benchmark_snapshot_lines_do_duoc_du_bo: "MOC",
  price_benchmark_snapshot_lines_hoi_to_mien: "MIEN",
  price_benchmark_snapshot_lines_line_no_duong: "SO",
  price_benchmark_snapshot_lines_ly_do_mien: "MIEN",
  price_benchmark_snapshot_lines_nhan_mien: "MIEN",
  price_benchmark_snapshot_lines_so_dem_khong_am: "SO",
  price_benchmark_snapshot_lines_tien_te_mien: "MIEN",
  price_benchmark_snapshots_moc_truoc_ghi: "MOC",
  price_benchmark_snapshots_phuong_phap_mien: "MIEN",
  // [S1.201 / S3.6a] Mã và tên nhóm hàng — hình dạng dữ liệu. `loai` của lần đổi trạng thái nằm ở tập an ninh: bỏ nó thì một
  // hàng lạ làm `nhom_hang_con_dung` coi nhóm đã ngừng dùng là còn dùng.
  procurement_categories_ma_check: "DINH_DANG",
  // [S1.204 / S4.3a] Gợi ý và ánh xạ hạng mục: hình dạng. Luật chịu lực (L2, L3, L13, §2.5 ⒁) nằm ở trigger `…_bat_bien`, không ở
  // các ràng buộc này — `tu_dong_co_hang` gỡ đi thì trigger vẫn từ chối `TU_DONG` không hàng chuẩn (bí danh luôn trỏ một hàng), và
  // `ket_qua`/`nguon` lạ rơi vào nhánh chặt hơn của trigger, không nhánh lỏng hơn.
  rfq_item_goi_y_dau_vao_la_doi_tuong: "JSON",
  rfq_item_goi_y_do_tin_cay_mien: "SO",
  rfq_item_goi_y_ket_qua_mien: "MIEN",
  rfq_item_goi_y_line_no_duong: "SO",
  rfq_item_goi_y_phien_ban_duong: "SO",
  rfq_item_mappings_dau_vao_la_doi_tuong: "JSON",
  rfq_item_mappings_do_tin_cay_mien: "SO",
  rfq_item_mappings_line_no_duong: "SO",
  rfq_item_mappings_ly_do_hinh_dang: "DO_DAI",
  rfq_item_mappings_nguon_mien: "MIEN",
  rfq_item_mappings_phien_ban_duong: "SO",
  rfq_item_mappings_tu_dong_co_hang: "MIEN",
  procurement_categories_ten_check: "DO_DAI",
  outbox_jobs_status_check: "MIEN",
  rfq_bafo_rounds_dong_sau_khi_mo: "MOC",
  rfq_bafo_rounds_round_no_check: "SO",
  rfq_bafo_rounds_top_n_check: "SO",
  rfq_budgets_currency_check: "MIEN",
  rfq_budgets_estimated_value_check: "HUU_HAN",
  rfq_chua_mo_thi_khong_co_moc_mo: "MOC",
  rfq_da_mo_thi_co_moc_mo: "MOC",
  rfq_deadline_bat_buoc_sau_draft: "MOC",
  rfq_evaluation_lines_co_so_thi_co_nguon: "JSON",
  rfq_evaluation_lines_components_hinh_dang: "JSON",
  rfq_evaluation_lines_gia_hop_le: "HUU_HAN",
  rfq_evaluation_lines_gia_va_hang_du_bo: "MOC",
  rfq_evaluation_lines_hang_tu_mot: "SO",
  // [S1.279 / S4.7a] Mã thiếu ô khai chỉ ở hàng không số, không rỗng — sai thì sai lời giải thích, không đổi hạng nào.
  rfq_evaluation_lines_ma_thieu_hinh_dang: "DINH_DANG",
  rfq_evaluations_currency_check: "MIEN",
  rfq_huy_thi_co_moc_huy: "MOC",
  rfq_invitations_link_channel_check: "MIEN",
  rfq_invitations_status_check: "MIEN",
  rfq_invitations_thu_hoi_co_moc: "MOC",
  rfq_items_description_check: "DO_DAI",
  rfq_items_line_no_check: "SO",
  rfq_items_quantity_check: "SO",
  rfq_items_quantity_huu_han: "HUU_HAN",
  rfq_items_unit_check: "DO_DAI",
  rfq_key_material_key_version_check: "DO_DAI",
  rfq_key_material_public_key_check: "DO_DAI",
  rfq_key_material_revoked_reason_check: "DO_DAI",
  rfq_key_material_wrapped_private_key_check: "DO_DAI",
  rfq_packages_early_close_reason_check: "DO_DAI",
  // [S1.279 / S4.7a] Miền của số ngày giao yêu cầu. Vế chịu lực của L16 — chỉ đổi ở DRAFT, nằm trong chữ ký — ở hai trigger.
  rfq_packages_so_ngay_giao_mien: "SO",
  rfq_packages_title_check: "DO_DAI",
  // [S1.265 / S3.3b] Độ dài giải trình và lý do rút ngoại lệ — năm CHECK kia của bảng (hành động, loại, mã lý do, hình dạng, sàn
  // `OTHER`) nằm ở tập an ninh.
  rfq_sourcing_exceptions_giai_trinh_check: "DO_DAI",
  sessions_user_agent_check: "DO_DAI",
  supplier_contacts_email_check: "DO_DAI",
  supplier_contacts_full_name_check: "DO_DAI",
  supplier_contacts_phone_check: "DINH_DANG",
  supplier_contacts_status_check: "MIEN",
  // [S1.196 / S3.3a] Độ dài lý do thu hồi xác minh — ba CHECK kia của bảng (loại, lý do theo loại, đủ cột) nằm ở tập an ninh.
  supplier_verifications_ly_do_check: "DO_DAI",
  suppliers_legal_name_check: "DO_DAI",
  suppliers_level_check: "MIEN",
  suppliers_status_check: "MIEN",
  suppliers_tax_code_check: "DINH_DANG",
  unseal_requests_huy_thi_co_moc: "MOC",
  unseal_requests_reason_check: "DO_DAI",
  // [S1.192 / S4.1] Đơn vị đo. Bí danh lưu ở dạng `chuoi_sach` của chính nó: gỡ ràng buộc thì một bí danh chưa làm sạch
  // KHÔNG BAO GIỜ khớp (thất bại đóng), không mở quyền nào. `he_so_ve_goc` chỉ migration ghi (danh mục toàn cục chỉ-ghi-thêm).
  uom_aliases_bi_danh_sach_check: "DINH_DANG",
  uom_aliases_chung_bi_danh_sach_check: "DINH_DANG",
  uom_aliases_rut_khong_ma: "DINH_DANG",
  uom_units_code_check: "DINH_DANG",
  uom_units_he_so_ve_goc_check: "SO",
  uom_units_thu_nguyen_check: "MIEN",
  users_status_check: "MIEN",
  vendor_bid_versions_envelope_check: "DO_DAI",
  vendor_bid_versions_version_check: "SO",
};

/** Tên ràng buộc khai ở `CHECK_AN_NINH_KHAI` — đọc từ CHÍNH hằng, không từ một bản chép. */
function docTenKhai(): string[] {
  const sql = readFileSync(HARDENING, "utf8");
  const dau = sql.indexOf("CHECK_AN_NINH_KHAI constant text :=");
  const cuoi = sql.indexOf(") AS ck(nspname, bang, conname, mig, dinh_nghia)$q$;", dau);
  if (dau < 0 || cuoi < 0) throw new Error("không tìm thấy CHECK_AN_NINH_KHAI trong hardening.always.sql");
  return [...sql.slice(dau, cuoi).matchAll(/\('public', '[a-z_]+', '([a-z0-9_]+)', '/gu)].map((m) => m[1]!);
}

let db: TestDatabase;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
}, 240000);

afterAll(async () => {
  await db?.stop();
});

describe("[khoản 105] phân loại CHECK", () => {
  it("mọi CHECK của `public` thuộc ĐÚNG MỘT tập: khai an ninh ở hardening, hay miễn ở đây — không thiếu, không thừa, không trùng", async () => {
    const khai = docTenKhai();
    expect(khai.length, "bộ đọc hằng không rỗng ruột").toBeGreaterThanOrEqual(40);
    const { rows } = await db.pool.query<{ conname: string }>(
      "SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace " +
        "WHERE c.contype = 'c' AND n.nspname = 'public' ORDER BY 1",
    );
    const that = rows.map((r) => r.conname);
    const mien = Object.keys(MIEN_TRU);
    expect(khai.filter((k) => mien.includes(k)), "một ràng buộc vừa khai an ninh vừa miễn").toEqual([]);
    expect(that.filter((t) => !khai.includes(t) && !mien.includes(t)), "CHECK chưa được phân loại — khai hay miễn kèm lý do").toEqual([]);
    expect(khai.filter((k) => !that.includes(k)), "dòng khai an ninh không còn ràng buộc tương ứng").toEqual([]);
    expect(mien.filter((m) => !that.includes(m)), "dòng miễn không còn ràng buộc tương ứng").toEqual([]);
  });

  it("lược đồ thật sau migrate(): mục phán xét im — mọi dòng khai tồn tại, còn hiệu lực, đúng định nghĩa", async () => {
    await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
  });
});

describe("[khoản 105] ĐỘT BIẾN của S1.61 — gỡ hai, hạ một về NOT VALID ⇒ migrate() kế NÉM, nêu đủ ba", () => {
  it("DROP users_email_chu_thuong + DROP supplier_contacts_email_chu_thuong + supplier_contacts_email_hinh_dang NOT VALID ⇒ NÉM; dựng lại ⇒ đi qua", async () => {
    const hinhDang = (
      await db.pool.query<{ d: string }>(
        "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'supplier_contacts_email_hinh_dang'",
      )
    ).rows[0]!.d;
    await db.pool.query("ALTER TABLE users DROP CONSTRAINT users_email_chu_thuong");
    await db.pool.query("ALTER TABLE supplier_contacts DROP CONSTRAINT supplier_contacts_email_chu_thuong");
    await db.pool.query("ALTER TABLE supplier_contacts DROP CONSTRAINT supplier_contacts_email_hinh_dang");
    await db.pool.query(`ALTER TABLE supplier_contacts ADD CONSTRAINT supplier_contacts_email_hinh_dang ${hinhDang} NOT VALID`);
    try {
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi, "trước bản vá: migrate() ĐI QUA (S1.61)").not.toBeNull();
      expect(loi!.message).toContain("ràng buộc CHECK an ninh còn nguyên");
      expect(loi!.message).toContain("users.users_email_chu_thuong: KHÔNG TỒN TẠI");
      expect(loi!.message).toContain("supplier_contacts.supplier_contacts_email_chu_thuong: KHÔNG TỒN TẠI");
      expect(loi!.message).toContain("supplier_contacts.supplier_contacts_email_hinh_dang: NOT VALID");
    } finally {
      await db.pool.query("ALTER TABLE users ADD CONSTRAINT users_email_chu_thuong CHECK (email = lower(email))");
      await db.pool.query("ALTER TABLE supplier_contacts ADD CONSTRAINT supplier_contacts_email_chu_thuong CHECK (email = lower(email))");
      await db.pool.query("ALTER TABLE supplier_contacts VALIDATE CONSTRAINT supplier_contacts_email_hinh_dang");
    }
    await expect(migrate(db.pool, MIGRATIONS_DIR), "dựng lại đúng ⇒ đi qua").resolves.toEqual([]);
  });

  it("NỚI một định nghĩa mà giữ nguyên TÊN (phiên AGENT sống một ngày thay vì một giờ) ⇒ NÉM 'định nghĩa khác bản khai'", async () => {
    await db.pool.query("ALTER TABLE sessions DROP CONSTRAINT sessions_agent_ttl_ngan");
    await db.pool.query(
      "ALTER TABLE sessions ADD CONSTRAINT sessions_agent_ttl_ngan CHECK (kind <> 'AGENT_READONLY' OR expires_at <= created_at + interval '1 day')",
    );
    try {
      const loi = await migrate(db.pool, MIGRATIONS_DIR).then(
        () => null,
        (e: Error) => e,
      );
      expect(loi?.message).toContain("sessions.sessions_agent_ttl_ngan: định nghĩa khác bản khai");
    } finally {
      await db.pool.query("ALTER TABLE sessions DROP CONSTRAINT sessions_agent_ttl_ngan");
      await db.pool.query(
        "ALTER TABLE sessions ADD CONSTRAINT sessions_agent_ttl_ngan CHECK (kind <> 'AGENT_READONLY' OR expires_at <= created_at + interval '1 hour')",
      );
    }
    await expect(migrate(db.pool, MIGRATIONS_DIR)).resolves.toEqual([]);
  });
});
