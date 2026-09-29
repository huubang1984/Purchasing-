// [S1.197 / S4.2a] Hàng chuẩn, bí danh hàng và quy đổi riêng (spec S4 §4.2, §4.3). Mọi hàm GHI ở đây:
//   ⑴ `assertTenantBound` trước mọi thứ, rồi tác giả DẪN XUẤT từ phiên (`resolveSessionActor`, ADR-016);
//   ⑵ một câu INSERT vào bảng chỉ-ghi-thêm — `seq`, `ghi_luc` do trigger khuôn L1 đặt, người ghi phải giữ
//      `item.manage` (trigger `du_lieu_nen_kiem_quyen_ghi`, L3); tầng gói không kiểm quyền lần hai: cổng ở tầng
//      ứng dụng là route của S4.2b (ADR-016), cổng ở CSDL là trigger — một lần từ chối đọc được bằng mã;
//   ⑶ một hàng sổ kiểm toán trong CÙNG giao dịch — khuôn `createSupplier`: hàng dữ liệu và hàng sổ sống chết
//      cùng nhau.
// Làm sạch chuỗi và phân giải đơn vị CHỈ ở SQL (`chuoi_sach`, `don_vi_tai`) — tầng gói không cài lại luật.
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { resolveSessionActor } from "@trustprocure/identity";

/** Lần từ chối của tầng dữ liệu nền, mang MÃ đọc được — không so thông báo. */
export class DuLieuNenError extends Error {
  constructor(
    readonly ma:
      | "CAN_ITEM_MANAGE"
      | "MA_DA_CO"
      | "MA_SAI_HINH_DANG"
      | "DON_VI_KHONG_CO_TRONG_DANH_MUC"
      | "THUOC_TINH_SAI_HINH_DANG"
      | "TEN_SAI_HINH_DANG"
      | "CHUOI_RONG"
      | "KHONG_CO_HANG_CHUAN"
      | "KHONG_CO_BI_DANH"
      | "KHONG_CO_QUY_DOI"
      | "QUY_DOI_CHUNG_DA_CO"
      | "HE_SO_SAI_HINH_DANG",
    message: string,
  ) {
    super(message);
    this.name = "DuLieuNenError";
  }
}

const HE_SO = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/u;

/** Ràng buộc CSDL → mã. Mọi lỗi khác đi nguyên. */
const MA_THEO_RANG_BUOC: Readonly<Record<string, DuLieuNenError["ma"]>> = {
  du_lieu_nen_can_item_manage: "CAN_ITEM_MANAGE",
  canonical_items_org_id_ma_key: "MA_DA_CO",
  canonical_items_ma_hinh_dang: "MA_SAI_HINH_DANG",
  canonical_item_versions_ten_hinh_dang: "TEN_SAI_HINH_DANG",
  canonical_item_versions_thuoc_tinh_hinh_dang: "THUOC_TINH_SAI_HINH_DANG",
  canonical_item_versions_trong_yeu_co_gia_tri: "THUOC_TINH_SAI_HINH_DANG",
  item_aliases_bi_danh_sach_da_lam_sach: "CHUOI_RONG",
  item_uom_conversions_tu_don_vi_da_lam_sach: "CHUOI_RONG",
  item_uom_conversions_hai_dau_khac: "QUY_DOI_CHUNG_DA_CO",
  canonical_item_versions_org_id_canonical_item_id_fkey: "KHONG_CO_HANG_CHUAN",
  item_aliases_org_id_canonical_item_id_fkey: "KHONG_CO_HANG_CHUAN",
  item_uom_conversions_org_id_canonical_item_id_fkey: "KHONG_CO_HANG_CHUAN",
};

async function ghi<T>(viec: () => Promise<T>): Promise<T> {
  try {
    return await viec();
  } catch (e) {
    const rang = (e as { constraint?: string }).constraint;
    const ma = rang === undefined ? undefined : MA_THEO_RANG_BUOC[rang];
    if (ma !== undefined) throw new DuLieuNenError(ma, `dữ liệu nền từ chối: ${ma}`);
    throw e;
  }
}

/**
 * Mã của danh mục mà một chuỗi đơn vị do NGƯỜI QUẢN LÝ DỮ LIỆU nhập quy về — `NULL` nếu không có. Khác chuỗi tự do trên dòng
 * RFQ (`quy_doi_don_vi` không bao giờ khớp mã trực tiếp): ở đây người nhập đang chọn một đơn vị của danh mục, nên dạng sạch
 * TRÙNG một mã (*"m"*, *"T"*) là chính mã ấy; không trùng thì qua bí danh (của tổ chức, rồi chung) như mọi nơi khác.
 */
async function maDanhMuc(client: pg.PoolClient, orgId: string, chuoi: string): Promise<string | null> {
  const { rows } = await client.query<{ ma: string | null }>(
    "SELECT coalesce((SELECT u.code FROM public.uom_units u WHERE u.code OPERATOR(pg_catalog.=) public.chuoi_sach($2::pg_catalog.text)), " +
      "public.don_vi_tai($1::pg_catalog.uuid, $2::pg_catalog.text, pg_catalog.clock_timestamp())) AS ma",
    [orgId, chuoi],
  );
  return rows[0]?.ma ?? null;
}

export interface TaoHangChuanInput {
  /** Mã hàng chuẩn, viết hoa: `THEP-D10`. */
  readonly ma: string;
  /** Chuỗi đơn vị — phải quy về một mã của `uom_units`; không nhận đơn vị đóng gói. */
  readonly donViGoc: string;
  readonly ten: string;
  readonly thuocTinh?: Readonly<Record<string, string>>;
  readonly thuocTinhTrongYeu?: readonly string[];
  readonly actorSessionId: string;
}

export interface HangChuanMoi {
  readonly id: string;
  readonly ma: string;
  readonly donViGoc: string;
  /** `seq` của phiên bản đầu. */
  readonly phienBanSeq: string;
}

/** Tạo danh tính hàng chuẩn và phiên bản đầu của nó trong một giao dịch của người gọi. */
export async function taoHangChuan(client: pg.PoolClient, orgId: string, input: TaoHangChuanInput): Promise<HangChuanMoi> {
  await assertTenantBound(client, orgId, "taoHangChuan");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const donViGoc = await maDanhMuc(client, orgId, input.donViGoc);
  if (donViGoc === null) {
    throw new DuLieuNenError("DON_VI_KHONG_CO_TRONG_DANH_MUC", "đơn vị gốc phải là một đơn vị của danh mục, không phải đơn vị đóng gói");
  }
  return ghi(async () => {
    const hang = (
      await client.query<{ id: string }>(
        "INSERT INTO public.canonical_items (org_id, ma, don_vi_goc, tac_gia, session_id) " +
          "VALUES ($1::pg_catalog.uuid, $2::pg_catalog.text, $3::pg_catalog.text, $4::pg_catalog.uuid, $5::pg_catalog.uuid) RETURNING id",
        [orgId, input.ma, donViGoc, actor.id, actor.sessionId],
      )
    ).rows[0];
    if (hang === undefined) throw new Error("câu chèn canonical_items không trả hàng nào");
    const phienBanSeq = await chenPhienBan(client, orgId, hang.id, input, "DANG_DUNG", actor);
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "ITEM_CREATED",
      resourceType: "canonical_item",
      resourceId: hang.id,
      payload: { ma: input.ma, donViGoc },
    });
    return { id: hang.id, ma: input.ma, donViGoc, phienBanSeq };
  });
}

async function chenPhienBan(
  client: pg.PoolClient,
  orgId: string,
  hangChuanId: string,
  input: { readonly ten: string; readonly thuocTinh?: Readonly<Record<string, string>>; readonly thuocTinhTrongYeu?: readonly string[] },
  trangThai: "DANG_DUNG" | "NGUNG_DUNG",
  actor: { readonly id: string; readonly sessionId: string },
): Promise<string> {
  const { rows } = await client.query<{ seq: string }>(
    "INSERT INTO public.canonical_item_versions " +
      "(org_id, canonical_item_id, ten, thuoc_tinh, thuoc_tinh_trong_yeu, trang_thai, tac_gia, session_id) " +
      "VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.text, $4::pg_catalog.jsonb, $5::pg_catalog.text[], " +
      "$6::pg_catalog.text, $7::pg_catalog.uuid, $8::pg_catalog.uuid) RETURNING seq::pg_catalog.text AS seq",
    [
      orgId,
      hangChuanId,
      input.ten,
      JSON.stringify(input.thuocTinh ?? {}),
      [...(input.thuocTinhTrongYeu ?? [])],
      trangThai,
      actor.id,
      actor.sessionId,
    ],
  );
  const seq = rows[0]?.seq;
  if (seq === undefined) throw new Error("câu chèn canonical_item_versions không trả hàng nào");
  return seq;
}

export interface TaoPhienBanInput {
  readonly hangChuanId: string;
  readonly ten: string;
  readonly thuocTinh?: Readonly<Record<string, string>>;
  readonly thuocTinhTrongYeu?: readonly string[];
  readonly trangThai?: "DANG_DUNG" | "NGUNG_DUNG";
  readonly actorSessionId: string;
}

/** Sửa hàng chuẩn là một PHIÊN BẢN mới — danh tính (`ma`, `don_vi_goc`) không đổi. */
export async function taoPhienBanHangChuan(
  client: pg.PoolClient,
  orgId: string,
  input: TaoPhienBanInput,
): Promise<{ readonly seq: string }> {
  await assertTenantBound(client, orgId, "taoPhienBanHangChuan");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  return ghi(async () => {
    const seq = await chenPhienBan(client, orgId, input.hangChuanId, input, input.trangThai ?? "DANG_DUNG", actor);
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "ITEM_VERSION_CREATED",
      resourceType: "canonical_item",
      resourceId: input.hangChuanId,
      payload: { seq, trangThai: input.trangThai ?? "DANG_DUNG" },
    });
    return { seq };
  });
}

export interface KhaiBiDanhHangInput {
  readonly hangChuanId: string;
  /** Chuỗi tự do — CSDL làm sạch (`chuoi_sach` bản 1). */
  readonly biDanh: string;
  readonly actorSessionId: string;
}

/** Khai một bí danh; bí danh đã trỏ sang hàng khác thì hàng mới nhất theo `seq` thắng. */
export async function khaiBiDanhHang(
  client: pg.PoolClient,
  orgId: string,
  input: KhaiBiDanhHangInput,
): Promise<{ readonly biDanhSach: string; readonly seq: string }> {
  await assertTenantBound(client, orgId, "khaiBiDanhHang");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  return ghi(async () => {
    const hang = (
      await client.query<{ bi_danh_sach: string; seq: string }>(
        "INSERT INTO public.item_aliases (org_id, bi_danh_sach, canonical_item_id, rut, tac_gia, session_id) " +
          "VALUES ($1::pg_catalog.uuid, public.chuoi_sach($2::pg_catalog.text), $3::pg_catalog.uuid, false, $4::pg_catalog.uuid, $5::pg_catalog.uuid) " +
          "RETURNING bi_danh_sach, seq::pg_catalog.text AS seq",
        [orgId, input.biDanh, input.hangChuanId, actor.id, actor.sessionId],
      )
    ).rows[0];
    if (hang === undefined) throw new Error("câu chèn item_aliases không trả hàng nào");
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "ITEM_ALIAS_DECLARED",
      resourceType: "canonical_item",
      resourceId: input.hangChuanId,
      payload: { biDanhSach: hang.bi_danh_sach, seq: hang.seq },
    });
    return { biDanhSach: hang.bi_danh_sach, seq: hang.seq };
  });
}

/** Rút một bí danh đang hiệu lực. Không có bí danh nào đang hiệu lực cho chuỗi ấy thì từ chối — hàng rút không để làm nhiễu. */
export async function rutBiDanhHang(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly biDanh: string; readonly actorSessionId: string },
): Promise<{ readonly biDanhSach: string; readonly seq: string }> {
  await assertTenantBound(client, orgId, "rutBiDanhHang");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const hienTai = (
    await client.query<{ canonical_item_id: string | null }>(
      "SELECT a.canonical_item_id FROM public.item_aliases a " +
        "WHERE a.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
        "AND a.bi_danh_sach OPERATOR(pg_catalog.=) public.chuoi_sach($2::pg_catalog.text) " +
        "ORDER BY a.seq DESC LIMIT 1",
      [orgId, input.biDanh],
    )
  ).rows[0];
  const hangChuanId = hienTai?.canonical_item_id ?? null;
  if (hangChuanId === null) throw new DuLieuNenError("KHONG_CO_BI_DANH", "không có bí danh đang hiệu lực cho chuỗi này");
  return ghi(async () => {
    const hang = (
      await client.query<{ bi_danh_sach: string; seq: string }>(
        "INSERT INTO public.item_aliases (org_id, bi_danh_sach, canonical_item_id, rut, tac_gia, session_id) " +
          "VALUES ($1::pg_catalog.uuid, public.chuoi_sach($2::pg_catalog.text), NULL, true, $3::pg_catalog.uuid, $4::pg_catalog.uuid) " +
          "RETURNING bi_danh_sach, seq::pg_catalog.text AS seq",
        [orgId, input.biDanh, actor.id, actor.sessionId],
      )
    ).rows[0];
    if (hang === undefined) throw new Error("câu chèn item_aliases không trả hàng nào");
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "ITEM_ALIAS_WITHDRAWN",
      resourceType: "canonical_item",
      resourceId: hangChuanId,
      payload: { biDanhSach: hang.bi_danh_sach, seq: hang.seq },
    });
    return { biDanhSach: hang.bi_danh_sach, seq: hang.seq };
  });
}

export interface KhaiQuyDoiRiengInput {
  readonly hangChuanId: string;
  /** Đơn vị đóng gói (*"cây"*) hay một đơn vị của danh mục KHÁC thứ nguyên với `sangDonVi` (*"mét"* → kg). */
  readonly tuDonVi: string;
  /** Phải quy về một mã của danh mục. */
  readonly sangDonVi: string;
  /** `1 tuDonVi = heSo sangDonVi`, chuỗi thập phân dương — không đi qua `number`. */
  readonly heSo: string;
  readonly actorSessionId: string;
}

/**
 * Khai một quy đổi riêng (L4 vế ⑵). Đầu `tu` lưu dưới dạng MÃ nếu chuỗi quy về một mã, không thì chuỗi đã làm sạch —
 * đúng khoá mà `quy_doi_don_vi` so. Hai đầu cùng thứ nguyên của danh mục thì từ chối: quy đổi chung đã có và đi trước,
 * nên một hệ số riêng ở đó là thước thứ hai không bao giờ được đọc.
 */
export async function khaiQuyDoiRieng(
  client: pg.PoolClient,
  orgId: string,
  input: KhaiQuyDoiRiengInput,
): Promise<{ readonly tuDonVi: string; readonly sangDonVi: string; readonly seq: string }> {
  await assertTenantBound(client, orgId, "khaiQuyDoiRieng");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  if (!HE_SO.test(input.heSo) || /^0(?:\.0+)?$/u.test(input.heSo)) {
    throw new DuLieuNenError("HE_SO_SAI_HINH_DANG", "hệ số phải là số thập phân dương");
  }
  const { tu, sang } = await haiDau(client, orgId, input.tuDonVi, input.sangDonVi);
  return ghi(async () => {
    const hang = (
      await client.query<{ seq: string }>(
        "INSERT INTO public.item_uom_conversions (org_id, canonical_item_id, tu_don_vi, sang_don_vi, he_so, rut, tac_gia, session_id) " +
          "VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.text, $4::pg_catalog.text, $5::pg_catalog.numeric, false, " +
          "$6::pg_catalog.uuid, $7::pg_catalog.uuid) RETURNING seq::pg_catalog.text AS seq",
        [orgId, input.hangChuanId, tu, sang, input.heSo, actor.id, actor.sessionId],
      )
    ).rows[0];
    if (hang === undefined) throw new Error("câu chèn item_uom_conversions không trả hàng nào");
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "ITEM_UOM_CONVERSION_DECLARED",
      resourceType: "canonical_item",
      resourceId: input.hangChuanId,
      payload: { tuDonVi: tu, sangDonVi: sang, heSo: input.heSo, seq: hang.seq },
    });
    return { tuDonVi: tu, sangDonVi: sang, seq: hang.seq };
  });
}

/** Rút một quy đổi riêng đang hiệu lực của đúng cặp (tu, sang). */
export async function rutQuyDoiRieng(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly hangChuanId: string; readonly tuDonVi: string; readonly sangDonVi: string; readonly actorSessionId: string },
): Promise<{ readonly seq: string }> {
  await assertTenantBound(client, orgId, "rutQuyDoiRieng");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const { tu, sang } = await haiDau(client, orgId, input.tuDonVi, input.sangDonVi);
  const hienTai = (
    await client.query<{ rut: boolean }>(
      "SELECT c.rut FROM public.item_uom_conversions c " +
        "WHERE c.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
        "AND c.canonical_item_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
        "AND c.tu_don_vi OPERATOR(pg_catalog.=) $3::pg_catalog.text " +
        "AND c.sang_don_vi OPERATOR(pg_catalog.=) $4::pg_catalog.text " +
        "ORDER BY c.seq DESC LIMIT 1",
      [orgId, input.hangChuanId, tu, sang],
    )
  ).rows[0];
  if (hienTai === undefined || hienTai.rut) throw new DuLieuNenError("KHONG_CO_QUY_DOI", "không có quy đổi riêng đang hiệu lực cho cặp này");
  return ghi(async () => {
    const hang = (
      await client.query<{ seq: string }>(
        "INSERT INTO public.item_uom_conversions (org_id, canonical_item_id, tu_don_vi, sang_don_vi, he_so, rut, tac_gia, session_id) " +
          "VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.text, $4::pg_catalog.text, NULL, true, " +
          "$5::pg_catalog.uuid, $6::pg_catalog.uuid) RETURNING seq::pg_catalog.text AS seq",
        [orgId, input.hangChuanId, tu, sang, actor.id, actor.sessionId],
      )
    ).rows[0];
    if (hang === undefined) throw new Error("câu chèn item_uom_conversions không trả hàng nào");
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "ITEM_UOM_CONVERSION_WITHDRAWN",
      resourceType: "canonical_item",
      resourceId: input.hangChuanId,
      payload: { tuDonVi: tu, sangDonVi: sang, seq: hang.seq },
    });
    return { seq: hang.seq };
  });
}

/** Khoá hai đầu của một quy đổi riêng, và từ chối cặp mà quy đổi chung đã phủ. */
async function haiDau(
  client: pg.PoolClient,
  orgId: string,
  tuDonVi: string,
  sangDonVi: string,
): Promise<{ readonly tu: string; readonly sang: string }> {
  const sang = await maDanhMuc(client, orgId, sangDonVi);
  if (sang === null) throw new DuLieuNenError("DON_VI_KHONG_CO_TRONG_DANH_MUC", "đầu `sang` phải là một đơn vị của danh mục");
  const maTu = await maDanhMuc(client, orgId, tuDonVi);
  if (maTu !== null) {
    const { rows } = await client.query<{ cung: boolean }>(
      "SELECT a.thu_nguyen OPERATOR(pg_catalog.=) b.thu_nguyen AS cung FROM public.uom_units a, public.uom_units b " +
        "WHERE a.code OPERATOR(pg_catalog.=) $1::pg_catalog.text AND b.code OPERATOR(pg_catalog.=) $2::pg_catalog.text",
      [maTu, sang],
    );
    if (rows[0]?.cung === true) {
      throw new DuLieuNenError("QUY_DOI_CHUNG_DA_CO", "hai đầu cùng thứ nguyên của danh mục — quy đổi chung đã có");
    }
    return { tu: maTu, sang };
  }
  const { rows } = await client.query<{ tu: string }>("SELECT public.chuoi_sach($1::pg_catalog.text) AS tu", [tuDonVi]);
  const tu = rows[0]?.tu;
  if (tu === undefined) throw new Error("chuoi_sach không trả hàng nào");
  return { tu, sang };
}

export interface HangChuan {
  readonly id: string;
  readonly ma: string;
  readonly donViGoc: string;
  readonly ten: string;
  readonly thuocTinh: Readonly<Record<string, string>>;
  readonly thuocTinhTrongYeu: readonly string[];
  readonly trangThai: "DANG_DUNG" | "NGUNG_DUNG";
  readonly phienBanSeq: string;
}

/** Danh tính + phiên bản MỚI NHẤT theo `seq`. Hàng chuẩn không mang giá, nên đọc nó không phải đọc giá (spec §4.3). */
export async function docHangChuan(client: pg.PoolClient, orgId: string, hangChuanId: string): Promise<HangChuan | null> {
  await assertTenantBound(client, orgId, "docHangChuan");
  const { rows } = await client.query<{
    id: string;
    ma: string;
    don_vi_goc: string;
    ten: string;
    thuoc_tinh: Record<string, string>;
    thuoc_tinh_trong_yeu: string[];
    trang_thai: "DANG_DUNG" | "NGUNG_DUNG";
    seq: string;
  }>(
    "SELECT i.id, i.ma, i.don_vi_goc, v.ten, v.thuoc_tinh, v.thuoc_tinh_trong_yeu, v.trang_thai, v.seq::pg_catalog.text AS seq " +
      "FROM public.canonical_items i " +
      "JOIN public.canonical_item_versions v ON v.org_id OPERATOR(pg_catalog.=) i.org_id " +
      "AND v.canonical_item_id OPERATOR(pg_catalog.=) i.id " +
      "WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND i.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
      "ORDER BY v.seq DESC LIMIT 1",
    [orgId, hangChuanId],
  );
  const h = rows[0];
  if (h === undefined) return null;
  return {
    id: h.id,
    ma: h.ma,
    donViGoc: h.don_vi_goc,
    ten: h.ten,
    thuocTinh: h.thuoc_tinh,
    thuocTinhTrongYeu: h.thuoc_tinh_trong_yeu,
    trangThai: h.trang_thai,
    phienBanSeq: h.seq,
  };
}
