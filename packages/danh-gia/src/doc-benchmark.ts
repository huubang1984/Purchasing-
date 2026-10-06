// ==============================================================================================
// [S1.256 / S4.5b] ĐỌC BENCHMARK CỦA MỘT GÓI — cổng `bid.view`, một hàng sổ mỗi lần đọc (spec S4 §4.6; L6, L7; ADR-140 ⑦, ADR-142).
// [S1.260 / S4.5c1] ĐỔI ĐÍCH (ADR-142 ⑼, ADR-143): ~~hai nguồn — as-of ở mỗi lần đọc khi `UNSEALED`/`BAFO_UNSEALED`, hàng của lượt chấm
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
// [rà soát S4.5c1] HAI CUỘC ĐUA, đo ở lượt rà soát đối kháng:
//   • lần mở thầu thực thi SAU lúc giao dịch đọc bắt đầu mà commit TRƯỚC câu đọc bối cảnh — `unsealed_at ≥ now()`: `quan_sat_gia` tại
//     `now()` (mốc đọc của bản lưu) không thấy báo giá vừa mở (`gia_da_lo` so `<` chặt), nên bản lưu GHI MỘT LẦN sẽ mang
//     `KHONG_DO_DUOC` vĩnh viễn cho các báo giá ấy (vòng BAFO), hay vỡ ràng buộc `moc_truoc_ghi` (vòng một). Trả `THU_LAI`, không ghi.
//   • trạng thái gói đổi TRONG lúc tính (vd. `EVALUATING → BAFO_OPEN`): trước khi ghi hay trả nhãn, ~~khoá hàng gói `FOR SHARE` rồi hỏi
//     lại trạng thái và lần mở thầu mới nhất (`kiemLaiDuoiKhoa`). Mọi cạnh trạng thái khoá hàng gói trước khi ghi, nên tới lúc commit
//     trạng thái vẫn là trạng thái đã hỏi~~ hỏi lại trạng thái và lần mở thầu mới nhất; đổi rồi thì trả trạng thái mới (không nhãn, không
//     ghi) hay `THU_LAI`.
// [S1.274 / khoản 342] CHỈ ĐƯỜNG GHI giữ khoá hàng gói. Đo ở §S1.271: `FOR SHARE` ở MỌI lượt đọc có nhãn bỏ đói các cạnh trạng thái —
// một `FOR SHARE` mới vào cạnh các khoá chia sẻ đang giữ mà không chờ bên ghi đang xếp hàng; sáu luồng đọc liên tục ⇒ cạnh chờ tới 13,4 s,
// mười hai ⇒ mọi lần hỏng ở `statement_timeout`. Nay:
//   • lần đọc ĐẦU (tính rồi ghi bản lưu) vẫn khoá `FOR SHARE` rồi hỏi lại (`kiemLaiDuoiKhoa`) — bản lưu ghi-một-lần không được ghi cho một
//     trạng thái đã rời; khoá này mở một cửa sổ cho MỖI lần mở thầu (bản lưu `UNIQUE` theo lần mở thầu), lấy SAU phép tính;
//   • lần đọc bản lưu và *Xem dải* hỏi lại KHÔNG khoá, bằng MỘT câu (`kiemLaiKhongKhoa`): trạng thái và lần mở thầu mới nhất trong cùng
//     một ảnh chụp. Lượt đọc đúng tại câu ấy; một cạnh commit sau câu ấy có thể đứng TRƯỚC hàng sổ của lượt đọc — cùng điều bảng so sánh
//     đã chấp nhận (`buildComparisonTable` đọc trạng thái một lần, không khoá, rồi ghi `COMPARISON_VIEWED`). ADR-143, đoạn bổ sung S1.274.
//
// [S1.9101 / S4.6b] LỊCH SỬ NGOÀI VÀ MỐC NGOÀI (ADR-9201; chủ dự án chốt 2026-10-06): bản lưu mang thêm nhãn theo dải lịch sử mua ngoài
// hệ thống (tính cùng lần, `kemNgoai`), bảng đọc kèm cờ *"có mốc ngoài"* (nguồn, ngày hiệu lực — không con số); *Xem dải* tính số của dải
// ngoài, con số mốc ngoài và độ lệch của từng báo giá. Nhãn ngoài không vào lượt chấm hay bộ bằng chứng (L15). Cùng cổng `bid.view`.
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
  docCoMocNgoai,
  docNhomBenchmark,
  ghiBanLuuBenchmark,
  tinhBenchmarkGoi,
  tinhDaiDong,
  type ChieuLech,
  type CoMocNgoai,
  type MocNgoaiDong,
  type NhanBenchmark,
  type NhomBenchmark,
  type SauMocNgoai,
} from "@trustprocure/du-lieu-nen";
import { docBaoGia } from "./luot-danh-gia.js";

/** Trạng thái gói mà benchmark hiện — đúng tập trạng thái bảng so sánh mở (`COMPARISON_ALLOWED_STATUSES`). */
export const TRANG_THAI_BENCHMARK_HIEN = ["UNSEALED", "EVALUATING", "BAFO_UNSEALED"] as const;

/** Vòng chào lại đang mở hay đã đóng mà chưa mở niêm phong: không nhãn nào (L6, chủ dự án chốt 2026-10-01). */
export const TRANG_THAI_VONG_CHAO_LAI = ["BAFO_OPEN", "BAFO_CLOSED"] as const;

/**
 * [S1.9101 / S4.6b] Nhãn của một (báo giá, dòng) đo được theo dải LỊCH SỬ MUA NGOÀI HỆ THỐNG, đọc từ bản lưu — tách khỏi nhãn nội bộ
 * (L15). Không con số nào có đơn vị tiền; cửa sổ là NGÀY (giờ Việt Nam) của ngày mua.
 */
export interface DongNgoaiHien {
  readonly bidVersionId: string;
  readonly lineNo: number;
  readonly canonicalItemId: string;
  readonly tienTe: string;
  readonly cuaSoTu: string;
  readonly denNgay: string;
  readonly nhan: Exclude<NhanBenchmark, "KHONG_DO_DUOC">;
  readonly chieu: ChieuLech | null;
  readonly soDong: number;
  readonly soGoi: number;
  readonly soNcc: number;
  readonly soLoaiTienTe: number;
  readonly soLoaiKhongQuyDoi: number;
}

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
  /** Lần mở thầu hay trạng thái gói đổi giữa lúc giao dịch này bắt đầu và lúc trả — không nhãn, không ghi; đọc lại là đủ. */
  | ThuLai
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
      /**
       * [S1.9101 / S4.6b] Nhãn theo dải lịch sử ngoài, một mỗi dòng đo được. `null`: bản lưu tính TRƯỚC khi có lịch sử ngoài (`9501`) —
       * có dòng đo được mà không nhãn ngoài nào; *Xem dải* vẫn tính dải ngoài.
       */
      readonly dongNgoai: readonly DongNgoaiHien[] | null;
      /** [S1.9101 / S4.6b] Cờ *"có mốc ngoài"* của các (hàng chuẩn, tiền tệ) đo được — nguồn và ngày hiệu lực, không con số. */
      readonly mocNgoai: readonly CoMocNgoai[];
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
  /** Lần mở thầu mới nhất có phong bì mở lúc `≥ now()` của giao dịch này — tính bản lưu bây giờ thì không thấy chúng. */
  readonly moHonGiaoDich: boolean;
}

async function docBoiCanh(client: pg.PoolClient, orgId: string, rfqId: string): Promise<BoiCanh | null> {
  const { rows } = await client.query<{
    status: string;
    policy_id: string | null;
    version: number | null;
    benchmark: unknown;
    unseal_request_id: string | null;
    bafo_round_id: string | null;
    mo_hon: boolean | null;
  }>(
    `SELECT p.status, o.id AS policy_id, o.version, o.benchmark, q.id AS unseal_request_id, q.bafo_round_id, q.mo_hon
       FROM public.rfq_packages p
       LEFT JOIN public.org_procurement_policies o
         ON o.id OPERATOR(pg_catalog.=) p.chinh_sach_ghim_id
        AND o.org_id OPERATOR(pg_catalog.=) p.org_id
       LEFT JOIN LATERAL (
         SELECT r.id, r.bafo_round_id,
                EXISTS (SELECT 1 FROM public.rfq_unsealed_bids u
                         WHERE u.org_id OPERATOR(pg_catalog.=) r.org_id
                           AND u.unseal_request_id OPERATOR(pg_catalog.=) r.id
                           AND u.unsealed_at OPERATOR(pg_catalog.>=) pg_catalog.now()) AS mo_hon
           FROM public.unseal_requests r
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
    moHonGiaoDich: g.mo_hon === true,
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

interface HangLuuNgoai {
  readonly bid_version_id: string;
  readonly line_no: number;
  readonly canonical_item_id: string;
  readonly tien_te: string;
  readonly cua_so_tu: string;
  readonly den_ngay: string;
  readonly nhan: Exclude<NhanBenchmark, "KHONG_DO_DUOC">;
  readonly chieu: ChieuLech | null;
  readonly so_dong: number;
  readonly so_goi: number;
  readonly so_ncc: number;
  readonly so_loai_tien_te: number;
  readonly so_loai_khong_quy_doi: number;
}

/** [S1.9101 / S4.6b] Nhãn ngoài đã lưu của một bản lưu (hay một dòng của nó). Bảng không cột tiền — không chạm hai bảng ngoài. */
async function docDongNgoaiBanLuu(
  client: pg.PoolClient,
  orgId: string,
  snapshotId: string,
  lineNo?: number,
): Promise<readonly HangLuuNgoai[]> {
  const { rows } = await client.query<HangLuuNgoai>(
    `SELECT e.bid_version_id, e.line_no, e.canonical_item_id, e.tien_te, pg_catalog.to_char(e.cua_so_tu, 'YYYY-MM-DD') AS cua_so_tu,
            pg_catalog.to_char(e.den_ngay, 'YYYY-MM-DD') AS den_ngay, e.nhan, e.chieu, e.so_dong, e.so_goi, e.so_ncc, e.so_loai_tien_te,
            e.so_loai_khong_quy_doi
       FROM public.price_benchmark_snapshot_external_lines e
      WHERE e.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND e.snapshot_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND ($3::pg_catalog.int4 IS NULL OR e.line_no OPERATOR(pg_catalog.=) $3::pg_catalog.int4)
      ORDER BY e.line_no, e.bid_version_id`,
    [orgId, snapshotId, lineNo ?? null],
  );
  return rows;
}

const dongNgoaiHien = (r: HangLuuNgoai): DongNgoaiHien => ({
  bidVersionId: r.bid_version_id,
  lineNo: r.line_no,
  canonicalItemId: r.canonical_item_id,
  tienTe: r.tien_te,
  cuaSoTu: r.cua_so_tu,
  denNgay: r.den_ngay,
  nhan: r.nhan,
  chieu: r.chieu,
  soDong: r.so_dong,
  soGoi: r.so_goi,
  soNcc: r.so_ncc,
  soLoaiTienTe: r.so_loai_tien_te,
  soLoaiKhongQuyDoi: r.so_loai_khong_quy_doi,
});

/** Dòng đo được của bản lưu — có hàng chuẩn và tiền tệ (`…_do_duoc_du_bo` của `104`). */
const doDuoc = (r: HangLuu): boolean => r.nhan !== "KHONG_DO_DUOC" && r.canonical_item_id !== null && r.tien_te !== null;

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

/** Bối cảnh đổi giữa lúc giao dịch bắt đầu và lúc trả — người đọc bấm lại là đủ. */
export type ThuLai = { readonly trangThai: "THU_LAI"; readonly rfqStatus: string };

/** Phán quyết của lần hỏi lại, chung cho hai cách hỏi: trạng thái rời tập hiện ⇒ trạng thái ấy; lần mở thầu đã khác ⇒ `THU_LAI`. */
function phanXuHoiLai(status: string, moiNhat: string | undefined, unsealRequestId: string): KhongHien | ThuLai | undefined {
  const khongHien = trangThaiKhongHien(status);
  if (khongHien !== undefined) return khongHien;
  return moiNhat === unsealRequestId ? undefined : { trangThai: "THU_LAI", rfqStatus: status };
}

/**
 * [ĐƯỜNG GHI] Khoá hàng gói `FOR SHARE` rồi hỏi lại trạng thái và lần mở thầu mới nhất — ngay TRƯỚC khi ghi bản lưu, SAU phép tính dài
 * (khuôn `kiemGoiDaNop` của `anh-xa.ts`; khoản 126: khoá hàng trước mọi lần ghi sổ của giao dịch). Hai câu, không một: dưới READ
 * COMMITTED, câu chờ khoá thấy phiên bản MỚI của hàng gói nhưng một truy vấn con trong cùng câu vẫn đọc ảnh chụp lúc câu bắt đầu — có
 * thể thiếu lần mở thầu mà chính giao dịch vừa nhả khoá đã ghi. Câu thứ hai chụp ảnh mới, và từ đây không cạnh trạng thái nào commit
 * được tới hết giao dịch này. `undefined` khi vẫn là bối cảnh cũ. [S1.274 / khoản 342] Chỉ lần đọc ĐẦU (tính rồi ghi) gọi hàm này; ĐỪNG
 * gộp nó với `kiemLaiKhongKhoa` — một câu `FOR SHARE` có truy vấn con là đúng cái bẫy trên (đo ở `benchmark.int` ⑻).
 */
async function kiemLaiDuoiKhoa(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
  unsealRequestId: string,
): Promise<KhongHien | ThuLai | undefined> {
  const { rows } = await client.query<{ status: string }>(
    "SELECT p.status FROM public.rfq_packages p WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid " +
      "AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid FOR SHARE",
    [orgId, rfqId],
  );
  const status = rows[0]?.status;
  if (status === undefined) throw new Error("gói thầu không còn đọc được giữa giao dịch benchmark");
  const khongHien = trangThaiKhongHien(status);
  if (khongHien !== undefined) return khongHien;
  const { rows: moiNhat } = await client.query<{ id: string }>(
    `SELECT r.id FROM public.unseal_requests r
      WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND r.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND r.status OPERATOR(pg_catalog.=) 'EXECUTED'
      ORDER BY r.executed_at DESC, r.id DESC
      LIMIT 1`,
    [orgId, rfqId],
  );
  return phanXuHoiLai(status, moiNhat[0]?.id, unsealRequestId);
}

/**
 * [ĐƯỜNG ĐỌC — S1.274 / khoản 342] Hỏi lại trạng thái và lần mở thầu mới nhất KHÔNG khoá, bằng MỘT câu: dưới READ COMMITTED một câu là
 * một ảnh chụp, nên trạng thái và lần mở thầu đọc cùng một thời điểm, và lượt đọc đúng tại thời điểm ấy. Không giữ gì tới commit — lượt
 * đọc không bao giờ bắt một cạnh trạng thái chờ (§S1.271: `FOR SHARE` ở đây bỏ đói chấm thầu, mở vòng BAFO, đề xuất trao thầu).
 */
async function kiemLaiKhongKhoa(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
  unsealRequestId: string,
): Promise<KhongHien | ThuLai | undefined> {
  const { rows } = await client.query<{ status: string; moi_nhat: string | null }>(
    `SELECT p.status,
            (SELECT r.id FROM public.unseal_requests r
              WHERE r.org_id OPERATOR(pg_catalog.=) p.org_id
                AND r.rfq_id OPERATOR(pg_catalog.=) p.id
                AND r.status OPERATOR(pg_catalog.=) 'EXECUTED'
              ORDER BY r.executed_at DESC, r.id DESC
              LIMIT 1) AS moi_nhat
       FROM public.rfq_packages p
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, rfqId],
  );
  const g = rows[0];
  if (g === undefined) throw new Error("gói thầu không còn đọc được giữa giao dịch benchmark");
  return phanXuHoiLai(g.status, g.moi_nhat ?? undefined, unsealRequestId);
}

/** Bối cảnh đã qua cổng trạng thái và cấu hình: có lần mở thầu, có phiên bản ghim cấu hình benchmark. */
interface BoiCanhHien extends BoiCanh {
  readonly unsealRequestId: string;
  readonly policyId: string;
  readonly version: number;
  readonly nhom: NhomBenchmark;
}

/**
 * Đọc bản lưu của lần mở thầu mới nhất, hay tính và ghi nó ở lần đọc đầu — ~~dưới khoá hàng gói (`kiemLaiDuoiKhoa`)~~ [S1.274 / khoản 342]
 * lần đọc đầu ghi dưới khoá hàng gói (`kiemLaiDuoiKhoa`); lần đọc bản lưu hỏi lại không khoá (`kiemLaiKhongKhoa`) SAU khi đã thấy bản lưu,
 * để có một thời điểm mà cả ba cùng đúng: bản lưu có, trạng thái đang hiện, vẫn là lần mở thầu ấy.
 */
async function docHayTinh(client: pg.PoolClient, orgId: string, rfqId: string, bc: BoiCanhHien): Promise<BenchmarkCuaGoi> {
  let dau = await docDauBanLuu(client, orgId, bc.unsealRequestId);
  let nguon: NguonBenchmark = "BAN_LUU";
  let mocNgoaiDaTinh: readonly CoMocNgoai[] | undefined;
  if (dau === undefined) {
    if (bc.moHonGiaoDich) return { trangThai: "THU_LAI", rfqStatus: bc.status };
    const baoGia = await docBaoGia(client, orgId, rfqId);
    // [S1.9101 / S4.6b] `kemNgoai`: nhãn theo dải lịch sử ngoài tính cùng lần — giá của chính các dòng đã có trong tay (ADR-9201).
    const kq = await tinhBenchmarkGoi(client, orgId, {
      rfqId,
      bidVersionIds: baoGia.map((b) => b.bid_version_id),
      nhom: bc.nhom,
      kemNgoai: true,
    });
    // [rà soát §S1.9101] Cờ mốc ngoài đọc TRƯỚC khoá hàng gói: lần đọc hai bảng ngoài có thể chờ một lô đang ghi (khoá tư vấn dùng chung
    // của `gia-ngoai.ts`), và cửa sổ `FOR SHARE` của S1.274 phải giữ ngắn. Cùng cặp (hàng chuẩn, tiền tệ), cùng mốc với bản sắp ghi.
    mocNgoaiDaTinh = await docCoMocNgoai(client, orgId, {
      cap: kq.dong.filter((d) => d.nhan !== "KHONG_DO_DUOC").map((d) => ({ canonicalItemId: d.canonicalItemId as string, tienTe: d.tienTe as string })),
      mocMoGia: kq.mocMoGia,
      cuaSoThang: bc.nhom.cuaSoThang,
    });
    const doi = await kiemLaiDuoiKhoa(client, orgId, rfqId, bc.unsealRequestId);
    if (doi !== undefined) return doi;
    const id = await ghiBanLuuBenchmark(client, orgId, { unsealRequestId: bc.unsealRequestId, policyId: bc.policyId, ketQua: kq });
    if (id !== null) nguon = "TINH_MOI";
    // Giao dịch khác đã ghi bản lưu: cờ đọc lại theo các dòng của bản ấy, ở dưới.
    else mocNgoaiDaTinh = undefined;
    dau = await docDauBanLuu(client, orgId, bc.unsealRequestId);
    if (dau === undefined) throw new Error("bản lưu benchmark vừa ghi (hay do giao dịch khác ghi) không đọc lại được");
  } else {
    const doi = await kiemLaiKhongKhoa(client, orgId, rfqId, bc.unsealRequestId);
    if (doi !== undefined) return doi;
  }
  const dong = await docDongBanLuu(client, orgId, dau.id);
  // [S1.9101 / S4.6b] Nhãn ngoài đã lưu; cờ mốc ngoài đọc tại mốc mở giá đã lưu (không đơn giá) — chủ dự án chốt 2026-10-06.
  const doDuocDs = dong.filter(doDuoc);
  const ngoai = await docDongNgoaiBanLuu(client, orgId, dau.id);
  const mocNgoai =
    mocNgoaiDaTinh ??
    (await docCoMocNgoai(client, orgId, {
      cap: doDuocDs.map((r) => ({ canonicalItemId: r.canonical_item_id as string, tienTe: r.tien_te as string })),
      mocMoGia: BigInt(dau.moc_micro),
      cuaSoThang: bc.nhom.cuaSoThang,
    }));
  return {
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
    dongNgoai: doDuocDs.length > 0 && ngoai.length === 0 ? null : ngoai.map(dongNgoaiHien),
    mocNgoai,
  };
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
    ketQua = await docHayTinh(client, orgId, input.rfqId, { ...bc, unsealRequestId: bc.unsealRequestId, policyId: bc.policyId, version: bc.version, nhom: bc.nhom });
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
      soDongNgoai: ketQua.trangThai === "CO" ? (ketQua.dongNgoai?.length ?? null) : 0,
      soMocNgoai: ketQua.trangThai === "CO" ? ketQua.mocNgoai.length : 0,
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

/**
 * [S1.9101 / S4.6b] Dải lịch sử ngoài của dòng: một (hàng chuẩn, tiền tệ). Số là CHUỖI thập phân theo đơn vị gốc; `null` khi dưới sàn.
 * Cửa sổ là NGÀY mua (giờ Việt Nam).
 */
export interface DaiNgoaiHien {
  readonly canonicalItemId: string;
  readonly tienTe: string;
  readonly cuaSoTu: string;
  readonly denNgay: string;
  readonly duSan: boolean;
  readonly q1: string | null;
  readonly trungVi: string | null;
  readonly q3: string | null;
  readonly soDong: number;
  readonly soGoi: number;
  readonly soNcc: number;
  readonly soLoaiTienTe: number;
  readonly soLoaiKhongQuyDoi: number;
  /** Lời khai `nguon` của các hàng đã vào dải. */
  readonly nguon: readonly string[];
  readonly sauMoc: SauMocNgoai;
  /**
   * Nhãn ngoài tính lại trùng nhãn ngoài đã lưu cho mọi báo giá của dòng ở tiền tệ này. `null`: bản lưu tính trước khi có lịch sử ngoài
   * (không nhãn ngoài nào để so). `false` là dữ liệu lệch — màn nói ra.
   */
  readonly khopBanLuu: boolean | null;
}

export type DaiCuaDong =
  | { readonly trangThai: "KHONG_HIEN"; readonly rfqStatus: string }
  | { readonly trangThai: "VONG_CHAO_LAI_DANG_MO"; readonly rfqStatus: string }
  | { readonly trangThai: "CHUA_CAU_HINH"; readonly policyId: string | null; readonly policyVersion: number | null }
  | ThuLai
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
        /** [S1.9101 / S4.6b] Độ lệch so với mốc ngoài của tiền tệ ấy, phần trăm một chữ số lẻ; `null` khi không có mốc. */
        readonly lechMoc: string | null;
      }[];
      /** [S1.9101 / S4.6b] Dải lịch sử ngoài, một mỗi (hàng chuẩn, tiền tệ) của dòng. */
      readonly daiNgoai: readonly DaiNgoaiHien[];
      /** [S1.9101 / S4.6b] Mốc ngoài, một mỗi (hàng chuẩn, tiền tệ) của dòng — chỉ độ lệch, không nhãn (ADR-096 ⑷). */
      readonly mocNgoai: readonly MocNgoaiDong[];
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
    const uid = bc.unsealRequestId;
    const dau = uid === null ? undefined : await docDauBanLuu(client, orgId, uid);
    if (uid === null || dau === undefined) {
      ketQua = { trangThai: "CHUA_CO_BAN_LUU" };
    } else {
      const dong = (await docDongBanLuu(client, orgId, dau.id, input.lineNo)).filter(doDuoc);
      const ngoaiLuu = await docDongNgoaiBanLuu(client, orgId, dau.id, input.lineNo);
      if (dong.length === 0) {
        ketQua = { trangThai: "KHONG_CO_DAI", lineNo: input.lineNo };
      } else {
        const mocMoGia = BigInt(dau.moc_micro);
        const mocDoc = BigInt(dau.ghi_micro);
        const dai: DaiHien[] = [];
        const giaCuaGoi: {
          bidVersionId: string;
          trangThai: string;
          donGiaQuyDoi: string | null;
          tienTe: string | null;
          lechMoc: string | null;
        }[] = [];
        const daiNgoai: DaiNgoaiHien[] = [];
        const mocNgoai: MocNgoaiDong[] = [];
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
            // [rà soát S4.5c1] So cả NHÃN, không chỉ số đếm: một giá lịch sử bị sửa ngoài luật chỉ-ghi-thêm dời trung vị mà không đổi
            // số đếm nào — nhãn tính lại từ giá của chính dòng (tại `ghi_luc`) trên dải tính lại phải trùng nhãn đã lưu.
            const khop = luu.every((r) => {
              const x = kq.giaCuaX.find((g) => g.bidVersionId === r.bid_version_id && g.lineNo === r.line_no);
              return (
                r.so_quan_sat === d.soQuanSat &&
                r.so_goi === d.soGoi &&
                r.so_ncc === d.soNcc &&
                r.so_goi_cung_nguoi_tao === d.soGoiCungNguoiTao &&
                r.so_quan_sat_hoi_to === d.soQuanSatHoiTo &&
                r.so_loai_tien_te === d.soLoaiTienTe &&
                r.so_loai_gia_0 === d.soLoaiGia0 &&
                x?.nhan === r.nhan &&
                x.chieu === r.chieu
              );
            });
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
          // [S1.9101 / S4.6b] Dải ngoài: so nhãn ngoài tính lại (giá của chính dòng tại `ghi_luc`, dải tại mốc) với nhãn ngoài đã lưu.
          for (const d of kq.daiNgoai) {
            const luu = ngoaiLuu.filter((r) => r.canonical_item_id === hang && r.tien_te === d.tienTe);
            const khop =
              luu.length === 0
                ? null
                : luu.every((r) => {
                    const x = kq.giaCuaX.find((g) => g.bidVersionId === r.bid_version_id && g.lineNo === r.line_no);
                    return (
                      r.cua_so_tu === d.cuaSoTu &&
                      r.den_ngay === d.denNgay &&
                      r.so_dong === d.soDong &&
                      r.so_goi === d.soGoi &&
                      r.so_ncc === d.soNcc &&
                      r.so_loai_tien_te === d.soLoaiTienTe &&
                      r.so_loai_khong_quy_doi === d.soLoaiKhongQuyDoi &&
                      x?.nhanNgoai === r.nhan &&
                      x.chieuNgoai === r.chieu
                    );
                  });
            daiNgoai.push({
              canonicalItemId: hang,
              tienTe: d.tienTe,
              cuaSoTu: d.cuaSoTu,
              denNgay: d.denNgay,
              duSan: d.duSan,
              q1: d.mocSo?.q1 ?? null,
              trungVi: d.mocSo?.trungVi ?? null,
              q3: d.mocSo?.q3 ?? null,
              soDong: d.soDong,
              soGoi: d.soGoi,
              soNcc: d.soNcc,
              soLoaiTienTe: d.soLoaiTienTe,
              soLoaiKhongQuyDoi: d.soLoaiKhongQuyDoi,
              nguon: d.nguon,
              sauMoc: d.sauMoc,
              khopBanLuu: khop,
            });
          }
          mocNgoai.push(...kq.mocNgoai);
          for (const g of kq.giaCuaX) {
            if (g.lineNo !== input.lineNo) continue;
            giaCuaGoi.push({
              bidVersionId: g.bidVersionId,
              trangThai: g.trangThai,
              donGiaQuyDoi: g.donGiaQuyDoi,
              tienTe: g.tienTe,
              lechMoc: g.lechMoc,
            });
          }
        }
        // Số của dải và giá quy đổi của gói chỉ trả khi, ~~dưới khoá hàng gói,~~ [S1.274 / khoản 342] ở một câu hỏi lại SAU phép tính, gói
        // VẪN ở trạng thái hiện của CÙNG lần mở thầu (L6). *Xem dải* không ghi gì nên không khoá hàng gói.
        const doi = await kiemLaiKhongKhoa(client, orgId, input.rfqId, uid);
        ketQua = doi ?? {
          trangThai: "CO",
          snapshotId: dau.id,
          lineNo: input.lineNo,
          mocMoGia: dau.moc_mo_gia,
          tinhLuc: dau.ghi_luc,
          donViGoc,
          dai,
          giaCuaGoi,
          daiNgoai,
          mocNgoai,
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
      soDaiNgoai: ketQua.trangThai === "CO" ? ketQua.daiNgoai.length : 0,
      soMocNgoai: ketQua.trangThai === "CO" ? ketQua.mocNgoai.filter((m) => m.moc !== null).length : 0,
      viewedBySessionId: input.actorSessionId,
    },
  });
  return ketQua;
}
