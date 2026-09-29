// [S1.9101 / S4.2b] Danh mục đơn vị và bí danh đơn vị của TỔ CHỨC (spec S4 §4.2). Bảng `uom_aliases` có từ S4.1 (`079`),
// cổng `item.manage` ở CSDL có từ S4.2a (`083`); vòng này thêm đường GHI của gói — cùng ba bước với `hang-chuan.ts`: phiên
// dẫn xuất tác giả, một câu INSERT chỉ-ghi-thêm (`seq`, `ghi_luc` do trigger khuôn L1 đặt), một hàng sổ trong cùng giao dịch.
//
// Đổi *"MT"* từ `t` sang `m` là đổi thước 1000 lần: nó là một HÀNG MỚI mang tác giả và mốc, không phải một lần sửa (góc A⑧).
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { resolveSessionActor } from "@trustprocure/identity";
import { DuLieuNenError, ghiDuLieuNen, maDanhMuc } from "./hang-chuan.js";

export interface DonViDanhMuc {
  readonly code: string;
  readonly thuNguyen: "KHOI_LUONG" | "CHIEU_DAI" | "DIEN_TICH" | "THE_TICH" | "DEM";
  /** Chuỗi thập phân như Postgres in ra — không đi qua `number`. */
  readonly heSoVeGoc: string;
}

export interface BiDanhDonViHieuLuc {
  readonly biDanhSach: string;
  readonly code: string;
  readonly seq: string;
  readonly ghiLuc: string;
  readonly tacGia: string;
}

export interface DanhMucDonVi {
  readonly donVi: readonly DonViDanhMuc[];
  /** Bí danh TOÀN CỤC — gieo bằng migration, không tổ chức nào sửa được. */
  readonly biDanhChung: readonly { readonly biDanhSach: string; readonly code: string }[];
  /** Bí danh của tổ chức ĐANG hiệu lực: hàng mới nhất theo `seq` của từng chuỗi, không phải hàng rút. Nó đi TRƯỚC bí danh chung. */
  readonly biDanhToChuc: readonly BiDanhDonViHieuLuc[];
}

/** Danh mục toàn cục cộng bí danh đang hiệu lực của tổ chức — thứ màn `/du-lieu` cần để người quản lý dữ liệu chọn đơn vị. */
export async function docDanhMucDonVi(client: pg.PoolClient, orgId: string): Promise<DanhMucDonVi> {
  await assertTenantBound(client, orgId, "docDanhMucDonVi");
  const donVi = await client.query<{ code: string; thu_nguyen: DonViDanhMuc["thuNguyen"]; he_so_ve_goc: string }>(
    "SELECT u.code, u.thu_nguyen, u.he_so_ve_goc::pg_catalog.text AS he_so_ve_goc FROM public.uom_units u ORDER BY u.thu_nguyen, u.code",
  );
  const chung = await client.query<{ bi_danh_sach: string; code: string }>(
    "SELECT c.bi_danh_sach, c.code FROM public.uom_aliases_chung c ORDER BY c.bi_danh_sach",
  );
  const toChuc = await client.query<{ bi_danh_sach: string; code: string; seq: string; ghi_luc: Date; tac_gia: string }>(
    "SELECT a.bi_danh_sach, a.code, a.seq, a.ghi_luc, u.full_name AS tac_gia FROM (" +
      "SELECT DISTINCT ON (x.bi_danh_sach) x.bi_danh_sach, x.code, x.rut, x.seq::pg_catalog.text AS seq, x.ghi_luc, x.tac_gia " +
      "FROM public.uom_aliases x WHERE x.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
      "ORDER BY x.bi_danh_sach, x.seq DESC) a " +
      "JOIN public.users u ON u.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND u.id OPERATOR(pg_catalog.=) a.tac_gia " +
      "WHERE NOT a.rut ORDER BY a.bi_danh_sach",
    [orgId],
  );
  return {
    donVi: donVi.rows.map((r) => ({ code: r.code, thuNguyen: r.thu_nguyen, heSoVeGoc: r.he_so_ve_goc })),
    biDanhChung: chung.rows.map((r) => ({ biDanhSach: r.bi_danh_sach, code: r.code })),
    biDanhToChuc: toChuc.rows.map((r) => ({
      biDanhSach: r.bi_danh_sach,
      code: r.code,
      seq: r.seq,
      ghiLuc: r.ghi_luc.toISOString(),
      tacGia: r.tac_gia,
    })),
  };
}

export interface KhaiBiDanhDonViInput {
  /** Chuỗi tự do — CSDL làm sạch (`chuoi_sach` bản 1). Dạng mơ hồ (*"MT"*, *"T"*, *"M"*) chính là thứ tổ chức phải tự khai. */
  readonly biDanh: string;
  /** Phải quy về một mã của danh mục — mã (*"t"*) hay một bí danh đã có (*"tấn"*). */
  readonly donVi: string;
  readonly actorSessionId: string;
}

/** Khai một bí danh đơn vị của tổ chức; chuỗi đã có bí danh thì hàng mới nhất theo `seq` thắng — hàng cũ vẫn đọc được theo mốc. */
export async function khaiBiDanhDonVi(
  client: pg.PoolClient,
  orgId: string,
  input: KhaiBiDanhDonViInput,
): Promise<{ readonly biDanhSach: string; readonly code: string; readonly seq: string }> {
  await assertTenantBound(client, orgId, "khaiBiDanhDonVi");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const code = await maDanhMuc(client, orgId, input.donVi);
  if (code === null) throw new DuLieuNenError("DON_VI_KHONG_CO_TRONG_DANH_MUC", "bí danh đơn vị phải trỏ về một đơn vị của danh mục");
  return ghiDuLieuNen(async () => {
    const hang = (
      await client.query<{ id: string; bi_danh_sach: string; seq: string }>(
        "INSERT INTO public.uom_aliases (org_id, bi_danh_sach, code, rut, tac_gia, session_id) " +
          "VALUES ($1::pg_catalog.uuid, public.chuoi_sach($2::pg_catalog.text), $3::pg_catalog.text, false, $4::pg_catalog.uuid, $5::pg_catalog.uuid) " +
          "RETURNING id, bi_danh_sach, seq::pg_catalog.text AS seq",
        [orgId, input.biDanh, code, actor.id, actor.sessionId],
      )
    ).rows[0];
    if (hang === undefined) throw new Error("câu chèn uom_aliases không trả hàng nào");
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "UOM_ALIAS_DECLARED",
      resourceType: "uom_alias",
      resourceId: hang.id,
      payload: { biDanhSach: hang.bi_danh_sach, code, seq: hang.seq },
    });
    return { biDanhSach: hang.bi_danh_sach, code, seq: hang.seq };
  });
}

/**
 * Rút một bí danh đơn vị đang hiệu lực của tổ chức. Sau hàng rút, chuỗi ấy rơi về bí danh CHUNG nếu có (`don_vi_tai`), không thì
 * không quy đổi được. Không có bí danh nào đang hiệu lực thì từ chối — hàng rút không để làm nhiễu.
 */
export async function rutBiDanhDonVi(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly biDanh: string; readonly actorSessionId: string },
): Promise<{ readonly biDanhSach: string; readonly seq: string }> {
  await assertTenantBound(client, orgId, "rutBiDanhDonVi");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  const hienTai = (
    await client.query<{ rut: boolean }>(
      "SELECT a.rut FROM public.uom_aliases a " +
        "WHERE a.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
        "AND a.bi_danh_sach OPERATOR(pg_catalog.=) public.chuoi_sach($2::pg_catalog.text) " +
        "ORDER BY a.seq DESC LIMIT 1",
      [orgId, input.biDanh],
    )
  ).rows[0];
  if (hienTai === undefined || hienTai.rut) {
    throw new DuLieuNenError("KHONG_CO_BI_DANH", "không có bí danh đơn vị đang hiệu lực cho chuỗi này");
  }
  return ghiDuLieuNen(async () => {
    const hang = (
      await client.query<{ id: string; bi_danh_sach: string; seq: string }>(
        "INSERT INTO public.uom_aliases (org_id, bi_danh_sach, code, rut, tac_gia, session_id) " +
          "VALUES ($1::pg_catalog.uuid, public.chuoi_sach($2::pg_catalog.text), NULL, true, $3::pg_catalog.uuid, $4::pg_catalog.uuid) " +
          "RETURNING id, bi_danh_sach, seq::pg_catalog.text AS seq",
        [orgId, input.biDanh, actor.id, actor.sessionId],
      )
    ).rows[0];
    if (hang === undefined) throw new Error("câu chèn uom_aliases không trả hàng nào");
    await appendAuditEvent(client, orgId, {
      actorType: actor.type,
      actorId: actor.id,
      action: "UOM_ALIAS_WITHDRAWN",
      resourceType: "uom_alias",
      resourceId: hang.id,
      payload: { biDanhSach: hang.bi_danh_sach, seq: hang.seq },
    });
    return { biDanhSach: hang.bi_danh_sach, seq: hang.seq };
  });
}
