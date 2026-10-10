// ==============================================================================================
// [S1.9101 / S3.8a] ĐỌC HIỆU SUẤT NHÀ CUNG CẤP — đường đọc DUY NHẤT của view `supplier_performance` từ mã ứng dụng (spec S3 §4.9,
// §5.1 K11; ADR-9201; kế hoạch `docs/superpowers/plans/2026-10-10-chuan-bi-s3-8-s3-9.md` §2).
//
// CỔNG `bid.view` (spec §4.9): hạng, khoảng cách tới hạng nhất, thắng là dữ liệu SAU mở thầu, và cổng của dữ liệu ấy đã là `bid.view` —
// cùng cổng của bảng so sánh, bảng xếp hạng, lịch sử giá. Cổng nằm TRONG hàm (rổ `HAM_DOC_CO_QUYEN` của `cong-quyen-route.test.ts`):
// route GET không mang mã quyền. Lần từ chối vào sổ qua `auditPool` (`PERMISSION_DENIED`, giao dịch độc lập).
//
// VỊ TỪ BÍ MẬT không nằm ở đây: gói nào được đếm — chỉ gói ĐÃ LỘ GIÁ, cả ở cột phản hồi (chủ dự án chốt 2026-10-10, góc C⑦) — và vị
// từ khách là thân view, ghim ở hardening. Tệp này là tệp TypeScript DUY NHẤT được nhắc tên view
// (`tests/architecture/hieu-suat-liet-ke.test.ts`).
//
// SÀN LỊCH SỬ (spec §8.3, GIẢ ĐỊNH chờ pilot): mỗi tỷ lệ và mỗi trung vị có mẫu số dưới `SAN_LICH_SU` gói thì trả `null` và tên trường
// vào `chuaDuLichSu` — giao diện nói *"chưa đủ lịch sử"*, không hiện con số. Số đếm luôn trả. Mẫu số theo TỪNG nhà cung cấp, không theo
// tổ chức: theo tổ chức thì một nhà cung cấp một lần mời hiện 1/1 = 100%.
//
// SỔ: mỗi lần đọc THÀNH CÔNG một hàng `SUPPLIER_PERFORMANCE_READ` trên CHÍNH `client`, sau câu đọc — khuôn `PRICE_HISTORY_READ`,
// `BENCHMARK_READ`: ghi hỏng thì NÉM, giao dịch của người gọi ROLLBACK, và chỉ số không đi ra. Payload chỉ số nhà cung cấp và phiên.
//
// Ngôn ngữ (spec §2.2 ⑶, *Risk Signal ≠ Fraud Verdict*): số mô tả, không nhãn đánh giá — không "tốt", "kém", "đáng ngờ".
// ==============================================================================================
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";

/** Sàn lịch sử — GIẢ ĐỊNH chờ pilot (spec S3 §4.9, §8.3): không tham số nào được gọi là *đã hiệu chỉnh* trước dữ liệu thật. */
export const SAN_LICH_SU = 5;

/** Trường có thể bị giữ lại dưới sàn. */
export type TruongDuoiSan = "tyLePhanHoiPhanVan" | "trungViPhanHoiGiay" | "hangTrungVi" | "khoangCachTrungViPhanVan" | "tyLeThangPhanVan";

export interface HieuSuatNhaCungCap {
  readonly supplierId: string;
  readonly tenNhaCungCap: string;
  /** Số gói ĐÃ LỘ GIÁ có lời mời được đếm (link đã đi, bên mua không rút). */
  readonly soGoiMoi: number;
  /** Số gói trong tập trên có ít nhất một phiên bản vòng một. */
  readonly soGoiNop: number;
  /** `soGoiNop / soGoiMoi`, phần vạn, làm tròn nửa lên; `null` dưới sàn. */
  readonly tyLePhanHoiPhanVan: number | null;
  /** Trung vị (phần tử dưới) thời gian từ lúc mở gói — hay lúc mời, nếu mời sau — tới phiên bản đầu, giây; `null` dưới sàn. */
  readonly trungViPhanHoiGiay: number | null;
  /** Số lần sửa báo giá trước hạn: vòng một, cộng mọi vòng BAFO đã lộ. */
  readonly soLanSua: number;
  /** Số gói đã lộ giá có hàng của nhà cung cấp ở lượt chấm mới nhất, chi phí khác NULL. */
  readonly soGoiXepHang: number;
  readonly hangTrungVi: number | null;
  /** Trung vị khoảng cách tới hạng nhất, phần vạn của chi phí hạng nhất; `null` dưới sàn. */
  readonly khoangCachTrungViPhanVan: number | null;
  readonly soLanVaoBafo: number;
  readonly soLanThang: number;
  /** `soLanThang / soGoiXepHang`, phần vạn; `null` dưới sàn. */
  readonly tyLeThangPhanVan: number | null;
  /** Các trường bị giữ lại vì mẫu dưới sàn — theo thứ tự khai ở `TruongDuoiSan`. */
  readonly chuaDuLichSu: readonly TruongDuoiSan[];
}

export interface HieuSuat {
  readonly sanLichSu: number;
  readonly nhaCungCap: readonly HieuSuatNhaCungCap[];
}

export interface DocHieuSuatInput {
  readonly actorSessionId: string;
}

interface HangHieuSuat {
  readonly supplier_id: string;
  readonly legal_name: string;
  readonly so_goi_moi: string;
  readonly so_goi_nop: string;
  readonly trung_vi_phan_hoi_giay: string | null;
  readonly so_lan_sua: string;
  readonly so_goi_xep_hang: string;
  readonly hang_trung_vi: number | null;
  readonly khoang_cach_trung_vi_phan_van: string | null;
  readonly so_lan_vao_bafo: string;
  readonly so_lan_thang: string;
}

/** Phần vạn của `tu / mau`, làm tròn nửa lên — số nguyên, không qua `double` ở phép chia. */
function phanVan(tu: number, mau: number): number {
  return Math.floor((tu * 20000 + mau) / (mau * 2));
}

/**
 * Hiệu suất của MỌI nhà cung cấp có ít nhất một số đếm khác 0 trong tổ chức, tại `now()` của giao dịch đọc — xếp theo tên rồi id. Không
 * tham số lọc, không phân trang: một tổ chức pilot có vài chục nhà cung cấp.
 */
export async function docHieuSuatNhaCungCap(
  client: pg.PoolClient,
  orgId: string,
  input: DocHieuSuatInput,
  auditPool: pg.Pool,
): Promise<HieuSuat> {
  await assertTenantBound(client, orgId, "docHieuSuatNhaCungCap");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.BID_VIEW, resourceType: "SUPPLIER_PERFORMANCE", resourceId: orgId },
    auditPool,
  );

  const { rows } = await client.query<HangHieuSuat>(
    "SELECT p.supplier_id, s.legal_name, p.so_goi_moi::pg_catalog.text AS so_goi_moi, p.so_goi_nop::pg_catalog.text AS so_goi_nop, " +
      "p.trung_vi_phan_hoi_giay::pg_catalog.text AS trung_vi_phan_hoi_giay, p.so_lan_sua::pg_catalog.text AS so_lan_sua, " +
      "p.so_goi_xep_hang::pg_catalog.text AS so_goi_xep_hang, p.hang_trung_vi, " +
      "p.khoang_cach_trung_vi_phan_van::pg_catalog.text AS khoang_cach_trung_vi_phan_van, " +
      "p.so_lan_vao_bafo::pg_catalog.text AS so_lan_vao_bafo, p.so_lan_thang::pg_catalog.text AS so_lan_thang " +
      "FROM public.supplier_performance p " +
      "JOIN public.suppliers s ON s.org_id OPERATOR(pg_catalog.=) p.org_id AND s.id OPERATOR(pg_catalog.=) p.supplier_id " +
      "WHERE p.org_id OPERATOR(pg_catalog.=) $1 " +
      "ORDER BY s.legal_name, p.supplier_id",
    [orgId],
  );

  const nhaCungCap = rows.map((r): HieuSuatNhaCungCap => {
    const soGoiMoi = Number(r.so_goi_moi);
    const soGoiNop = Number(r.so_goi_nop);
    const soGoiXepHang = Number(r.so_goi_xep_hang);
    const soLanThang = Number(r.so_lan_thang);
    const chuaDuLichSu: TruongDuoiSan[] = [];
    // Mẫu dưới sàn ⇒ giữ lại VÀ nói tên trường, kể cả khi giá trị vốn rỗng (0 gói): giao diện nói *"chưa đủ lịch sử"* chứ không im.
    const giu = <T>(truong: TruongDuoiSan, mau: number, giaTri: T | null): T | null => {
      if (mau < SAN_LICH_SU) {
        chuaDuLichSu.push(truong);
        return null;
      }
      return giaTri;
    };
    const tyLePhanHoiPhanVan = giu("tyLePhanHoiPhanVan", soGoiMoi, soGoiMoi === 0 ? null : phanVan(soGoiNop, soGoiMoi));
    const trungViPhanHoiGiay = giu("trungViPhanHoiGiay", soGoiNop, r.trung_vi_phan_hoi_giay === null ? null : Number(r.trung_vi_phan_hoi_giay));
    const hangTrungVi = giu("hangTrungVi", soGoiXepHang, r.hang_trung_vi);
    const khoangCachTrungViPhanVan = giu(
      "khoangCachTrungViPhanVan",
      soGoiXepHang,
      r.khoang_cach_trung_vi_phan_van === null ? null : Number(r.khoang_cach_trung_vi_phan_van),
    );
    const tyLeThangPhanVan = giu("tyLeThangPhanVan", soGoiXepHang, soGoiXepHang === 0 ? null : phanVan(soLanThang, soGoiXepHang));
    return {
      supplierId: r.supplier_id,
      tenNhaCungCap: r.legal_name,
      soGoiMoi,
      soGoiNop,
      tyLePhanHoiPhanVan,
      trungViPhanHoiGiay,
      soLanSua: Number(r.so_lan_sua),
      soGoiXepHang,
      hangTrungVi,
      khoangCachTrungViPhanVan,
      soLanVaoBafo: Number(r.so_lan_vao_bafo),
      soLanThang,
      tyLeThangPhanVan,
      chuaDuLichSu,
    };
  });

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "SUPPLIER_PERFORMANCE_READ",
    resourceType: "SUPPLIER_PERFORMANCE",
    resourceId: orgId,
    payload: { soNhaCungCap: nhaCungCap.length, viewedBySessionId: input.actorSessionId },
  });

  return { sanLichSu: SAN_LICH_SU, nhaCungCap };
}
