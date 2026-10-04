// ==============================================================================================
// [S1.9101 / S3.3c1] NHÀ CUNG CẤP *ĐẾM ĐƯỢC* CHO CHỐT K2 — dàn cảnh dùng chung của mọi test nộp duyệt gói ở tổ chức đã bật S3
//
// K2 (spec S3 §5.1, §2.4 ⑹; ADR-082 ⑹ ⑺) chỉ đếm một nhà cung cấp khi: hồ sơ và MỌI người liên hệ của nó KHÔNG do người tạo
// gói hay một người mời của gói dựng; nhà cung cấp có MST và một xác minh còn hiệu lực (K8a, `082`); xác minh ấy không do người
// khai phiên bản chính sách mà gói ghim; người liên hệ được mời đang ACTIVE và có số điện thoại (OTP đi kênh khác link); và hai
// lời mời chung MST gốc (10 số đầu), email hay số điện thoại thuộc MỘT nhóm, bắc cầu (S3.3c2, hàm đếm). Trước S3.3c mọi test
// dựng nhà cung cấp bằng CHÍNH người tạo gói, không MST, không xác minh — nên không một nhà cung cấp nào đếm được.
//
// Hàm này dựng ĐÚNG hình dạng ấy, bằng quyền chủ cụm (câu thô, không qua route), theo thứ tự xác minh đòi: người liên hệ trước,
// xác minh sau — băm hồ sơ của xác minh phủ mọi người liên hệ (`082` (3)), thêm một người liên hệ sau là xác minh thôi hiệu lực.
//   ⑴ người dựng hồ sơ: một người dùng RIÊNG vai `TECHNICAL` (chỉ `evaluation.perform`) do hàm này tạo — không giữ `rfq.invite`
//      nên không thành người mời, không giữ `rfq.approve` nên không đổi số người ký hay ghi nhận được mà test khác khẳng định;
//      kiểm danh tính theo phiên (ADR-016) đòi một phiên thật, nên hàm tạo cả phiên;
//   ⑵ MST: mười chữ số ngẫu nhiên, mỗi nhà cung cấp một MST gốc riêng; người liên hệ: email và số điện thoại ngẫu nhiên riêng;
//   ⑶ người xác minh: người gọi truyền vào — một người giữ `supplier.qualify` (FINANCE), không giữ `rfq.invite`, và KHÔNG phải
//      người khai phiên bản chính sách mà ngân sách của gói sẽ ghim. Tổ chức phải ĐÃ bật S3 và phiên bản hiệu lực có
//      `tham_dinh_hieu_luc_thang` — trigger `ncc_kiem_xac_minh` đòi cả hai.
// ==============================================================================================
import { randomBytes, randomInt } from "node:crypto";
import type pg from "pg";

export interface NguoiPhien {
  /** `users.id`. */
  readonly u: string;
  /** `sessions.id` còn hiệu lực của người ấy. */
  readonly s: string;
}

export interface NhaCungCapDemDuoc {
  /** `suppliers.id`. */
  readonly ncc: string;
  /** `supplier_contacts.id` — người liên hệ mà test mời. */
  readonly lh: string;
  readonly mst: string;
  readonly email: string;
  readonly phone: string;
}

const NGUOI_NHAP_THEO_TO_CHUC = new WeakMap<pg.Pool, Map<string, NguoiPhien>>();

async function motId(pool: pg.Pool, sql: string, thamSo: readonly unknown[]): Promise<string> {
  const id = (await pool.query<{ id: string }>(sql, [...thamSo])).rows[0]?.id;
  if (id === undefined) throw new Error(`câu dựng không trả id: ${sql.slice(0, 60)}`);
  return id;
}

/** Người nhập hồ sơ nhà cung cấp của tổ chức — vai `TECHNICAL`, một người mỗi tổ chức mỗi pool. */
export async function nguoiNhapNhaCungCap(pool: pg.Pool, orgId: string): Promise<NguoiPhien> {
  let theoToChuc = NGUOI_NHAP_THEO_TO_CHUC.get(pool);
  if (theoToChuc === undefined) {
    theoToChuc = new Map();
    NGUOI_NHAP_THEO_TO_CHUC.set(pool, theoToChuc);
  }
  const co = theoToChuc.get(orgId);
  if (co !== undefined) return co;
  const u = await motId(pool, "INSERT INTO public.users (org_id, email, full_name, status) VALUES ($1, $2, 'Nguoi nhap NCC', 'ACTIVE') RETURNING id", [
    orgId,
    `nhap-ncc-${randomBytes(4).toString("hex")}@vidu.vn`,
  ]);
  await pool.query("INSERT INTO public.user_roles (org_id, user_id, role_code) VALUES ($1, $2, 'TECHNICAL')", [orgId, u]);
  const s = await motId(
    pool,
    // Mốc tính ở đây chứ không bằng `now() + interval` trong câu: cổng QT3 đòi ghim đủ bốn trục cho mọi câu của gói.
    "INSERT INTO public.sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [orgId, u, randomBytes(32), new Date(Date.now() + 24 * 3600 * 1000), new Date()],
  );
  const nguoi = { u, s };
  theoToChuc.set(orgId, nguoi);
  return nguoi;
}

/** Mười chữ số, chữ số đầu khác 0 — đúng hình dạng `suppliers_tax_code_check` (`008`). */
function mstNgauNhien(): string {
  return `${String(randomInt(1, 10))}${String(randomInt(0, 1e9)).padStart(9, "0")}`;
}

function soDienThoaiNgauNhien(): string {
  return `09${String(randomInt(0, 1e8)).padStart(8, "0")}`;
}

/**
 * Dựng `soLuong` nhà cung cấp đếm được cho K2 (mặc định 1) trong tổ chức `orgId`: hồ sơ có MST và một người liên hệ, do người
 * nhập riêng dựng, rồi `nguoiXacMinh` xác minh. `pool` là pool CHỦ CỤM (`TestDatabase.pool`). Tổ chức phải đã bật S3.
 */
export async function nhaCungCapDemDuoc(
  pool: pg.Pool,
  orgId: string,
  tuyChon: { readonly nguoiXacMinh: NguoiPhien; readonly soLuong?: number; readonly nguoiNhap?: NguoiPhien; readonly tenGoc?: string },
): Promise<NhaCungCapDemDuoc[]> {
  const nhap = tuyChon.nguoiNhap ?? (await nguoiNhapNhaCungCap(pool, orgId));
  const ra: NhaCungCapDemDuoc[] = [];
  for (let i = 0; i < (tuyChon.soLuong ?? 1); i += 1) {
    const mst = mstNgauNhien();
    const duoi = randomBytes(6).toString("hex");
    const email = `ncc${duoi}@vidu.vn`;
    const phone = soDienThoaiNgauNhien();
    const ncc = await motId(
      pool,
      "INSERT INTO public.suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [orgId, `${tuyChon.tenGoc ?? "NCC dem duoc"} ${duoi}`, mst, nhap.u, nhap.s],
    );
    const lh = await motId(
      pool,
      "INSERT INTO public.supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
        "VALUES ($1, $2, 'Nguoi ban hang', $3, $4, $5, $6) RETURNING id",
      [orgId, ncc, email, phone, nhap.u, nhap.s],
    );
    await pool.query(
      "INSERT INTO public.supplier_verifications (org_id, supplier_id, loai, created_by, created_by_session_id) VALUES ($1, $2, 'VERIFIED', $3, $4)",
      [orgId, ncc, tuyChon.nguoiXacMinh.u, tuyChon.nguoiXacMinh.s],
    );
    ra.push({ ncc, lh, mst, email, phone });
  }
  return ra;
}
