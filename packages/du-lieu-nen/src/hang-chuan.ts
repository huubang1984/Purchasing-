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
  // [S1.9101 / S4.2b] `CHECK` không tên của `079` trên bí danh đơn vị của tổ chức — tên Postgres tự đặt.
  uom_aliases_bi_danh_sach_check: "CHUOI_RONG",
};

/**
 * **[S1.9101 / S4.2b]** Câu cho người đọc của từng mã đến từ ràng buộc — màn `/du-lieu` in thẳng thông điệp của 422, và lượt đi thử
 * T4 thấy người quản lý dữ liệu nhận *"dữ liệu nền từ chối: MA_DA_CO"* trong khi mọi lần từ chối khác có câu. Mã vẫn đi kèm, trong
 * ngoặc: người gọi đọc `ma`, không so câu.
 */
const CAU_THEO_MA: Readonly<Partial<Record<DuLieuNenError["ma"], string>>> = {
  CAN_ITEM_MANAGE: "người ghi không giữ quyền quản lý dữ liệu",
  MA_DA_CO: "mã hàng chuẩn đã có trong tổ chức",
  MA_SAI_HINH_DANG: "mã hàng chuẩn phải viết hoa, bắt đầu bằng chữ hoặc số, chỉ chữ, số, chấm, gạch — tối đa 40 ký tự",
  TEN_SAI_HINH_DANG: "tên dài 1 đến 300 ký tự, không khoảng trắng ở hai đầu",
  THUOC_TINH_SAI_HINH_DANG: "thuộc tính là cặp khoá viết thường → chuỗi không rỗng, và mỗi thuộc tính trọng yếu phải có giá trị",
  CHUOI_RONG: "chuỗi không còn gì sau khi làm sạch",
  QUY_DOI_CHUNG_DA_CO: "hai đầu cùng thứ nguyên của danh mục — quy đổi chung đã có",
  KHONG_CO_HANG_CHUAN: "không có hàng chuẩn này trong tổ chức",
};

/** Chạy một lần ghi; lần từ chối của một ràng buộc có tên thành `DuLieuNenError`. Dùng chung trong gói, không ra mặt tiền. */
export async function ghiDuLieuNen<T>(viec: () => Promise<T>): Promise<T> {
  try {
    return await viec();
  } catch (e) {
    const rang = (e as { constraint?: string }).constraint;
    const ma = rang === undefined ? undefined : MA_THEO_RANG_BUOC[rang];
    if (ma !== undefined) throw new DuLieuNenError(ma, `${CAU_THEO_MA[ma] ?? "dữ liệu nền từ chối"} (${ma})`);
    throw e;
  }
}

/**
 * Mã của danh mục mà một chuỗi đơn vị do NGƯỜI QUẢN LÝ DỮ LIỆU nhập quy về — `NULL` nếu không có. Khác chuỗi tự do trên dòng
 * RFQ (`quy_doi_don_vi` không bao giờ khớp mã trực tiếp): ở đây người nhập đang chọn một đơn vị của danh mục, nên dạng sạch
 * TRÙNG một mã (*"m"*, *"T"*) là chính mã ấy; không trùng thì qua bí danh (của tổ chức, rồi chung) như mọi nơi khác.
 */
export async function maDanhMuc(client: pg.PoolClient, orgId: string, chuoi: string): Promise<string | null> {
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
  return ghiDuLieuNen(async () => {
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
  return ghiDuLieuNen(async () => {
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
  return ghiDuLieuNen(async () => {
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

/**
 * Rút một bí danh đang hiệu lực. Không có bí danh nào đang hiệu lực cho chuỗi ấy thì từ chối — hàng rút không để làm nhiễu.
 * **[S1.9101 / S4.2b]** `hangChuanId`: người gọi đang đứng ở ĐÚNG hàng chuẩn ấy (route `/items/:itemId/aliases/withdraw`) —
 * bí danh đang trỏ sang hàng khác thì cũng là *"không có"*: một nút rút trên trang của D10 không được rút bí danh của D32.
 */
export async function rutBiDanhHang(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly biDanh: string; readonly hangChuanId?: string; readonly actorSessionId: string },
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
  if (hangChuanId === null || (input.hangChuanId !== undefined && hangChuanId !== input.hangChuanId)) {
    throw new DuLieuNenError("KHONG_CO_BI_DANH", "không có bí danh đang hiệu lực cho chuỗi này ở hàng chuẩn này");
  }
  return ghiDuLieuNen(async () => {
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
  return ghiDuLieuNen(async () => {
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
  return ghiDuLieuNen(async () => {
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
  const { rows } = await client.query<HangHangChuan>(
    "SELECT i.id, i.ma, i.don_vi_goc, v.ten, v.thuoc_tinh, v.thuoc_tinh_trong_yeu, v.trang_thai, v.seq::pg_catalog.text AS seq " +
      "FROM public.canonical_items i " +
      "JOIN public.canonical_item_versions v ON v.org_id OPERATOR(pg_catalog.=) i.org_id " +
      "AND v.canonical_item_id OPERATOR(pg_catalog.=) i.id " +
      "WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND i.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
      "ORDER BY v.seq DESC LIMIT 1",
    [orgId, hangChuanId],
  );
  const h = rows[0];
  return h === undefined ? null : hangChuanTuHang(h);
}

interface HangHangChuan {
  readonly id: string;
  readonly ma: string;
  readonly don_vi_goc: string;
  readonly ten: string;
  readonly thuoc_tinh: Record<string, string>;
  readonly thuoc_tinh_trong_yeu: string[];
  readonly trang_thai: "DANG_DUNG" | "NGUNG_DUNG";
  readonly seq: string;
}

function hangChuanTuHang(h: HangHangChuan): HangChuan {
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

/**
 * Trần của một lượt liệt kê. Router của `apps/api` không đọc query (⑵, E6), nên `GET /items` không tìm được ở máy chủ: nó trả
 * tối đa chừng này hàng và nói còn hay hết (`conNua`); màn lọc trên danh sách ấy.
 */
export const TRAN_LIET_KE_HANG_CHUAN = 500;

/**
 * [S1.9101 / S4.2b] Danh sách hàng chuẩn, mỗi hàng với phiên bản MỚI NHẤT, xếp theo mã, tối đa `TRAN_LIET_KE_HANG_CHUAN`.
 * `q` so trên dạng SẠCH (`chuoi_sach` bản 1 — một luật, ở SQL) của *"mã tên"*: *"thép d10"* tìm được *"THEP-D10"*. Hàng đã
 * `NGUNG_DUNG` vẫn có mặt, mang trạng thái của nó — ẩn đi là giấu một thước đã từng được dùng.
 */
export async function lietKeHangChuan(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly q?: string | null } = {},
): Promise<{ readonly hangChuan: readonly HangChuan[]; readonly conNua: boolean }> {
  await assertTenantBound(client, orgId, "lietKeHangChuan");
  const q = input.q?.trim() ?? "";
  // Đọc thêm MỘT hàng để biết còn hay hết mà không cần một câu đếm thứ hai.
  const { rows } = await client.query<HangHangChuan>(
    "SELECT h.id, h.ma, h.don_vi_goc, h.ten, h.thuoc_tinh, h.thuoc_tinh_trong_yeu, h.trang_thai, h.seq FROM (" +
      "SELECT DISTINCT ON (i.id) i.id, i.ma, i.don_vi_goc, v.ten, v.thuoc_tinh, v.thuoc_tinh_trong_yeu, v.trang_thai, " +
      "v.seq::pg_catalog.text AS seq " +
      "FROM public.canonical_items i " +
      "JOIN public.canonical_item_versions v ON v.org_id OPERATOR(pg_catalog.=) i.org_id " +
      "AND v.canonical_item_id OPERATOR(pg_catalog.=) i.id " +
      "WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
      "ORDER BY i.id, v.seq DESC) h " +
      "WHERE $2::pg_catalog.text OPERATOR(pg_catalog.=) '' " +
      "OR pg_catalog.strpos(public.chuoi_sach(h.ma OPERATOR(pg_catalog.||) ' ' OPERATOR(pg_catalog.||) h.ten), " +
      "public.chuoi_sach($2::pg_catalog.text)) OPERATOR(pg_catalog.>) 0 " +
      "ORDER BY h.ma LIMIT $3::pg_catalog.int4",
    [orgId, q, TRAN_LIET_KE_HANG_CHUAN + 1],
  );
  return { hangChuan: rows.slice(0, TRAN_LIET_KE_HANG_CHUAN).map(hangChuanTuHang), conNua: rows.length > TRAN_LIET_KE_HANG_CHUAN };
}

export interface PhienBanHangChuan {
  readonly seq: string;
  readonly ten: string;
  readonly thuocTinh: Readonly<Record<string, string>>;
  readonly thuocTinhTrongYeu: readonly string[];
  readonly trangThai: "DANG_DUNG" | "NGUNG_DUNG";
  readonly ghiLuc: string;
  readonly tacGia: string;
}

export interface BiDanhHangHieuLuc {
  readonly biDanhSach: string;
  readonly seq: string;
  readonly ghiLuc: string;
  readonly tacGia: string;
}

export interface QuyDoiRiengHieuLuc {
  readonly tuDonVi: string;
  readonly sangDonVi: string;
  readonly heSo: string;
  readonly seq: string;
  readonly ghiLuc: string;
  readonly tacGia: string;
}

export interface ChiTietHangChuan {
  readonly hangChuan: HangChuan;
  /** Mọi phiên bản, mới nhất trước. */
  readonly phienBan: readonly PhienBanHangChuan[];
  /** Bí danh ĐANG trỏ về hàng này: hàng mới nhất theo `seq` của từng chuỗi, không phải hàng rút, đúng hàng chuẩn này. */
  readonly biDanh: readonly BiDanhHangHieuLuc[];
  /** Quy đổi riêng ĐANG hiệu lực: hàng mới nhất theo `seq` của từng cặp (tu, sang), không phải hàng rút. */
  readonly quyDoi: readonly QuyDoiRiengHieuLuc[];
}

/**
 * [S1.9101 / S4.2b] Một hàng chuẩn cùng lịch sử phiên bản, bí danh và quy đổi riêng đang hiệu lực — trang chi tiết của màn
 * `/du-lieu`. `tacGia` là họ tên người ghi (spec S4 §8.2: *"ánh xạ nào cũng có chủ thể và thời điểm"* — và thước nào cũng vậy).
 * Hiệu lực tính theo `seq` NGAY BÂY GIỜ; hiệu lực tại một mốc là việc của `quy_doi_don_vi(p_moc)`, không phải của màn này.
 */
export async function docChiTietHangChuan(
  client: pg.PoolClient,
  orgId: string,
  hangChuanId: string,
): Promise<ChiTietHangChuan | null> {
  const hangChuan = await docHangChuan(client, orgId, hangChuanId);
  if (hangChuan === null) return null;
  const phienBan = await client.query<{
    seq: string;
    ten: string;
    thuoc_tinh: Record<string, string>;
    thuoc_tinh_trong_yeu: string[];
    trang_thai: "DANG_DUNG" | "NGUNG_DUNG";
    ghi_luc: Date;
    tac_gia: string;
  }>(
    "SELECT v.seq::pg_catalog.text AS seq, v.ten, v.thuoc_tinh, v.thuoc_tinh_trong_yeu, v.trang_thai, v.ghi_luc, u.full_name AS tac_gia " +
      "FROM public.canonical_item_versions v " +
      "JOIN public.users u ON u.org_id OPERATOR(pg_catalog.=) v.org_id AND u.id OPERATOR(pg_catalog.=) v.tac_gia " +
      "WHERE v.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND v.canonical_item_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
      "ORDER BY v.seq DESC",
    [orgId, hangChuanId],
  );
  const biDanh = await client.query<{ bi_danh_sach: string; seq: string; ghi_luc: Date; tac_gia: string }>(
    "SELECT a.bi_danh_sach, a.seq, a.ghi_luc, u.full_name AS tac_gia FROM (" +
      "SELECT DISTINCT ON (x.bi_danh_sach) x.bi_danh_sach, x.canonical_item_id, x.rut, x.seq::pg_catalog.text AS seq, x.ghi_luc, x.tac_gia " +
      "FROM public.item_aliases x WHERE x.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
      "ORDER BY x.bi_danh_sach, x.seq DESC) a " +
      "JOIN public.users u ON u.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND u.id OPERATOR(pg_catalog.=) a.tac_gia " +
      "WHERE NOT a.rut AND a.canonical_item_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
      "ORDER BY a.bi_danh_sach",
    [orgId, hangChuanId],
  );
  const quyDoi = await client.query<{ tu_don_vi: string; sang_don_vi: string; he_so: string; seq: string; ghi_luc: Date; tac_gia: string }>(
    "SELECT c.tu_don_vi, c.sang_don_vi, c.he_so, c.seq, c.ghi_luc, u.full_name AS tac_gia FROM (" +
      "SELECT DISTINCT ON (x.tu_don_vi, x.sang_don_vi) x.tu_don_vi, x.sang_don_vi, x.he_so::pg_catalog.text AS he_so, x.rut, " +
      "x.seq::pg_catalog.text AS seq, x.ghi_luc, x.tac_gia " +
      "FROM public.item_uom_conversions x WHERE x.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
      "AND x.canonical_item_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid " +
      "ORDER BY x.tu_don_vi, x.sang_don_vi, x.seq DESC) c " +
      "JOIN public.users u ON u.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND u.id OPERATOR(pg_catalog.=) c.tac_gia " +
      "WHERE NOT c.rut ORDER BY c.tu_don_vi, c.sang_don_vi",
    [orgId, hangChuanId],
  );
  return {
    hangChuan,
    phienBan: phienBan.rows.map((r) => ({
      seq: r.seq,
      ten: r.ten,
      thuocTinh: r.thuoc_tinh,
      thuocTinhTrongYeu: r.thuoc_tinh_trong_yeu,
      trangThai: r.trang_thai,
      ghiLuc: r.ghi_luc.toISOString(),
      tacGia: r.tac_gia,
    })),
    biDanh: biDanh.rows.map((r) => ({ biDanhSach: r.bi_danh_sach, seq: r.seq, ghiLuc: r.ghi_luc.toISOString(), tacGia: r.tac_gia })),
    quyDoi: quyDoi.rows.map((r) => ({
      tuDonVi: r.tu_don_vi,
      sangDonVi: r.sang_don_vi,
      heSo: r.he_so,
      seq: r.seq,
      ghiLuc: r.ghi_luc.toISOString(),
      tacGia: r.tac_gia,
    })),
  };
}
