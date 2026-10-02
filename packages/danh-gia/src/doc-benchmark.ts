// ==============================================================================================
// [S1.256 / S4.5b] ĐỌC BENCHMARK CỦA MỘT GÓI — cổng `bid.view`, một hàng sổ mỗi lần đọc (spec S4 §4.6; L6, L7; ADR-140 ⑦, ADR-142).
//
// HAI NGUỒN, chủ dự án chốt 2026-10-01 (ADR-141 ⑶):
//   • gói đang `UNSEALED` hay `BAFO_UNSEALED` — giá mới lộ, lượt chấm cho đúng giá ấy chưa có ⇒ TÍNH as-of ở mỗi lần đọc
//     (`AS_OF`), trên đúng tập báo giá mà lượt chấm sẽ xếp hạng (`docBaoGia`) và dưới phiên bản ghim của gói;
//   • mọi trạng thái khác ⇒ hàng đã GHI của lượt chấm mới nhất (`LUOT_CHAM`), không tính lại. Chưa có lượt chấm ⇒ không có gì.
// Phiên bản (ghim, hay của lượt chấm) chưa cấu hình nhóm `benchmark` ⇒ `CHUA_CAU_HINH`, không mặc định ngầm.
//
// Cổng nằm THẲNG trong thân hàm (khoản 33; `cong-quyen-route.test.ts`). Kết quả không mang con số nào có đơn vị tiền — nhãn,
// chiều, lý do, số đếm — nhưng nhãn là thông tin về giá, nên cổng là `bid.view` như bảng so sánh và lịch sử giá.
// SỔ: mỗi lần đọc THÀNH CÔNG một hàng `BENCHMARK_READ` trên CHÍNH `client`, sau mọi câu đọc (khuôn `COMPARISON_VIEWED`, ADR-102):
// ghi hỏng thì NÉM và giao dịch của người gọi ROLLBACK. Payload không mang nhãn hay giá.
// ==============================================================================================
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import { docNhomBenchmark, tinhBenchmarkGoi, type ChieuLech, type NhanBenchmark } from "@trustprocure/du-lieu-nen";
import { docBaoGia } from "./luot-danh-gia.js";

/** Trạng thái gói mà benchmark tính as-of ở mỗi lần đọc. */
export const TRANG_THAI_BENCHMARK_AS_OF = ["UNSEALED", "BAFO_UNSEALED"] as const;

export type NguonBenchmark = "AS_OF" | "LUOT_CHAM";

export interface DongBenchmarkHien {
  readonly bidVersionId: string;
  readonly lineNo: number;
  readonly canonicalItemId: string | null;
  readonly anhXaId: string | null;
  readonly nhan: NhanBenchmark;
  readonly chieu: ChieuLech | null;
  readonly lyDo: string | null;
  readonly tienTe: string | null;
  readonly cuaSoTu: Date | null;
  readonly soQuanSat: number | null;
  readonly soGoi: number | null;
  readonly soNcc: number | null;
  readonly soGoiCungNguoiTao: number | null;
  readonly soQuanSatHoiTo: number | null;
  readonly soLoaiTienTe: number | null;
  readonly soLoaiGia0: number | null;
  readonly hoiTo: readonly string[];
}

export type BenchmarkCuaGoi =
  | { readonly trangThai: "CHUA_CO_KET_QUA"; readonly rfqStatus: string }
  /**
   * Lượt chấm mới nhất mang phiên bản CÓ cấu hình benchmark mà không có hàng kết quả nào — trái phép ghi một lần của `taoLuotDanhGia`,
   * tức lượt ấy đến từ một đường ghi khác (SQL thô dưới `app_api`, khoản 330). Không nhãn nào đi ra; không ném, để một lượt chấm thô
   * không khoá vĩnh viễn mọi lần đọc của gói (lượt soi §S1.256, TRUNG-2).
   */
  | {
      readonly trangThai: "THIEU_KET_QUA";
      readonly evaluationId: string;
      readonly policyId: string;
      readonly policyVersion: number;
    }
  | {
      readonly trangThai: "CHUA_CAU_HINH";
      readonly nguon: NguonBenchmark;
      readonly evaluationId: string | null;
      readonly policyId: string | null;
      readonly policyVersion: number | null;
    }
  | {
      readonly trangThai: "CO";
      readonly nguon: NguonBenchmark;
      readonly evaluationId: string | null;
      readonly policyId: string;
      readonly policyVersion: number;
      readonly phuongPhap: string;
      readonly mocMoGia: Date;
      readonly dong: readonly DongBenchmarkHien[];
    };

export interface DocBenchmarkInput {
  readonly rfqId: string;
  readonly actorSessionId: string;
}

interface HangLuu {
  readonly bid_version_id: string;
  readonly line_no: number;
  readonly canonical_item_id: string | null;
  readonly anh_xa_id: string | null;
  readonly nhan: NhanBenchmark;
  readonly chieu: ChieuLech | null;
  readonly ly_do: string | null;
  readonly tien_te: string | null;
  readonly cua_so_tu: Date | null;
  readonly so_quan_sat: number | null;
  readonly so_goi: number | null;
  readonly so_ncc: number | null;
  readonly so_goi_cung_nguoi_tao: number | null;
  readonly so_quan_sat_hoi_to: number | null;
  readonly so_loai_tien_te: number | null;
  readonly so_loai_gia_0: number | null;
  readonly hoi_to: string[];
  readonly phuong_phap: string;
  readonly moc_mo_gia: Date;
}

const ngayTuMicro = (micro: bigint): Date => new Date(Number(micro / 1000n));

/** Benchmark của gói tại lần đọc này. `null` khi gói không có trong tổ chức — sau cổng quyền. */
export async function docBenchmark(
  client: pg.PoolClient,
  orgId: string,
  input: DocBenchmarkInput,
  auditPool: pg.Pool,
): Promise<BenchmarkCuaGoi | null> {
  await assertTenantBound(client, orgId, "docBenchmark");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.BID_VIEW,
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  const { rows: goi } = await client.query<{
    status: string;
    policy_id: string | null;
    version: number | null;
    benchmark: unknown;
  }>(
    `SELECT p.status, o.id AS policy_id, o.version, o.benchmark
       FROM public.rfq_packages p
       LEFT JOIN public.org_procurement_policies o
         ON o.id OPERATOR(pg_catalog.=) p.chinh_sach_ghim_id
        AND o.org_id OPERATOR(pg_catalog.=) p.org_id
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, input.rfqId],
  );
  const g = goi[0];
  if (g === undefined) return null;

  let ketQua: BenchmarkCuaGoi;
  if ((TRANG_THAI_BENCHMARK_AS_OF as readonly string[]).includes(g.status)) {
    const nhom = docNhomBenchmark(g.benchmark);
    if (nhom === null || g.policy_id === null || g.version === null) {
      ketQua = { trangThai: "CHUA_CAU_HINH", nguon: "AS_OF", evaluationId: null, policyId: g.policy_id, policyVersion: g.version };
    } else {
      const baoGia = await docBaoGia(client, orgId, input.rfqId);
      const kq = await tinhBenchmarkGoi(client, orgId, {
        rfqId: input.rfqId,
        bidVersionIds: baoGia.map((b) => b.bid_version_id),
        nhom,
      });
      ketQua = {
        trangThai: "CO",
        nguon: "AS_OF",
        evaluationId: null,
        policyId: g.policy_id,
        policyVersion: g.version,
        phuongPhap: kq.phuongPhap,
        mocMoGia: ngayTuMicro(kq.mocMoGia),
        dong: kq.dong.map((d) => ({
          bidVersionId: d.bidVersionId,
          lineNo: d.lineNo,
          canonicalItemId: d.canonicalItemId,
          anhXaId: d.anhXaId,
          nhan: d.nhan,
          chieu: d.chieu,
          lyDo: d.lyDo,
          tienTe: d.tienTe,
          cuaSoTu: d.cuaSoTu === null ? null : ngayTuMicro(d.cuaSoTu),
          soQuanSat: d.soQuanSat,
          soGoi: d.soGoi,
          soNcc: d.soNcc,
          soGoiCungNguoiTao: d.soGoiCungNguoiTao,
          soQuanSatHoiTo: d.soQuanSatHoiTo,
          soLoaiTienTe: d.soLoaiTienTe,
          soLoaiGia0: d.soLoaiGia0,
          hoiTo: d.hoiTo,
        })),
      };
    }
  } else {
    const { rows: luot } = await client.query<{ id: string; policy_id: string; version: number; benchmark: unknown }>(
      `SELECT e.id, e.policy_id, o.version, o.benchmark
         FROM public.rfq_evaluations e
         JOIN public.org_procurement_policies o ON o.id OPERATOR(pg_catalog.=) e.policy_id
                                              AND o.org_id OPERATOR(pg_catalog.=) e.org_id
        WHERE e.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
          AND e.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 1`,
      [orgId, input.rfqId],
    );
    const l = luot[0];
    if (l === undefined) {
      ketQua = { trangThai: "CHUA_CO_KET_QUA", rfqStatus: g.status };
    } else {
      const { rows } = await client.query<HangLuu>(
        `SELECT b.bid_version_id, b.line_no, b.canonical_item_id, b.anh_xa_id, b.nhan, b.chieu, b.ly_do, b.tien_te, b.cua_so_tu,
                b.so_quan_sat, b.so_goi, b.so_ncc, b.so_goi_cung_nguoi_tao, b.so_quan_sat_hoi_to, b.so_loai_tien_te,
                b.so_loai_gia_0, b.hoi_to, b.phuong_phap, b.moc_mo_gia
           FROM public.price_benchmark_results b
          WHERE b.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
            AND b.evaluation_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
          ORDER BY b.line_no, b.bid_version_id`,
        [orgId, l.id],
      );
      const dau = rows[0];
      if (dau === undefined) {
        // Ghi đúng một lần trong giao dịch tạo lượt chấm: không hàng nào ⇔ phiên bản của lượt chấm chưa cấu hình nhóm `benchmark`.
        ketQua =
          docNhomBenchmark(l.benchmark) === null
            ? { trangThai: "CHUA_CAU_HINH", nguon: "LUOT_CHAM", evaluationId: l.id, policyId: l.policy_id, policyVersion: l.version }
            : { trangThai: "THIEU_KET_QUA", evaluationId: l.id, policyId: l.policy_id, policyVersion: l.version };
      } else {
        ketQua = {
          trangThai: "CO",
          nguon: "LUOT_CHAM",
          evaluationId: l.id,
          policyId: l.policy_id,
          policyVersion: l.version,
          phuongPhap: dau.phuong_phap,
          mocMoGia: dau.moc_mo_gia,
          dong: rows.map((r) => ({
            bidVersionId: r.bid_version_id,
            lineNo: r.line_no,
            canonicalItemId: r.canonical_item_id,
            anhXaId: r.anh_xa_id,
            nhan: r.nhan,
            chieu: r.chieu,
            lyDo: r.ly_do,
            tienTe: r.tien_te,
            cuaSoTu: r.cua_so_tu,
            soQuanSat: r.so_quan_sat,
            soGoi: r.so_goi,
            soNcc: r.so_ncc,
            soGoiCungNguoiTao: r.so_goi_cung_nguoi_tao,
            soQuanSatHoiTo: r.so_quan_sat_hoi_to,
            soLoaiTienTe: r.so_loai_tien_te,
            soLoaiGia0: r.so_loai_gia_0,
            hoiTo: r.hoi_to,
          })),
        };
      }
    }
  }

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "BENCHMARK_READ",
    resourceType: "RFQ",
    resourceId: input.rfqId,
    payload: {
      rfqId: input.rfqId,
      trangThai: ketQua.trangThai,
      nguon: ketQua.trangThai === "CHUA_CO_KET_QUA" || ketQua.trangThai === "THIEU_KET_QUA" ? null : ketQua.nguon,
      soDong: ketQua.trangThai === "CO" ? ketQua.dong.length : 0,
      viewedBySessionId: input.actorSessionId,
    },
  });
  return ketQua;
}
