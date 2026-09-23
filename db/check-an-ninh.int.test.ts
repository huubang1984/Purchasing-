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
  guest_sessions_verified_channel_check: "MIEN",
  invitation_otp_challenges_channel_check: "MIEN",
  invitation_otp_challenges_destination_hash_check: "DO_DAI",
  invitation_otp_challenges_failed_attempts_check: "SO",
  invitation_otp_challenges_pepper_version_check: "DO_DAI",
  master_key_check_values_kcv_check: "DO_DAI",
  master_key_check_values_key_version_check: "DO_DAI",
  mfa_credentials_failed_attempts_check: "SO",
  mfa_credentials_kind_check: "MIEN",
  mfa_credentials_last_used_counter_check: "SO",
  mfa_credentials_secret_key_version_check: "DO_DAI",
  mfa_credentials_secret_wrapped_check: "DO_DAI",
  mfa_reset_requests_reason_check: "DO_DAI",
  mfa_reset_requests_status_check: "MIEN",
  org_procurement_policies_bafo_top_n_khong_am: "SO",
  org_procurement_policies_currency_check: "MIEN",
  org_procurement_policies_danh_gia_du_bo: "MOC",
  org_procurement_policies_dual_approval_threshold_check: "HUU_HAN",
  org_procurement_policies_eval_components_hinh_dang: "JSON",
  org_procurement_policies_eval_components_la_mang: "JSON",
  org_procurement_policies_hieu_luc_khong_lui: "MOC",
  org_procurement_policies_key_purge_grace_hours_check: "SO",
  org_procurement_policies_version_check: "SO",
  otp_rate_limits_bucket_kind_check: "MIEN",
  otp_rate_limits_hits_check: "SO",
  outbox_jobs_attempts_check: "SO",
  outbox_jobs_check: "MOC",
  outbox_jobs_check1: "MOC",
  outbox_jobs_dedupe_key_check: "DO_DAI",
  outbox_jobs_kind_check: "DINH_DANG",
  outbox_jobs_last_failure_reason_check: "MIEN",
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
  rfq_packages_title_check: "DO_DAI",
  sessions_user_agent_check: "DO_DAI",
  supplier_contacts_email_check: "DO_DAI",
  supplier_contacts_full_name_check: "DO_DAI",
  supplier_contacts_phone_check: "DINH_DANG",
  supplier_contacts_status_check: "MIEN",
  suppliers_legal_name_check: "DO_DAI",
  suppliers_level_check: "MIEN",
  suppliers_status_check: "MIEN",
  suppliers_tax_code_check: "DINH_DANG",
  unseal_requests_huy_thi_co_moc: "MOC",
  unseal_requests_reason_check: "DO_DAI",
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
