// ==============================================================================================
// [S1.256 / S4.5b] ĐỌC BENCHMARK CỦA MỘT GÓI — cổng `bid.view`, một hàng sổ mỗi lần đọc (spec S4 §4.6; L6, L7; ADR-140 ⑦, ADR-142).
// [S1.9101 / S4.5c1] ĐỔI ĐÍCH (ADR-142 ⑼, ADR-9201): ~~hai nguồn — as-of ở mỗi lần đọc khi `UNSEALED`/`BAFO_UNSEALED`, hàng của lượt chấm
// mới nhất ở mọi trạng thái khác~~ — đo ở S4.5b: đọc as-of một gói 20 dòng tốn 18–19 s ở 5.000 gói. Chủ dự án chốt 2026-10-01:
//   • benchmark của bảng so sánh có MỘT bản cho MỖI lần mở thầu (vòng một, mỗi vòng BAFO). Lần đọc ĐẦU TIÊN sau lần mở thầu ấy TÍNH
//     (trên đúng tập báo giá lượt chấm sẽ xếp hạng — `docBaoGia` — dưới phiên bản ghim) rồi GHI (`ghiBanLuuBenchmark`); mọi lần đọc sau
//     đọc bản lưu. Không job nào, không dòng nào trên đường mở thầu (spec §3.1–3.2).
//   • benchmark hiện ĐÚNG ở các trạng thái bảng so sánh mở (`COMPARISON_ALLOWED_STATUSES` của `packages/unseal` — khoá với hằng dưới ở
//     `tests/architecture/benchmark-trang-thai-dong-bo.test.ts`). Ở `BAFO_OPEN`/`BAFO_CLOSED` trả trạng thái có tên
//     `VONG_CHAO_LAI_DANG_MO`, không nhãn nào (L6); ở mọi trạng thái khác `KHONG_HIEN`.
//   • bản lưu KHÔNG mang số nào có đơn vị tiền (spec §4.6). Số của dải và `SAU_MOC` là của `docDaiBenchmark` — bấm *Xem dải* MỘT dòng.
// Hàng kết quả của LƯỢT CHẤM (`103`) không đổi và không còn đọc ở đây: chúng là hồ sơ của lượt chấm (bộ bằng chứng, S4.5c2).
// Phiên bản ghim chưa cấu hình nhóm `benchmark` ⇒ `CHUA_CAU_HINH`, không mặc định ngầm.
//
// Cổng nằm THẲNG trong thân hàm (khoản 33; `cong-quyen-route.test.ts`). Kết quả của `docBenchmark` không mang con số nào có đơn vị
// tiền — nhãn, chiều, lý do, số đếm — nhưng nhãn là thông tin về giá, nên cổng là `bid.view` như bảng so sánh và lịch sử giá.
// SỔ: mỗi lần đọc THÀNH CÔNG một hàng (`BENCHMARK_READ`, `BENCHMARK_BAND_READ`) trên CHÍNH `client`, sau mọi câu đọc (khuôn
// `COMPARISON_VIEWED`, ADR-102): ghi hỏng thì NÉM và giao dịch của người gọi ROLLBACK — kể cả bản lưu vừa ghi. Payload không mang nhãn
// hay giá.
// ==============================================================================================
import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import {
  docNhomBenchmark,
  ghiBanLuuBenchmark,
  tinhBenchmarkGoi,
  tinhDaiDong,
  type ChieuLech,
  type NhanBenchmark,
  type NhomBenchmark,
} from "@trustprocure/du-lieu-nen";
import { docBaoGia } from "./luot-danh-gia.js";

/** Trạng thái gói mà benchmark hiện — đúng tập trạng thái bảng so sánh mở (`COMPARISON_ALLOWED_STATUSES`). */
export const TRANG_THAI_BENCHMARK_HIEN = ["UNSEALED", "EVALUATING", "BAFO_UNSEALED"] as const;

/** Vòng chào lại đang mở hay đã đóng mà chưa mở niêm phong: không nhãn nào (L6, chủ dự án chốt 2026-10-01). */
export const TRANG_THAI_VONG_CHAO_LAI = ["BAFO_OPEN", "BAFO_CLOSED"] as const;

/** `BAN_LUU`: đọc bản đã ghi. `TINH_MOI`: lần đọc này tính và ghi bản lưu. */
export type NguonBenchmark = "BAN_LUU" | "TINH_MOI";

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
  | { readonly trangThai: "KHONG_HIEN"; readonly rfqStatus: string }
  | { readonly trangThai: "VONG_CHAO_LAI_DANG_MO"; readonly rfqStatus: string }
  | {
      readonly trangThai: "CHUA_CAU_HINH";
      readonly policyId: string | null;
      readonly policyVersion: number | null;
    }
  | {
      readonly trangThai: "CO";
      readonly nguon: NguonBenchmark;
      readonly snapshotId: string;
      readonly unsealRequestId: string;
      /** Vòng BAFO của lần mở thầu; `null` là vòng một. */
      readonly bafoRoundId: string | null;
      readonly policyId: string;
      readonly policyVersion: number;
      readonly phuongPhap: string;
      readonly mocMoGia: Date;
      /** Lúc tính bản lưu — giá của chính các dòng đọc tại đây. */
      readonly tinhLuc: Date;
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
}

interface DauBanLuu {
  readonly id: string;
  readonly phuong_phap: string;
  readonly moc_mo_gia: Date;
  readonly ghi_luc: Date;
  readonly moc_micro: string;
  readonly ghi_micro: string;
}

/** Bối cảnh chung của hai bộ đọc: trạng thái gói, phiên bản ghim, lần mở thầu mới nhất. `null` khi gói không có trong tổ chức. */
interface BoiCanh {
  readonly status: string;
  readonly policyId: string | null;
  readonly version: number | null;
  readonly nhom: NhomBenchmark | null;
  readonly unsealRequestId: string | null;
  readonly bafoRoundId: string | null;
}

async function docBoiCanh(client: pg.PoolClient, orgId: string, rfqId: string): Promise<BoiCanh | null> {
  const { rows } = await client.query<{
    status: string;
    policy_id: string | null;
    version: number | null;
    benchmark: unknown;
    unseal_request_id: string | null;
    bafo_round_id: string | null;
  }>(
    `SELECT p.status, o.id AS policy_id, o.version, o.benchmark, q.id AS unseal_request_id, q.bafo_round_id
       FROM public.rfq_packages p
       LEFT JOIN public.org_procurement_policies o
         ON o.id OPERATOR(pg_catalog.=) p.chinh_sach_ghim_id
        AND o.org_id OPERATOR(pg_catalog.=) p.org_id
       LEFT JOIN LATERAL (
         SELECT r.id, r.bafo_round_id FROM public.unseal_requests r
          WHERE r.org_id OPERATOR(pg_catalog.=) p.org_id
            AND r.rfq_id OPERATOR(pg_catalog.=) p.id
            AND r.status OPERATOR(pg_catalog.=) 'EXECUTED'
          ORDER BY r.executed_at DESC, r.id DESC
          LIMIT 1) q ON true
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, rfqId],
  );
  const g = rows[0];
  if (g === undefined) return null;
  return {
    status: g.status,
    policyId: g.policy_id,
    version: g.version,
    nhom: docNhomBenchmark(g.benchmark),
    unsealRequestId: g.unseal_request_id,
    bafoRoundId: g.bafo_round_id,
  };
}

async function docDauBanLuu(client: pg.PoolClient, orgId: string, unsealRequestId: string): Promise<DauBanLuu | undefined> {
  const { rows } = await client.query<DauBanLuu>(
    `SELECT s.id, s.phuong_phap, s.moc_mo_gia, s.ghi_luc,
            (pg_catalog.extract('epoch', s.moc_mo_gia) OPERATOR(pg_catalog.*) 1000000)::pg_catalog.int8::pg_catalog.text AS moc_micro,
            (pg_catalog.extract('epoch', s.ghi_luc) OPERATOR(pg_catalog.*) 1000000)::pg_catalog.int8::pg_catalog.text AS ghi_micro
       FROM public.price_benchmark_snapshots s
      WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND s.unseal_request_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, unsealRequestId],
  );
  return rows[0];
}

async function docDongBanLuu(
  client: pg.PoolClient,
  orgId: string,
  snapshotId: string,
  lineNo?: number,
): Promise<readonly HangLuu[]> {
  const { rows } = await client.query<HangLuu>(
    `SELECT b.bid_version_id, b.line_no, b.canonical_item_id, b.anh_xa_id, b.nhan, b.chieu, b.ly_do, b.tien_te, b.cua_so_tu,
            b.so_quan_sat, b.so_goi, b.so_ncc, b.so_goi_cung_nguoi_tao, b.so_quan_sat_hoi_to, b.so_loai_tien_te,
            b.so_loai_gia_0, b.hoi_to
       FROM public.price_benchmark_snapshot_lines b
      WHERE b.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND b.snapshot_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND ($3::pg_catalog.int4 IS NULL OR b.line_no OPERATOR(pg_catalog.=) $3::pg_catalog.int4)
      ORDER BY b.line_no, b.bid_version_id`,
    [orgId, snapshotId, lineNo ?? null],
  );
  return rows;
}

const dongHien = (r: HangLuu): DongBenchmarkHien => ({
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
});

/** Trạng thái không có nhãn nào, theo trạng thái gói; `undefined` khi benchmark hiện được ở trạng thái này. */
type KhongHien = { readonly trangThai: "KHONG_HIEN" | "VONG_CHAO_LAI_DANG_MO"; readonly rfqStatus: string };

function trangThaiKhongHien(status: string): KhongHien | undefined {
  if ((TRANG_THAI_VONG_CHAO_LAI as readonly string[]).includes(status)) return { trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: status };
  if (!(TRANG_THAI_BENCHMARK_HIEN as readonly string[]).includes(status)) return { trangThai: "KHONG_HIEN", rfqStatus: status };
  return undefined;
}

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
    { userId: actor.id, orgId, permission: PERMISSIONS.BID_VIEW, resourceType: "RFQ", resourceId: input.rfqId },
    auditPool,
  );
  const bc = await docBoiCanh(client, orgId, input.rfqId);
  if (bc === null) return null;

  let ketQua: BenchmarkCuaGoi;
  const khongHien = trangThaiKhongHien(bc.status);
  if (khongHien !== undefined) {
    ketQua = khongHien;
  } else if (bc.nhom === null || bc.policyId === null || bc.version === null) {
    ketQua = { trangThai: "CHUA_CAU_HINH", policyId: bc.policyId, policyVersion: bc.version };
  } else {
    // Ba trạng thái hiện đều đến SAU một lần mở thầu đã thực thi; không có lần nào là dữ liệu lệch — NÉM, không đoán.
    if (bc.unsealRequestId === null) throw new Error("gói ở trạng thái sau mở thầu mà không có lần mở thầu nào đã thực thi");
    let nguon: NguonBenchmark = "BAN_LUU";
    let dau = await docDauBanLuu(client, orgId, bc.unsealRequestId);
    if (dau === undefined) {
      const baoGia = await docBaoGia(client, orgId, input.rfqId);
      const kq = await tinhBenchmarkGoi(client, orgId, {
        rfqId: input.rfqId,
        bidVersionIds: baoGia.map((b) => b.bid_version_id),
        nhom: bc.nhom,
      });
      const id = await ghiBanLuuBenchmark(client, orgId, { unsealRequestId: bc.unsealRequestId, policyId: bc.policyId, ketQua: kq });
      if (id !== null) nguon = "TINH_MOI";
      dau = await docDauBanLuu(client, orgId, bc.unsealRequestId);
      if (dau === undefined) throw new Error("bản lưu benchmark vừa ghi (hay do giao dịch khác ghi) không đọc lại được");
    }
    const dong = await docDongBanLuu(client, orgId, dau.id);
    ketQua = {
      trangThai: "CO",
      nguon,
      snapshotId: dau.id,
      unsealRequestId: bc.unsealRequestId,
      bafoRoundId: bc.bafoRoundId,
      policyId: bc.policyId,
      policyVersion: bc.version,
      phuongPhap: dau.phuong_phap,
      mocMoGia: dau.moc_mo_gia,
      tinhLuc: dau.ghi_luc,
      dong: dong.map(dongHien),
    };
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
      nguon: ketQua.trangThai === "CO" ? ketQua.nguon : null,
      snapshotId: ketQua.trangThai === "CO" ? ketQua.snapshotId : null,
      soDong: ketQua.trangThai === "CO" ? ketQua.dong.length : 0,
      viewedBySessionId: input.actorSessionId,
    },
  });
  return ketQua;
}

// ----------------------------------------------------------------------------------------------
// *XEM DẢI* MỘT DÒNG — số của dải và `SAU_MOC`, tính lúc bấm (chủ dự án chốt 2026-10-01; spec §4.6, §2.5 ⑿)
// ----------------------------------------------------------------------------------------------

export interface DocDaiBenchmarkInput {
  readonly rfqId: string;
  readonly lineNo: number;
  readonly actorSessionId: string;
}

/** Một dải của dòng: một (hàng chuẩn, tiền tệ). Số là CHUỖI thập phân theo đơn vị gốc của hàng chuẩn; `null` khi dưới sàn. */
export interface DaiHien {
  readonly canonicalItemId: string;
  readonly tienTe: string;
  readonly cuaSoTu: Date;
  readonly duSan: boolean;
  readonly q1: string | null;
  readonly trungVi: string | null;
  readonly q3: string | null;
  readonly soQuanSat: number;
  readonly soGoi: number;
  readonly soNcc: number;
  readonly soGoiCungNguoiTao: number;
  readonly soQuanSatHoiTo: number;
  readonly soLoaiTienTe: number;
  readonly soLoaiGia0: number;
  readonly sauMoc: Readonly<Record<string, number>>;
  /** Số đếm tính lại trùng số đếm của bản lưu cho mọi dòng của dải này (L7). `false` là dữ liệu lệch — màn nói ra, không giấu. */
  readonly khopBanLuu: boolean;
}

export type DaiCuaDong =
  | { readonly trangThai: "KHONG_HIEN"; readonly rfqStatus: string }
  | { readonly trangThai: "VONG_CHAO_LAI_DANG_MO"; readonly rfqStatus: string }
  | { readonly trangThai: "CHUA_CAU_HINH"; readonly policyId: string | null; readonly policyVersion: number | null }
  /** Chưa có bản lưu của lần mở thầu hiện tại — mở bảng benchmark trước (`docBenchmark` tính nó). */
  | { readonly trangThai: "CHUA_CO_BAN_LUU" }
  /** Dòng không có trên gói, hay không báo giá nào của dòng đo được (mọi hàng `KHONG_DO_DUOC`). */
  | { readonly trangThai: "KHONG_CO_DAI"; readonly lineNo: number }
  | {
      readonly trangThai: "CO";
      readonly snapshotId: string;
      readonly lineNo: number;
      readonly mocMoGia: Date;
      readonly tinhLuc: Date;
      /** Đơn vị gốc của hàng chuẩn (vd. `kg`) — dải và giá quy đổi tính theo nó. */
      readonly donViGoc: string | null;
      readonly dai: readonly DaiHien[];
      /** Giá quy đổi của từng báo giá của gói trên dòng, tại `tinhLuc` — đúng mốc nhãn đã dùng. */
      readonly giaCuaGoi: readonly {
        readonly bidVersionId: string;
        readonly trangThai: string;
        readonly donGiaQuyDoi: string | null;
        readonly tienTe: string | null;
      }[];
    };

const ngayTuMicro = (micro: bigint): Date => new Date(Number(micro / 1000n));

/** Dải của MỘT dòng, tính lại lúc bấm. `null` khi gói không có trong tổ chức — sau cổng quyền. */
export async function docDaiBenchmark(
  client: pg.PoolClient,
  orgId: string,
  input: DocDaiBenchmarkInput,
  auditPool: pg.Pool,
): Promise<DaiCuaDong | null> {
  await assertTenantBound(client, orgId, "docDaiBenchmark");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);
  await requirePermission(
    client,
    { userId: actor.id, orgId, permission: PERMISSIONS.BID_VIEW, resourceType: "RFQ", resourceId: input.rfqId },
    auditPool,
  );
  const bc = await docBoiCanh(client, orgId, input.rfqId);
  if (bc === null) return null;

  let ketQua: DaiCuaDong;
  const khongHien = trangThaiKhongHien(bc.status);
  if (khongHien !== undefined) {
    ketQua = khongHien;
  } else if (bc.nhom === null || bc.policyId === null || bc.version === null) {
    ketQua = { trangThai: "CHUA_CAU_HINH", policyId: bc.policyId, policyVersion: bc.version };
  } else {
    const dau = bc.unsealRequestId === null ? undefined : await docDauBanLuu(client, orgId, bc.unsealRequestId);
    if (dau === undefined) {
      ketQua = { trangThai: "CHUA_CO_BAN_LUU" };
    } else {
      const dong = (await docDongBanLuu(client, orgId, dau.id, input.lineNo)).filter(
        (r) => r.nhan !== "KHONG_DO_DUOC" && r.canonical_item_id !== null && r.tien_te !== null,
      );
      if (dong.length === 0) {
        ketQua = { trangThai: "KHONG_CO_DAI", lineNo: input.lineNo };
      } else {
        const mocMoGia = BigInt(dau.moc_micro);
        const mocDoc = BigInt(dau.ghi_micro);
        const dai: DaiHien[] = [];
        const giaCuaGoi: { bidVersionId: string; trangThai: string; donGiaQuyDoi: string | null; tienTe: string | null }[] = [];
        let donViGoc: string | null = null;
        for (const hang of [...new Set(dong.map((r) => r.canonical_item_id as string))].sort()) {
          const cuaHang = dong.filter((r) => r.canonical_item_id === hang);
          const kq = await tinhDaiDong(client, orgId, {
            rfqId: input.rfqId,
            canonicalItemId: hang,
            tienTe: cuaHang.map((r) => r.tien_te as string),
            nhom: bc.nhom,
            mocMoGia,
            mocDoc,
          });
          donViGoc ??= kq.donViGoc;
          for (const d of kq.dai) {
            const luu = cuaHang.filter((r) => r.tien_te === d.tienTe);
            const khop = luu.every(
              (r) =>
                r.so_quan_sat === d.soQuanSat &&
                r.so_goi === d.soGoi &&
                r.so_ncc === d.soNcc &&
                r.so_goi_cung_nguoi_tao === d.soGoiCungNguoiTao &&
                r.so_quan_sat_hoi_to === d.soQuanSatHoiTo &&
                r.so_loai_tien_te === d.soLoaiTienTe &&
                r.so_loai_gia_0 === d.soLoaiGia0,
            );
            dai.push({
              canonicalItemId: hang,
              tienTe: d.tienTe,
              cuaSoTu: ngayTuMicro(d.cuaSoTu),
              duSan: d.duSan,
              q1: d.mocSo?.q1 ?? null,
              trungVi: d.mocSo?.trungVi ?? null,
              q3: d.mocSo?.q3 ?? null,
              soQuanSat: d.soQuanSat,
              soGoi: d.soGoi,
              soNcc: d.soNcc,
              soGoiCungNguoiTao: d.soGoiCungNguoiTao,
              soQuanSatHoiTo: d.soQuanSatHoiTo,
              soLoaiTienTe: d.soLoaiTienTe,
              soLoaiGia0: d.soLoaiGia0,
              sauMoc: d.sauMoc,
              khopBanLuu: khop,
            });
          }
          for (const g of kq.giaCuaX) {
            if (g.lineNo !== input.lineNo) continue;
            giaCuaGoi.push({ bidVersionId: g.bidVersionId, trangThai: g.trangThai, donGiaQuyDoi: g.donGiaQuyDoi, tienTe: g.tienTe });
          }
        }
        ketQua = {
          trangThai: "CO",
          snapshotId: dau.id,
          lineNo: input.lineNo,
          mocMoGia: dau.moc_mo_gia,
          tinhLuc: dau.ghi_luc,
          donViGoc,
          dai,
          giaCuaGoi,
        };
      }
    }
  }

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "BENCHMARK_BAND_READ",
    resourceType: "RFQ",
    resourceId: input.rfqId,
    payload: {
      rfqId: input.rfqId,
      lineNo: input.lineNo,
      trangThai: ketQua.trangThai,
      snapshotId: ketQua.trangThai === "CO" ? ketQua.snapshotId : null,
      soDai: ketQua.trangThai === "CO" ? ketQua.dai.length : 0,
      viewedBySessionId: input.actorSessionId,
    },
  });
  return ketQua;
}
