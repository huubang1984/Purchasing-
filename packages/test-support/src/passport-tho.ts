// ==============================================================================================
// [S1.9101 / S3.7a2 / K8b] PHIÊN BẢN PASSPORT *THÔ* CHO FIXTURE — dàn cảnh dùng chung của mọi test cần một nhà cung cấp ĐÃ NỘP hồ sơ
//
// Thẩm định (K8b) trỏ một phiên bản Passport, mà một phiên bản chỉ sinh ra sau trọn đường của `118`: yêu cầu → link → thách thức OTP →
// phiên → phiên bản (năm bảng, năm trigger ENABLE ALWAYS). Test của tầng gói và của award theo bậc không đo đường ấy (`passport.int`
// đo), nên hàm này đi đúng chuỗi năm câu ghi bằng quyền chủ cụm trong MỘT giao dịch, để MỌI trigger của `118` vẫn chạy — không tắt
// trigger, không chèn tắt:
//   ⑴ yêu cầu `MANUAL` của `nguoiYeuCau` (giữ `supplier.qualify`; trigger đòi K8a còn hiệu lực và người liên hệ có điện thoại);
//   ⑵ link cùng người, cùng phiên, cùng giao dịch (trigger đòi `now()` bằng nhau), kênh EMAIL; link sống trước đó của nhà cung cấp bị
//      thu hồi trước — trigger cấm hai link sống;
//   ⑶ thách thức OTP kênh SMS (khác lớp đích với link), đánh dấu đã đối chiếu; token đánh dấu đã tiêu thụ;
//   ⑷ phiên Passport dẫn xuất từ thách thức, 4 giờ;
//   ⑸ phiên bản hồ sơ — MST BẰNG MST bản ghi (thẩm định từ chối MST lệch, ADR-081 ⑴) trừ khi test cố ý truyền MST khác.
// Mốc thời gian tính ở đây, không bằng `now() + interval` trong câu (cổng QT3 đòi ghim đủ bốn trục cho mọi câu của gói).
// ==============================================================================================
import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { NguoiPhien } from "./nha-cung-cap-dem-duoc.js";

export interface PhienBanPassportTho {
  /** `supplier_passport_versions.id`. */
  readonly versionId: string;
  readonly thuTu: number;
  readonly passportSessionId: string;
  readonly requestId: string;
}

export interface HoSoTho {
  readonly legalName?: string;
  readonly taxCode?: string;
  readonly nguoiDaiDien?: string;
  readonly diaChi?: string;
  readonly nganHang?: string;
  readonly soTaiKhoan?: string;
}

/**
 * Nộp một phiên bản Passport cho nhà cung cấp `ncc` (người liên hệ `lh`, MST `mst`) dưới `nguoiYeuCau` — một người giữ `supplier.qualify`,
 * tổ chức đã bật S3, nhà cung cấp đã xác minh. Gọi lần hai cho cùng nhà cung cấp là một phiên bản MỚI (thứ tự +1) — thẩm định cũ thôi
 * hiệu lực. `pool` là pool CHỦ CỤM.
 */
export async function phienBanPassportTho(
  pool: pg.Pool,
  orgId: string,
  input: { readonly ncc: string; readonly lh: string; readonly mst: string; readonly nguoiYeuCau: NguoiPhien; readonly hoSo?: HoSoTho },
): Promise<PhienBanPassportTho> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const luc = new Date();
    const hanLink = new Date(luc.getTime() + 24 * 3600 * 1000);
    const hanOtp = new Date(luc.getTime() + 5 * 60 * 1000);
    const hanPhien = new Date(luc.getTime() + 4 * 3600 * 1000);
    await c.query(
      "UPDATE public.supplier_passport_tokens SET revoked_at = $3 WHERE org_id OPERATOR(pg_catalog.=) $1 AND supplier_id OPERATOR(pg_catalog.=) $2 AND revoked_at IS NULL AND consumed_at IS NULL",
      [orgId, input.ncc, luc],
    );
    await c.query("UPDATE public.passport_sessions SET revoked_at = $3 WHERE org_id OPERATOR(pg_catalog.=) $1 AND supplier_id OPERATOR(pg_catalog.=) $2 AND revoked_at IS NULL", [orgId, input.ncc, luc]);
    const yc = await c.query<{ id: string }>(
      "INSERT INTO public.supplier_passport_requests (org_id, supplier_id, contact_id, ly_do, requested_by, requested_by_session_id) " +
        "VALUES ($1, $2, $3, 'MANUAL', $4, $5) RETURNING id",
      [orgId, input.ncc, input.lh, input.nguoiYeuCau.u, input.nguoiYeuCau.s],
    );
    const requestId = yc.rows[0]!.id;
    const tk = await c.query<{ id: string }>(
      "INSERT INTO public.supplier_passport_tokens (org_id, request_id, supplier_id, contact_id, token_hash, purpose, link_channel, expires_at, issued_by, issued_by_session_id) " +
        "VALUES ($1, $2, $3, $4, $5, 'PASSPORT_SUBMISSION', 'EMAIL', $6, $7, $8) RETURNING id",
      [orgId, requestId, input.ncc, input.lh, randomBytes(32), hanLink, input.nguoiYeuCau.u, input.nguoiYeuCau.s],
    );
    const tokenId = tk.rows[0]!.id;
    const tt = await c.query<{ id: string }>(
      "INSERT INTO public.passport_otp_challenges (org_id, token_id, contact_id, channel, code_hash, destination_hash, pepper_version, expires_at) " +
        "VALUES ($1, $2, $3, 'SMS', $4, $5, 'test-v1', $6) RETURNING id",
      [orgId, tokenId, input.lh, randomBytes(32), randomBytes(32), hanOtp],
    );
    const challengeId = tt.rows[0]!.id;
    await c.query("UPDATE public.passport_otp_challenges SET consumed_at = $2 WHERE id OPERATOR(pg_catalog.=) $1", [challengeId, luc]);
    await c.query("UPDATE public.supplier_passport_tokens SET consumed_at = $2 WHERE id OPERATOR(pg_catalog.=) $1", [tokenId, luc]);
    const ph = await c.query<{ id: string }>(
      "INSERT INTO public.passport_sessions (org_id, supplier_id, contact_id, challenge_id, token_hash, verified_channel, expires_at) " +
        "VALUES ($1, $2, $3, $4, $5, 'SMS', $6) RETURNING id",
      [orgId, input.ncc, input.lh, challengeId, randomBytes(32), hanPhien],
    );
    const passportSessionId = ph.rows[0]!.id;
    const h = input.hoSo ?? {};
    const pb = await c.query<{ id: string; thu_tu: string }>(
      "INSERT INTO public.supplier_passport_versions (org_id, supplier_id, passport_session_id, legal_name, tax_code, nguoi_dai_dien, dia_chi, ngan_hang, so_tai_khoan, chung_nhan, nhom_hang) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', '{}') RETURNING id, thu_tu::pg_catalog.text AS thu_tu",
      [
        orgId,
        input.ncc,
        passportSessionId,
        h.legalName ?? "Cong ty TNHH Dem Duoc",
        h.taxCode ?? input.mst,
        h.nguoiDaiDien ?? "Nguyen Van A",
        h.diaChi ?? "12 Nguyen Trai, Ha Noi",
        h.nganHang ?? "Ngan hang TMCP Vi Du",
        h.soTaiKhoan ?? `1000${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      ],
    );
    await c.query("COMMIT");
    const v = pb.rows[0]!;
    return { versionId: v.id, thuTu: Number(v.thu_tu), passportSessionId, requestId };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
