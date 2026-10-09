import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import { SupplierError, TAX_CODE_PATTERN } from "./suppliers.js";

// =============================================================================================
// [S1.287 / S3.7a1 / ADR-081] SUPPLIER PASSPORT — YÊU CẦU HỒ SƠ VÀ PHIÊN BẢN HỒ SƠ
//
// Hồ sơ THEO TỪNG TỔ CHỨC MUA (ADR-081 ⑴). Bên mua — người giữ `supplier.qualify` — gửi yêu cầu cho một người liên hệ của một
// nhà cung cấp ĐÃ XÁC MINH (K8a, chủ dự án chốt); nhà cung cấp mở link, qua OTP khác kênh (`packages/invitation`, `passport.ts`),
// nộp phiên bản hồ sơ. Level 2 là suy diễn: có ít nhất một phiên bản (ADR-081 ⑷). Thẩm định (K8b) là S3.7a2.
//
// SỐ TÀI KHOẢN — RANH GIỚI CỘT Ở TẦNG MÃ (chủ dự án chốt, khuôn `don_gia`): cột `so_tai_khoan` chỉ được ĐỌC ở tệp này, đúng ba câu
// — `docPassportCuaToi` (bốn số cuối), và hai câu của `docHoSoPassport` (số đầy đủ của phiên bản mới nhất sau `supplier.qualify`;
// bốn số cuối và cờ *đổi tài khoản* của lịch sử). Phép đo: `tests/architecture/so-tai-khoan-liet-ke.test.ts`. Không vào sổ, không
// vào log, không vào bộ bằng chứng; mỗi lần bên mua đọc số đầy đủ để một hàng `PASSPORT_VIEWED`. Rủi ro còn lại, nói thẳng: log tham
// số của Postgres (nếu bật — hardening (E4) chỉ cảnh báo) và bản sao lưu giữ số rõ; mối đe doạ chính của cột này là bị TRÁO, không
// phải bị ĐỌC — và tráo là việc của K8b (thẩm định trỏ phiên bản MỚI NHẤT).
// =============================================================================================

/** Mã từ chối của hàm vị từ `passport_chot_yeu_cau` (`118`) — tầng gói hỏi trước, trigger hỏi lại. */
export const MA_TU_CHOI_PASSPORT = [
  "PASSPORT_TO_CHUC_CHUA_BAT",
  "PASSPORT_NCC_KHONG_HOP_LE",
  "PASSPORT_NCC_CHUA_XAC_MINH",
  "PASSPORT_LIEN_HE_KHONG_HOP_LE",
  "PASSPORT_LIEN_HE_THIEU_KENH_OTP",
  "PASSPORT_QUA_TRAN_YEU_CAU",
] as const;
export type MaTuChoiPassport = (typeof MA_TU_CHOI_PASSPORT)[number];

/** Câu nói với người mua cho từng mã — không mang giá trị nào của hồ sơ. */
export const CAU_TU_CHOI_PASSPORT: Readonly<Record<MaTuChoiPassport, string>> = {
  PASSPORT_TO_CHUC_CHUA_BAT: "Tổ chức chưa bật kiểm soát S3 — Passport chỉ dùng ở tổ chức đã bật.",
  PASSPORT_NCC_KHONG_HOP_LE: "Nhà cung cấp không còn hoạt động hay chưa có mã số thuế.",
  PASSPORT_NCC_CHUA_XAC_MINH:
    "Nhà cung cấp chưa được xác minh (hay xác minh đã hết hạn, hay hồ sơ đã đổi từ lúc xác minh) — xác minh trước rồi mới gửi link Passport.",
  PASSPORT_LIEN_HE_KHONG_HOP_LE: "Người liên hệ không thuộc nhà cung cấp này hay không còn hoạt động.",
  PASSPORT_LIEN_HE_THIEU_KENH_OTP:
    "Người liên hệ chưa có số điện thoại — link đi email nên mã OTP phải đi máy điện thoại (hai kênh khác nhau).",
  PASSPORT_QUA_TRAN_YEU_CAU: "Đã gửi ba yêu cầu hồ sơ cho nhà cung cấp này trong một giờ qua — thử lại sau.",
};

function laMaTuChoiPassport(x: unknown): x is MaTuChoiPassport {
  return typeof x === "string" && (MA_TU_CHOI_PASSPORT as readonly string[]).includes(x);
}

/** Lời từ chối CỦA TRIGGER (đua với một yêu cầu khác giữa lần hỏi trước và câu ghi) — giao dịch đã hỏng, nên chỉ ném được. */
export class PassportYeuCauError extends SupplierError {
  readonly ma: MaTuChoiPassport;
  constructor(ma: MaTuChoiPassport) {
    super(CAU_TU_CHOI_PASSPORT[ma]);
    this.name = "PassportYeuCauError";
    this.ma = ma;
  }
}

export type KetQuaYeuCauPassport =
  | { readonly ok: true; readonly requestId: string }
  | { readonly ok: false; readonly ma: MaTuChoiPassport };

/**
 * Ghi một yêu cầu hồ sơ `MANUAL`. Ba lớp: `requirePermission(supplier.qualify)` (PERMISSION_DENIED, D5) → hàm vị từ hỏi TRƯỚC câu
 * ghi (lời từ chối là một kết quả, giao dịch còn lành) → trigger `passport_kiem_yeu_cau` (lớp có thẩm quyền). Người gọi đúc link
 * (`ducTokenPassport`) trong CÙNG giao dịch — trigger của token đòi thế.
 */
export async function taoYeuCauPassport(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly supplierId: string; readonly contactId: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<KetQuaYeuCauPassport> {
  await assertTenantBound(client, orgId, "taoYeuCauPassport");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.SUPPLIER_QUALIFY, resourceType: "SUPPLIER", resourceId: input.supplierId },
    auditPool,
  );
  const { rows: hoi } = await client.query<{ ma: string | null }>(
    "SELECT public.passport_chot_yeu_cau($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid) AS ma",
    [orgId, input.supplierId, input.contactId],
  );
  const ma = hoi[0]?.ma ?? null;
  if (ma !== null) {
    if (!laMaTuChoiPassport(ma)) throw new SupplierError("Hàm vị từ yêu cầu Passport trả một mã lạ — từ chối thay vì đoán.");
    return { ok: false, ma };
  }
  let requestId: string | undefined;
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO public.supplier_passport_requests (org_id, supplier_id, contact_id, ly_do, requested_by, requested_by_session_id)
       VALUES ($1, $2, $3, 'MANUAL', $4, $5) RETURNING id`,
      [orgId, input.supplierId, input.contactId, actor.id, actor.sessionId],
    );
    requestId = rows[0]?.id;
  } catch (loi) {
    const rangBuoc = (loi as { constraint?: unknown }).constraint;
    const maTrigger = typeof rangBuoc === "string" ? rangBuoc.toUpperCase() : null;
    if (laMaTuChoiPassport(maTrigger)) throw new PassportYeuCauError(maTrigger);
    throw loi;
  }
  if (requestId === undefined) throw new SupplierError("Câu INSERT yêu cầu Passport không trả về hàng nào");
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "PASSPORT_REQUESTED",
    resourceType: "supplier",
    resourceId: input.supplierId,
    payload: { requestId, contactId: input.contactId, lyDo: "MANUAL" },
  });
  return { ok: true, requestId };
}

/** Hồ sơ nhà cung cấp nộp — mọi trường đọc từ thân yêu cầu và KIỂM ở đây trước CHECK của CSDL. */
export interface HoSoPassport {
  readonly legalName: string;
  readonly taxCode: string;
  readonly nguoiDaiDien: string;
  readonly diaChi: string;
  readonly nganHang: string;
  readonly soTaiKhoan: string;
  readonly chungNhan: readonly string[];
  readonly nhomHang: readonly string[];
}

/** Ký tự điều khiển và ký tự định hướng (bidi) — cùng tập của CHECK `supplier_passport_versions_van_ban`. */
const KY_TU_CAM = /[\u0001-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
export const SO_TAI_KHOAN_PATTERN = /^[0-9]{6,20}$/u;
export const TRAN_DANH_SACH_PASSPORT = 20;

function vanBan(than: Record<string, unknown>, ten: string, nhan: string, tranByte: number): string {
  const v = than[ten];
  if (typeof v !== "string") throw new SupplierError(`Thiếu ${nhan}.`);
  const s = v.trim();
  if (s === "") throw new SupplierError(`Thiếu ${nhan}.`);
  if (Buffer.byteLength(s, "utf8") > tranByte) throw new SupplierError(`${nhan} dài quá ${String(tranByte)} byte.`);
  if (KY_TU_CAM.test(s)) throw new SupplierError(`${nhan} chứa ký tự điều khiển hay ký tự định hướng.`);
  return s;
}

function danhSach(than: Record<string, unknown>, ten: string, nhan: string): string[] {
  const v = than[ten] ?? [];
  if (!Array.isArray(v)) throw new SupplierError(`${nhan} phải là một danh sách.`);
  if (v.length > TRAN_DANH_SACH_PASSPORT) throw new SupplierError(`${nhan} tối đa ${String(TRAN_DANH_SACH_PASSPORT)} mục.`);
  return v.map((muc) => {
    if (typeof muc !== "string" || muc.trim() === "") throw new SupplierError(`Một mục ${nhan} trống.`);
    const s = muc.trim();
    if (Buffer.byteLength(s, "utf8") > 200) throw new SupplierError(`Một mục ${nhan} dài quá 200 byte.`);
    if (KY_TU_CAM.test(s)) throw new SupplierError(`Một mục ${nhan} chứa ký tự điều khiển hay ký tự định hướng.`);
    return s;
  });
}

/** Đọc thân yêu cầu thành `HoSoPassport`. Thông điệp lỗi gọi tên TRƯỜNG, không bao giờ nhắc lại GIÁ TRỊ. */
export function docHoSoPassportNhap(than: unknown): HoSoPassport {
  if (than === null || typeof than !== "object" || Array.isArray(than)) throw new SupplierError("Thân yêu cầu phải là một đối tượng.");
  const t = than as Record<string, unknown>;
  const taxCode = vanBan(t, "taxCode", "mã số thuế", 14);
  if (!TAX_CODE_PATTERN.test(taxCode)) throw new SupplierError("Mã số thuế phải là 10 chữ số, hay 10 chữ số kèm -XXX.");
  const soTaiKhoan = typeof t.soTaiKhoan === "string" ? t.soTaiKhoan.replace(/[\s.-]/gu, "") : "";
  if (!SO_TAI_KHOAN_PATTERN.test(soTaiKhoan)) throw new SupplierError("Số tài khoản phải gồm 6–20 chữ số.");
  return {
    legalName: vanBan(t, "legalName", "tên pháp lý", 500),
    taxCode,
    nguoiDaiDien: vanBan(t, "nguoiDaiDien", "người đại diện", 200),
    diaChi: vanBan(t, "diaChi", "địa chỉ", 1000),
    nganHang: vanBan(t, "nganHang", "ngân hàng", 200),
    soTaiKhoan,
    chungNhan: danhSach(t, "chungNhan", "chứng nhận"),
    nhomHang: danhSach(t, "nhomHang", "nhóm hàng"),
  };
}

/**
 * Nộp một phiên bản hồ sơ. Chạy dưới kết nối CHỈ gắn tổ chức (đường ghi của khách — kết nối gắn phiên khách không nối được chuỗi
 * sổ, `028`); `passportSessionId`, `supplierId`, `contactId` do tầng HTTP DẪN XUẤT từ cookie. Trigger `passport_kiem_phien_ban` là
 * lớp có thẩm quyền: phiên sống, đúng nhà cung cấp, trần năm phiên bản một phiên, `thu_tu` dưới khoá.
 */
export async function nopPhienBanPassport(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly passportSessionId: string; readonly supplierId: string; readonly contactId: string; readonly hoSo: HoSoPassport },
): Promise<{ readonly thuTu: number; readonly createdAt: Date }> {
  await assertTenantBound(client, orgId, "nopPhienBanPassport");
  const h = input.hoSo;
  let hang: { thu_tu: string; created_at: Date } | undefined;
  try {
    const { rows } = await client.query<{ thu_tu: string; created_at: Date }>(
      `INSERT INTO public.supplier_passport_versions
         (org_id, supplier_id, passport_session_id, legal_name, tax_code, nguoi_dai_dien, dia_chi, ngan_hang, so_tai_khoan,
          chung_nhan, nhom_hang)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::pg_catalog.text[], $11::pg_catalog.text[])
       RETURNING thu_tu::pg_catalog.text AS thu_tu, created_at`,
      [orgId, input.supplierId, input.passportSessionId, h.legalName, h.taxCode, h.nguoiDaiDien, h.diaChi, h.nganHang, h.soTaiKhoan,
        h.chungNhan, h.nhomHang],
    );
    hang = rows[0];
  } catch (loi) {
    const rangBuoc = (loi as { constraint?: unknown }).constraint;
    if (rangBuoc === "phien_passport_khong_hop_le") throw new SupplierError("Phiên hồ sơ đã hết hạn hay đã bị thu hồi — mở lại link.");
    if (rangBuoc === "phien_passport_qua_tran_phien_ban") throw new SupplierError("Một phiên nộp tối đa năm phiên bản hồ sơ.");
    throw loi;
  }
  if (hang === undefined) throw new SupplierError("Câu INSERT phiên bản Passport không trả về hàng nào");
  const thuTu = Number(hang.thu_tu);
  await appendAuditEvent(client, orgId, {
    actorType: "SUPPLIER",
    actorId: input.contactId,
    action: "PASSPORT_VERSION_SUBMITTED",
    resourceType: "supplier",
    resourceId: input.supplierId,
    // Thứ tự của phiên bản — không một trường hồ sơ nào: sổ nói AI nộp KHI NÀO, hồ sơ nằm ở bảng phiên bản.
    payload: { thuTu, passportSessionId: input.passportSessionId },
  });
  return { thuTu, createdAt: hang.created_at };
}

/** Phiên bản hồ sơ như nhà cung cấp thấy lại — số tài khoản CHE còn bốn số cuối. */
export interface PhienBanPassportCuaToi {
  readonly thuTu: number;
  readonly legalName: string;
  readonly taxCode: string;
  readonly nguoiDaiDien: string;
  readonly diaChi: string;
  readonly nganHang: string;
  readonly soTaiKhoanCuoi: string;
  readonly chungNhan: readonly string[];
  readonly nhomHang: readonly string[];
  readonly createdAt: Date;
}

interface HangCuaToi {
  thu_tu: string;
  legal_name: string;
  tax_code: string;
  nguoi_dai_dien: string;
  dia_chi: string;
  ngan_hang: string;
  so_tai_khoan_cuoi: string;
  chung_nhan: string[];
  nhom_hang: string[];
  created_at: Date;
  so_phien_ban: string;
}

/**
 * Đọc của NHÀ CUNG CẤP, dưới `withPassportSession`: policy `supplier_passport_versions_khach` chỉ mở hàng của chính nhà cung cấp
 * phiên (GUC dẫn xuất), nên câu không lọc theo nhà cung cấp — RLS lọc. Số tài khoản chỉ ra bốn số cuối: một cookie bị lấy không
 * đọc ngược được số đã nộp, và phiên bản mới phải nhập lại đủ số.
 */
export async function docPassportCuaToi(
  client: pg.PoolClient,
  orgId: string,
): Promise<{ readonly phienBanMoiNhat: PhienBanPassportCuaToi | null; readonly soPhienBan: number }> {
  await assertTenantBound(client, orgId, "docPassportCuaToi");
  const { rows } = await client.query<HangCuaToi>(
    `SELECT v.thu_tu::pg_catalog.text AS thu_tu, v.legal_name, v.tax_code, v.nguoi_dai_dien, v.dia_chi, v.ngan_hang,
            pg_catalog.right(v.so_tai_khoan, 4) AS so_tai_khoan_cuoi, v.chung_nhan, v.nhom_hang, v.created_at,
            (pg_catalog.count(*) OVER ())::pg_catalog.text AS so_phien_ban
       FROM public.supplier_passport_versions v
      ORDER BY v.thu_tu DESC
      LIMIT 1`,
  );
  const h = rows[0];
  if (h === undefined) return { phienBanMoiNhat: null, soPhienBan: 0 };
  return {
    phienBanMoiNhat: {
      thuTu: Number(h.thu_tu),
      legalName: h.legal_name,
      taxCode: h.tax_code,
      nguoiDaiDien: h.nguoi_dai_dien,
      diaChi: h.dia_chi,
      nganHang: h.ngan_hang,
      soTaiKhoanCuoi: h.so_tai_khoan_cuoi,
      chungNhan: h.chung_nhan,
      nhomHang: h.nhom_hang,
      createdAt: h.created_at,
    },
    soPhienBan: Number(h.so_phien_ban),
  };
}

/** Hồ sơ Passport như BÊN MUA đọc — chỉ người giữ `supplier.qualify`. */
export interface HoSoPassportBenMua {
  readonly supplierId: string;
  /** MST của BẢN GHI nhà cung cấp — ADR-081 ⑴: MST hồ sơ lệch MST bản ghi thì thẩm định (S3.7a2) từ chối. */
  readonly mstBanGhi: string | null;
  readonly phienBanMoiNhat:
    | (Omit<PhienBanPassportCuaToi, "soTaiKhoanCuoi"> & { readonly soTaiKhoan: string; readonly mstKhop: boolean })
    | null;
  readonly cacPhienBan: readonly {
    readonly thuTu: number;
    readonly createdAt: Date;
    readonly soTaiKhoanCuoi: string;
    /** Số tài khoản khác phiên bản trước — dấu hiệu màn thẩm định phải nêu (lượt soi T6). */
    readonly doiTaiKhoan: boolean;
  }[];
  /** Link gần nhất: lúc gửi, hạn, đã dùng, đã thu hồi. `null` khi chưa từng gửi. */
  readonly linkGanNhat: { readonly guiLuc: Date; readonly hetHanAt: Date; readonly daDung: boolean; readonly daThuHoi: boolean } | null;
}

/**
 * Đọc của BÊN MUA. `requirePermission(supplier.qualify)` TRONG hàm (cổng route che cổng trong hàm — một lời gọi thẳng vẫn phải
 * qua). Số tài khoản đầy đủ của phiên bản mới nhất ⇒ một hàng `PASSPORT_VIEWED` không mang giá trị (lượt soi T5).
 */
export async function docHoSoPassport(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly supplierId: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<HoSoPassportBenMua> {
  await assertTenantBound(client, orgId, "docHoSoPassport");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.SUPPLIER_QUALIFY, resourceType: "SUPPLIER", resourceId: input.supplierId },
    auditPool,
  );
  const { rows: ncc } = await client.query<{ tax_code: string | null }>(
    "SELECT s.tax_code FROM public.suppliers s WHERE s.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid",
    [input.supplierId],
  );
  if (ncc.length === 0) throw new SupplierError("Không tìm thấy nhà cung cấp.");
  const mstBanGhi = ncc[0]?.tax_code ?? null;

  const { rows: moi } = await client.query<Omit<HangCuaToi, "so_tai_khoan_cuoi" | "so_phien_ban"> & { so_tai_khoan: string }>(
    `SELECT v.thu_tu::pg_catalog.text AS thu_tu, v.legal_name, v.tax_code, v.nguoi_dai_dien, v.dia_chi, v.ngan_hang,
            v.so_tai_khoan, v.chung_nhan, v.nhom_hang, v.created_at
       FROM public.supplier_passport_versions v
      WHERE v.supplier_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
      ORDER BY v.thu_tu DESC
      LIMIT 1`,
    [input.supplierId],
  );
  const { rows: lichSu } = await client.query<{ thu_tu: string; created_at: Date; so_tai_khoan_cuoi: string; doi_tai_khoan: boolean }>(
    `SELECT v.thu_tu::pg_catalog.text AS thu_tu, v.created_at, pg_catalog.right(v.so_tai_khoan, 4) AS so_tai_khoan_cuoi,
            coalesce(v.so_tai_khoan IS DISTINCT FROM pg_catalog.lag(v.so_tai_khoan) OVER (ORDER BY v.thu_tu)
                     AND pg_catalog.lag(v.thu_tu) OVER (ORDER BY v.thu_tu) IS NOT NULL, false) AS doi_tai_khoan
       FROM public.supplier_passport_versions v
      WHERE v.supplier_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
      ORDER BY v.thu_tu DESC`,
    [input.supplierId],
  );
  const { rows: link } = await client.query<{ created_at: Date; expires_at: Date; da_dung: boolean; da_thu_hoi: boolean }>(
    `SELECT t.created_at, t.expires_at, (t.consumed_at IS NOT NULL) AS da_dung, (t.revoked_at IS NOT NULL) AS da_thu_hoi
       FROM public.supplier_passport_tokens t
      WHERE t.supplier_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 1`,
    [input.supplierId],
  );

  const m = moi[0];
  if (m !== undefined) {
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "PASSPORT_VIEWED",
      resourceType: "supplier",
      resourceId: input.supplierId,
      payload: { thuTu: Number(m.thu_tu) },
    });
  }
  const l = link[0];
  return {
    supplierId: input.supplierId,
    mstBanGhi,
    phienBanMoiNhat:
      m === undefined
        ? null
        : {
            thuTu: Number(m.thu_tu),
            legalName: m.legal_name,
            taxCode: m.tax_code,
            nguoiDaiDien: m.nguoi_dai_dien,
            diaChi: m.dia_chi,
            nganHang: m.ngan_hang,
            soTaiKhoan: m.so_tai_khoan,
            chungNhan: m.chung_nhan,
            nhomHang: m.nhom_hang,
            createdAt: m.created_at,
            mstKhop: mstBanGhi !== null && m.tax_code === mstBanGhi,
          },
    cacPhienBan: lichSu.map((r) => ({
      thuTu: Number(r.thu_tu),
      createdAt: r.created_at,
      soTaiKhoanCuoi: r.so_tai_khoan_cuoi,
      doiTaiKhoan: r.doi_tai_khoan,
    })),
    linkGanNhat: l === undefined ? null : { guiLuc: l.created_at, hetHanAt: l.expires_at, daDung: l.da_dung, daThuHoi: l.da_thu_hoi },
  };
}
