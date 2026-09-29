// [S1.9101 / S4.1] Tầng gói của đơn vị đo (spec S4 §4.2). Làm sạch chuỗi và quy đổi CHỈ ở SQL (§2.5 ⒄):
// hai hàm dưới đây gọi `public.chuoi_sach` và `public.quy_doi_don_vi` chứ không cài lại luật — hai bản
// cài (TS và SQL) là đúng hình dạng khoản 218, hai tầng cho hai con số bằng hai luật.
//
// Hệ số trả về là CHUỖI thập phân như Postgres in ra, không phải `number`: `0.000001` và `1000000` đi
// qua `number` thì còn nguyên, nhưng tích của chúng với một lượng tiền thì không (ADR-053 ⑴).
import type pg from "pg";
import { assertTenantBound } from "@trustprocure/audit";

export const KHONG_QUY_DOI_DUOC = "KHONG_QUY_DOI_DUOC" as const;

/** `CUNG_DON_VI` là hệ số `1` CÓ NGUỒN — cùng một mã; mọi ca không nguồn là `KHONG_QUY_DOI_DUOC` (L4). */
export type KetQuaQuyDoi =
  | { readonly quyDoiDuoc: true; readonly heSo: string; readonly ma: "CUNG_DON_VI" | "QUY_DOI_CHUNG" }
  | { readonly quyDoiDuoc: false; readonly ma: typeof KHONG_QUY_DOI_DUOC };

export interface QuyDoiDonViInput {
  readonly orgId: string;
  /** Chuỗi đơn vị tự do, như trên `rfq_items.unit`. */
  readonly tu: string;
  readonly sang: string;
  /** Mốc: chỉ bí danh của tổ chức có `ghi_luc` TRƯỚC mốc được dùng (L1). */
  readonly moc: Date;
  /** Hàng chuẩn — vế quy đổi riêng thuộc S4.2; ở S4.1 tham số này không đổi kết quả. */
  readonly hangChuanId?: string | null;
}

export async function quyDoiDonVi(client: pg.PoolClient, input: QuyDoiDonViInput): Promise<KetQuaQuyDoi> {
  await assertTenantBound(client, input.orgId, "quyDoiDonVi");
  const { rows } = await client.query<{ he_so: string | null; ma: string }>(
    "SELECT he_so::pg_catalog.text AS he_so, ma FROM public.quy_doi_don_vi($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.text, $4::pg_catalog.text, $5::pg_catalog.timestamptz)",
    [input.orgId, input.hangChuanId ?? null, input.tu, input.sang, input.moc],
  );
  const hang = rows[0];
  if (hang === undefined) throw new Error("quy_doi_don_vi không trả hàng nào");
  if ((hang.ma === "CUNG_DON_VI" || hang.ma === "QUY_DOI_CHUNG") && hang.he_so !== null) {
    return { quyDoiDuoc: true, heSo: hang.he_so, ma: hang.ma };
  }
  if (hang.ma === KHONG_QUY_DOI_DUOC && hang.he_so === null) return { quyDoiDuoc: false, ma: KHONG_QUY_DOI_DUOC };
  // Một cặp (mã, hệ số) ngoài ba dạng trên là hàm SQL đã bị sửa — fail-closed, không đoán.
  throw new Error(`quy_doi_don_vi trả một cặp lạ: ma=${hang.ma}, he_so=${String(hang.he_so)}`);
}

/** Dạng sạch bản 1 của một chuỗi — đúng thứ bí danh được lưu và được so. */
export async function chuoiSach(client: pg.PoolClient, s: string): Promise<string> {
  const { rows } = await client.query<{ sach: string }>("SELECT public.chuoi_sach($1::pg_catalog.text) AS sach", [s]);
  const sach = rows[0]?.sach;
  if (sach === undefined) throw new Error("chuoi_sach không trả hàng nào");
  return sach;
}
