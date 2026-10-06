// ==============================================================================================
// [S1.256 / S4.5b] BENCHMARK CỦA MỘT GÓI — tầng có trạng thái quanh lõi thuần `benchmark.ts` (spec S4 §4.6, §2.5 ⑿; L7; ADR-142).
//
// KHÔNG CỔNG Ở ĐÂY, nói ra: hai hàm của tệp này là phép TÍNH và phép GHI, gọi từ đúng hai chỗ có cổng — `taoLuotDanhGia` (cổng
// `evaluation.perform`, ghi nhãn trong giao dịch tạo lượt chấm, không trả con số nào cho người gọi) và `docBenchmark` (cổng
// `bid.view`, hàng sổ `BENCHMARK_READ`). Cổng `tests/architecture/ban-ro-liet-ke.test.ts` liệt kê tệp này cạnh `lich-su-gia.ts` và
// ghim hai chỗ gọi.
//
// PHẠM VI CỦA MỘT LẦN TÍNH: mỗi (báo giá trong `bidVersionIds`, dòng của gói X) ra ĐÚNG MỘT dòng kết quả.
//   • Giá của CHÍNH dòng đọc tại `mocDoc` (mặc định `now()` của giao dịch) — `quan_sat_gia(mocDoc, hàng chuẩn)` lọc theo X, kèm cờ hồi
//     tố của dòng (chủ dự án chốt 2026-10-01: đọc lúc tính, có cờ). Dòng không có ánh xạ hiệu lực tới hàng chuẩn nào không ra ở lần
//     đọc nào ⇒ `KHONG_DO_DUOC` lý do `CHUA_ANH_XA`, kể cả khi nó còn hỏng ở trục khác — đọc hết tổ chức (`p_hang_chuan` NULL) để
//     lấy trạng thái thật của dòng ấy tốn 84–88 s (biên bản §S1.235).
//   • Dải của (hàng chuẩn, tiền tệ của báo giá) đọc tại MỐC MỞ GIÁ của X — `min(unsealed_at)`, đúng định nghĩa `moc_goi` của
//     `quan_sat_gia` (`096`); lần đọc giá của chính X kiểm lại rằng hai định nghĩa cho cùng một mốc, lệch thì NÉM.
// [S1.9101 / S4.6b] LỊCH SỬ NGOÀI VÀ MỐC NGOÀI (ADR-9201): `kemNgoai` thêm nhãn theo dải lịch sử ngoài cho bản lưu của bảng so sánh — giá
// của chính dòng đã có trong tay ở đây, nên nhãn ngoài tính cùng lần, không thêm lần đọc as-of nào; *Xem dải* (`tinhDaiDong`) thêm số của
// dải ngoài, mốc ngoài và độ lệch. Hai bảng ngoài đọc qua `gia-ngoai.ts`; lượt chấm không bật `kemNgoai` (L15).
// Thời điểm qua lại giữa SQL và TypeScript bằng MICRO GIÂY kể từ epoch (`extract('epoch', …)` là `numeric`, đi về bằng
// `'epoch' + n · 1 µs` — khứ hồi chính xác tới năm 2255, đo ở biên bản): `Date` của JavaScript cắt mất ba chữ số.
// ==============================================================================================
import type pg from "pg";
import {
  PHUONG_PHAP_BENCHMARK,
  ganNhan,
  tinhDai,
  type ChieuLech,
  type DaiBenchmark,
  type NhanBenchmark,
  type NhomBenchmark,
  type QuanSatBenchmark,
} from "./benchmark.js";
import { chonMocNgoai, lechPhanTram, tinhDaiNgoai, type DaiNgoai } from "./dai-ngoai.js";
import { docLichSuNgoaiTaiMoc, docMocNgoaiCo, docMocNgoaiTaiMoc } from "./gia-ngoai.js";

/** Một dòng kết quả: một (báo giá, dòng của gói). Không con số nào có đơn vị tiền. */
export interface DongBenchmark {
  readonly bidVersionId: string;
  readonly lineNo: number;
  readonly anhXaId: string | null;
  readonly canonicalItemId: string | null;
  readonly nhan: NhanBenchmark;
  readonly chieu: ChieuLech | null;
  /** Trạng thái `quan_sat_gia` của chính dòng khi `KHONG_DO_DUOC`. */
  readonly lyDo: string | null;
  readonly tienTe: string | null;
  readonly cuaSoTu: bigint | null;
  readonly soQuanSat: number | null;
  readonly soGoi: number | null;
  readonly soNcc: number | null;
  readonly soGoiCungNguoiTao: number | null;
  readonly soQuanSatHoiTo: number | null;
  readonly soLoaiTienTe: number | null;
  readonly soLoaiGia0: number | null;
  /** Loại hàng nền của chính dòng ghi sau mốc mở giá của X (L1 `SAU_MO_GIA`). */
  readonly hoiTo: readonly string[];
}

export interface DaiCuaGoi extends DaiBenchmark {
  readonly canonicalItemId: string;
}

/**
 * [S1.9101 / S4.6b] Nhãn của một (báo giá, dòng) ĐO ĐƯỢC theo dải lịch sử mua ngoài hệ thống của (hàng chuẩn, tiền tệ) tại mốc mở giá
 * (`dai-ngoai.ts`). Không con số nào có đơn vị tiền. Tách khỏi `DongBenchmark` (L15: nhãn ngoài không trộn vào nhãn nội bộ).
 */
export interface DongNgoai {
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

export interface BenchmarkGoi {
  readonly rfqId: string;
  readonly phuongPhap: typeof PHUONG_PHAP_BENCHMARK;
  /** Mốc mở giá của X, micro giây. */
  readonly mocMoGia: bigint;
  /** Mốc đọc giá của chính X, micro giây. */
  readonly mocDoc: bigint;
  readonly dong: readonly DongBenchmark[];
  /** Mọi dải đã tính — một mỗi (hàng chuẩn, tiền tệ) có ít nhất một dòng `HOP_LE` của X. */
  readonly dai: readonly DaiCuaGoi[];
  /**
   * [S1.9101 / S4.6b] Nhãn theo dải lịch sử ngoài, một mỗi dòng ĐO ĐƯỢC — chỉ khi gọi với `kemNgoai` (bản lưu của bảng so sánh); `null`
   * ở lượt chấm: nhãn ngoài không vào lượt chấm, bộ bằng chứng hay cổng (e) (L15).
   */
  readonly ngoai: readonly DongNgoai[] | null;
}

export interface TinhBenchmarkGoiInput {
  readonly rfqId: string;
  /** Các báo giá đem so — đúng tập lượt chấm xếp hạng. */
  readonly bidVersionIds: readonly string[];
  readonly nhom: NhomBenchmark;
  /** Micro giây; mặc định `now()` của giao dịch. Phép tính lại L7 truyền `ghi_luc` đã lưu. */
  readonly mocDoc?: bigint;
  /**
   * [S1.9101 / S4.6b] Tính thêm nhãn theo dải lịch sử ngoài (`ngoai`). CHỈ bản lưu của bảng so sánh (`doc-benchmark.ts`, sau cổng
   * `bid.view`) bật nó — `bang-ngoai-liet-ke.test.ts` ghim rằng lượt chấm không bật.
   */
  readonly kemNgoai?: boolean;
}

interface HangCuaX {
  readonly bid_version_id: string;
  readonly line_no: number;
  readonly anh_xa_id: string | null;
  readonly canonical_item_id: string | null;
  readonly trang_thai: string;
  readonly don_gia_quy_doi: string | null;
  readonly tien_te: string | null;
  readonly hoi_to: string[];
  readonly ngay: string;
}

interface HangDai {
  readonly rfq_id: string;
  readonly supplier_id: string;
  readonly bid_version_id: string;
  readonly line_no: number;
  readonly anh_xa_id: string | null;
  readonly trang_thai: string;
  readonly don_gia_quy_doi: string | null;
  readonly tien_te: string | null;
  readonly hoi_to: string[];
  readonly ngay: string;
  readonly cung_nguoi_tao: boolean;
}

/**
 * Tính benchmark của gói X tại mốc của nó. NÉM khi gói chưa có phong bì nào mở (không mốc mở giá) — người gọi chỉ gọi sau khi giá
 * đã lộ.
 */
export async function tinhBenchmarkGoi(
  client: pg.PoolClient,
  orgId: string,
  input: TinhBenchmarkGoiInput,
): Promise<BenchmarkGoi> {
  const { rows: dau } = await client.query<{ moc: string | null; bay_gio: string; created_by: string }>(
    `SELECT (pg_catalog.extract('epoch', m.moc) OPERATOR(pg_catalog.*) 1000000)::pg_catalog.int8::pg_catalog.text AS moc,
            (pg_catalog.extract('epoch', pg_catalog.now()) OPERATOR(pg_catalog.*) 1000000)::pg_catalog.int8::pg_catalog.text AS bay_gio,
            r.created_by
       FROM public.rfq_packages r
      CROSS JOIN LATERAL (
        SELECT pg_catalog.min(u.unsealed_at) AS moc
          FROM public.unseal_requests q
          JOIN public.rfq_unsealed_bids u ON u.org_id OPERATOR(pg_catalog.=) q.org_id
                                         AND u.unseal_request_id OPERATOR(pg_catalog.=) q.id
         WHERE q.org_id OPERATOR(pg_catalog.=) r.org_id
           AND q.rfq_id OPERATOR(pg_catalog.=) r.id) m
      WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND r.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, input.rfqId],
  );
  const goi = dau[0];
  if (goi === undefined) throw new Error("không tìm thấy gói thầu để tính benchmark");
  if (goi.moc === null) throw new Error("gói thầu chưa có phong bì nào mở — không có mốc mở giá");
  const mocMoGia = BigInt(goi.moc);
  const nguoiTao = goi.created_by;
  const mocDoc = input.mocDoc ?? BigInt(goi.bay_gio);

  const { rows: dongGoi } = await client.query<{ line_no: number }>(
    `SELECT i.line_no FROM public.rfq_items i
      WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND i.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY i.line_no`,
    [orgId, input.rfqId],
  );
  // Ứng viên: MỌI hàng chuẩn mà một hàng ánh xạ nào của gói từng trỏ tới. `quan_sat_gia` giữ luật *"ánh xạ hiệu lực"* — mỗi dòng ra ở
  // đúng lần đọc của hàng chuẩn mà ánh xạ hiệu lực tại mốc của nó trỏ tới, không ra ở lần đọc nào khác.
  const { rows: ungVien } = await client.query<{ canonical_item_id: string }>(
    `SELECT DISTINCT m.canonical_item_id FROM public.rfq_item_mappings m
      WHERE m.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND m.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND m.canonical_item_id IS NOT NULL
      ORDER BY 1`,
    [orgId, input.rfqId],
  );

  const cuaX = new Map<string, HangCuaX>();
  for (const { canonical_item_id: hang } of ungVien) {
    const { rows } = await client.query<HangCuaX>(
      `SELECT q.bid_version_id, q.line_no, q.anh_xa_id, q.canonical_item_id, q.trang_thai,
              q.don_gia_quy_doi::pg_catalog.text AS don_gia_quy_doi, q.tien_te, q.hoi_to,
              (pg_catalog.extract('epoch', q.ngay_quan_sat) OPERATOR(pg_catalog.*) 1000000)::pg_catalog.int8::pg_catalog.text AS ngay
         FROM public.quan_sat_gia(
                'epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+)
                  ($1::pg_catalog.int8::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval),
                $2::pg_catalog.uuid) q
        WHERE q.rfq_id OPERATOR(pg_catalog.=) $3::pg_catalog.uuid`,
      [mocDoc.toString(), hang, input.rfqId],
    );
    for (const r of rows) {
      if (BigInt(r.ngay) !== mocMoGia) {
        throw new Error("mốc mở giá của gói lệch giữa `quan_sat_gia` và phép đọc mốc — hai định nghĩa đã trôi");
      }
      cuaX.set(`${r.bid_version_id}:${String(r.line_no)}`, r);
    }
  }

  const hangDai = new Map<string, readonly QuanSatBenchmark[]>();
  const dai = new Map<string, DaiCuaGoi>();
  async function docDai(hang: string, tienTe: string): Promise<DaiCuaGoi> {
    const khoa = `${hang}|${tienTe}`;
    const coSan = dai.get(khoa);
    if (coSan !== undefined) return coSan;
    let quanSat = hangDai.get(hang);
    if (quanSat === undefined) {
      const { rows } = await client.query<HangDai>(
        `SELECT q.rfq_id, q.supplier_id, q.bid_version_id, q.line_no, q.anh_xa_id, q.trang_thai,
                q.don_gia_quy_doi::pg_catalog.text AS don_gia_quy_doi, q.tien_te, q.hoi_to,
                (pg_catalog.extract('epoch', q.ngay_quan_sat) OPERATOR(pg_catalog.*) 1000000)::pg_catalog.int8::pg_catalog.text AS ngay,
                (r.created_by OPERATOR(pg_catalog.=) $3::pg_catalog.uuid) AS cung_nguoi_tao
           FROM public.quan_sat_gia(
                  'epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+)
                    ($1::pg_catalog.int8::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval),
                  $2::pg_catalog.uuid) q
           JOIN public.rfq_packages r ON r.id OPERATOR(pg_catalog.=) q.rfq_id
                                     AND r.org_id OPERATOR(pg_catalog.=) $4::pg_catalog.uuid
          ORDER BY q.rfq_id, q.supplier_id, q.line_no`,
        [mocMoGia.toString(), hang, nguoiTao, orgId],
      );
      quanSat = rows.map((r) => ({
        rfqId: r.rfq_id,
        supplierId: r.supplier_id,
        bidVersionId: r.bid_version_id,
        lineNo: r.line_no,
        anhXaId: r.anh_xa_id,
        ngayQuanSat: BigInt(r.ngay),
        trangThai: r.trang_thai,
        donGiaQuyDoi: r.don_gia_quy_doi,
        tienTe: r.tien_te,
        hoiTo: r.hoi_to,
        goiCungNguoiTao: r.cung_nguoi_tao,
      }));
      hangDai.set(hang, quanSat);
    }
    const moi: DaiCuaGoi = {
      ...tinhDai(quanSat, { rfqId: input.rfqId, tienTe, mocMoGia, nhom: input.nhom }),
      canonicalItemId: hang,
    };
    dai.set(khoa, moi);
    return moi;
  }

  const dong: DongBenchmark[] = [];
  const rong = {
    tienTe: null,
    cuaSoTu: null,
    soQuanSat: null,
    soGoi: null,
    soNcc: null,
    soGoiCungNguoiTao: null,
    soQuanSatHoiTo: null,
    soLoaiTienTe: null,
    soLoaiGia0: null,
  } as const;
  for (const bidVersionId of input.bidVersionIds) {
    for (const { line_no: lineNo } of dongGoi) {
      const x = cuaX.get(`${bidVersionId}:${String(lineNo)}`);
      if (x === undefined) {
        dong.push({ bidVersionId, lineNo, anhXaId: null, canonicalItemId: null, nhan: "KHONG_DO_DUOC", chieu: null, lyDo: "CHUA_ANH_XA", ...rong, hoiTo: [] });
        continue;
      }
      if (x.trang_thai !== "HOP_LE" || x.don_gia_quy_doi === null || x.tien_te === null || x.canonical_item_id === null) {
        dong.push({
          bidVersionId,
          lineNo,
          anhXaId: x.anh_xa_id,
          canonicalItemId: x.canonical_item_id,
          nhan: "KHONG_DO_DUOC",
          chieu: null,
          lyDo: x.trang_thai,
          ...rong,
          hoiTo: x.hoi_to,
        });
        continue;
      }
      const d = await docDai(x.canonical_item_id, x.tien_te);
      const { nhan, chieu } = ganNhan(x.don_gia_quy_doi, d, input.nhom);
      dong.push({
        bidVersionId,
        lineNo,
        anhXaId: x.anh_xa_id,
        canonicalItemId: x.canonical_item_id,
        nhan,
        chieu,
        lyDo: null,
        tienTe: d.tienTe,
        cuaSoTu: d.cuaSoTu,
        soQuanSat: d.soQuanSat,
        soGoi: d.soGoi,
        soNcc: d.soNcc,
        soGoiCungNguoiTao: d.soGoiCungNguoiTao,
        soQuanSatHoiTo: d.soQuanSatHoiTo,
        soLoaiTienTe: d.soLoaiTienTe,
        soLoaiGia0: d.soLoaiGia0,
        hoiTo: x.hoi_to,
      });
    }
  }

  let ngoai: DongNgoai[] | null = null;
  if (input.kemNgoai === true) {
    // Dải ngoài đọc tại MỐC MỞ GIÁ của X (L1), cùng mốc của dải nội bộ; giá của chính dòng là giá đã đọc ở trên (tại `mocDoc`).
    const doDuoc = dong.filter((d) => d.nhan !== "KHONG_DO_DUOC");
    const hangNgoai = await docLichSuNgoaiTaiMoc(client, orgId, {
      canonicalItemIds: [...new Set(doDuoc.map((d) => d.canonicalItemId as string))].sort(),
      mocMicro: mocMoGia,
    });
    const daiNgoai = new Map<string, DaiNgoai>();
    ngoai = doDuoc.map((d) => {
      const x = cuaX.get(`${d.bidVersionId}:${String(d.lineNo)}`);
      if (x?.don_gia_quy_doi == null || d.canonicalItemId === null || d.tienTe === null) {
        throw new Error("dòng đo được mà không có giá quy đổi, hàng chuẩn hay tiền tệ");
      }
      const hang = d.canonicalItemId;
      const khoa = `${hang}|${d.tienTe}`;
      let dn = daiNgoai.get(khoa);
      if (dn === undefined) {
        dn = tinhDaiNgoai(
          hangNgoai.filter((h) => h.canonicalItemId === hang),
          { tienTe: d.tienTe, mocMoGia, nhom: input.nhom },
        );
        daiNgoai.set(khoa, dn);
      }
      const { nhan, chieu } = ganNhan(x.don_gia_quy_doi, dn, input.nhom);
      return {
        bidVersionId: d.bidVersionId,
        lineNo: d.lineNo,
        canonicalItemId: hang,
        tienTe: d.tienTe,
        cuaSoTu: dn.cuaSoTu,
        denNgay: dn.denNgay,
        nhan,
        chieu,
        soDong: dn.soDong,
        soGoi: dn.soGoi,
        soNcc: dn.soNcc,
        soLoaiTienTe: dn.soLoaiTienTe,
        soLoaiKhongQuyDoi: dn.soLoaiKhongQuyDoi,
      };
    });
  }

  return { rfqId: input.rfqId, phuongPhap: PHUONG_PHAP_BENCHMARK, mocMoGia, mocDoc, dong, dai: [...dai.values()], ngoai };
}

export interface GhiBenchmarkInput {
  readonly evaluationId: string;
  readonly policyId: string;
  readonly ketQua: BenchmarkGoi;
}

/**
 * Ghi kết quả của MỘT lượt chấm — hai câu `INSERT`, trong giao dịch của người gọi. Khoá ngoại `ghi_luc → rfq_evaluations.created_at`
 * (`103`) từ chối mọi lần gọi ngoài giao dịch tạo lượt chấm ấy.
 */
export async function ghiBenchmarkLuotCham(client: pg.PoolClient, orgId: string, input: GhiBenchmarkInput): Promise<void> {
  const kq = input.ketQua;
  const dong = kq.dong.map((d) => ({
    bid_version_id: d.bidVersionId,
    line_no: d.lineNo,
    anh_xa_id: d.anhXaId,
    canonical_item_id: d.canonicalItemId,
    tien_te: d.tienTe,
    cua_so_tu: d.cuaSoTu === null ? null : d.cuaSoTu.toString(),
    nhan: d.nhan,
    chieu: d.chieu,
    ly_do: d.lyDo,
    so_quan_sat: d.soQuanSat,
    so_goi: d.soGoi,
    so_ncc: d.soNcc,
    so_goi_cung_nguoi_tao: d.soGoiCungNguoiTao,
    so_quan_sat_hoi_to: d.soQuanSatHoiTo,
    so_loai_tien_te: d.soLoaiTienTe,
    so_loai_gia_0: d.soLoaiGia0,
    hoi_to: d.hoiTo,
  }));
  await client.query(
    `INSERT INTO public.price_benchmark_results
       (org_id, evaluation_id, rfq_id, policy_id, bid_version_id, line_no, phuong_phap, moc_mo_gia, anh_xa_id, canonical_item_id,
        tien_te, cua_so_tu, nhan, chieu, ly_do, so_quan_sat, so_goi, so_ncc, so_goi_cung_nguoi_tao, so_quan_sat_hoi_to,
        so_loai_tien_te, so_loai_gia_0, hoi_to)
     SELECT $1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid, d.bid_version_id, d.line_no,
            $5::pg_catalog.text,
            'epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+)
              ($6::pg_catalog.int8::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval),
            d.anh_xa_id, d.canonical_item_id, d.tien_te,
            'epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+)
              (d.cua_so_tu::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval),
            d.nhan, d.chieu, d.ly_do, d.so_quan_sat, d.so_goi, d.so_ncc, d.so_goi_cung_nguoi_tao, d.so_quan_sat_hoi_to,
            d.so_loai_tien_te, d.so_loai_gia_0, d.hoi_to
       FROM pg_catalog.jsonb_to_recordset($7::pg_catalog.jsonb) AS d(
              bid_version_id pg_catalog.uuid, line_no pg_catalog.int4, anh_xa_id pg_catalog.uuid,
              canonical_item_id pg_catalog.uuid, tien_te pg_catalog.text, cua_so_tu pg_catalog.int8, nhan pg_catalog.text,
              chieu pg_catalog.text, ly_do pg_catalog.text, so_quan_sat pg_catalog.int4, so_goi pg_catalog.int4,
              so_ncc pg_catalog.int4, so_goi_cung_nguoi_tao pg_catalog.int4, so_quan_sat_hoi_to pg_catalog.int4,
              so_loai_tien_te pg_catalog.int4, so_loai_gia_0 pg_catalog.int4, hoi_to pg_catalog.text[])`,
    [orgId, input.evaluationId, kq.rfqId, input.policyId, kq.phuongPhap, kq.mocMoGia.toString(), JSON.stringify(dong)],
  );

  const dauVao = kq.dai.flatMap((d) =>
    d.dauVao.map((q) => ({
      canonical_item_id: d.canonicalItemId,
      tien_te: d.tienTe,
      bid_version_id: q.bidVersionId,
      line_no: q.lineNo,
      anh_xa_id: q.anhXaId,
      hoi_to: q.hoiTo,
    })),
  );
  if (dauVao.length === 0) return;
  await client.query(
    `INSERT INTO public.price_benchmark_inputs
       (org_id, evaluation_id, canonical_item_id, tien_te, bid_version_id, line_no, anh_xa_id, hoi_to)
     SELECT $1::pg_catalog.uuid, $2::pg_catalog.uuid, d.canonical_item_id, d.tien_te, d.bid_version_id, d.line_no, d.anh_xa_id,
            d.hoi_to
       FROM pg_catalog.jsonb_to_recordset($3::pg_catalog.jsonb) AS d(
              canonical_item_id pg_catalog.uuid, tien_te pg_catalog.text, bid_version_id pg_catalog.uuid,
              line_no pg_catalog.int4, anh_xa_id pg_catalog.uuid, hoi_to pg_catalog.text[])`,
    [orgId, input.evaluationId, JSON.stringify(dauVao)],
  );
}

// ----------------------------------------------------------------------------------------------
// [S1.260 / S4.5c1] BẢN LƯU CỦA BẢNG SO SÁNH VÀ DẢI CỦA MỘT DÒNG (ADR-143)
// ----------------------------------------------------------------------------------------------
// Chủ dự án chốt 2026-10-01 sau phép đo: bản benchmark của bảng so sánh TÍNH ở lần đọc ĐẦU TIÊN sau một lần mở thầu rồi lưu — một bản
// cho mỗi lần mở thầu (`price_benchmark_snapshots`, khoá `UNIQUE (org_id, unseal_request_id)`); bản lưu KHÔNG mang số nào có đơn vị
// tiền (spec §4.6). Số của dải và `SAU_MOC` tính khi người dùng bấm *Xem dải* MỘT dòng — `tinhDaiDong`, một lần đọc `quan_sat_gia` tại
// mốc mở giá cho dải và một tại `ghi_luc` của bản lưu cho giá quy đổi của chính các báo giá. Cùng tư thế với hai hàm trên: không cổng
// ở đây, chỗ gọi duy nhất là `packages/danh-gia/src/doc-benchmark.ts` (cổng `bid.view`, hàng sổ) — ghim ở `ban-ro-liet-ke.test.ts`.

export interface GhiBanLuuInput {
  /** Lần mở thầu (vòng một hay một vòng BAFO) mà bản lưu thuộc về — đã `EXECUTED`, mới nhất của gói. */
  readonly unsealRequestId: string;
  /** Phiên bản ghim của gói — khoá ngoại `price_benchmark_snapshots_phien_ban_ghim_fk` từ chối mọi phiên bản khác. */
  readonly policyId: string;
  /** Kết quả `tinhBenchmarkGoi` với `mocDoc` MẶC ĐỊNH (`now()` của chính giao dịch này — tức `ghi_luc`). */
  readonly ketQua: BenchmarkGoi;
}

/**
 * Ghi bản lưu của MỘT lần mở thầu — hai câu `INSERT` trong giao dịch của người gọi. Trả id bản vừa ghi, hay `null` khi giao dịch
 * khác đã ghi bản cho cùng lần mở thầu (`ON CONFLICT DO NOTHING` chờ giao dịch ấy xong; người gọi đọc lại bản đã có). NÉM khi
 * `ketQua.mocDoc` không phải `now()` của giao dịch: giá của chính các dòng phải đọc đúng tại `ghi_luc` thì bản lưu mới tái lập được.
 */
export async function ghiBanLuuBenchmark(client: pg.PoolClient, orgId: string, input: GhiBanLuuInput): Promise<string | null> {
  const kq = input.ketQua;
  const { rows: dau } = await client.query<{ id: string; ghi_luc: string }>(
    `INSERT INTO public.price_benchmark_snapshots (org_id, rfq_id, unseal_request_id, policy_id, phuong_phap, moc_mo_gia)
     VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid, $5::pg_catalog.text,
             'epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+)
               ($6::pg_catalog.int8::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval))
     ON CONFLICT (org_id, unseal_request_id) DO NOTHING
     RETURNING id,
               (pg_catalog.extract('epoch', ghi_luc) OPERATOR(pg_catalog.*) 1000000)::pg_catalog.int8::pg_catalog.text AS ghi_luc`,
    [orgId, kq.rfqId, input.unsealRequestId, input.policyId, kq.phuongPhap, kq.mocMoGia.toString()],
  );
  const hang = dau[0];
  if (hang === undefined) return null;
  if (BigInt(hang.ghi_luc) !== kq.mocDoc) {
    throw new Error("bản lưu benchmark phải tính với mốc đọc là now() của chính giao dịch ghi");
  }
  const dong = kq.dong.map((d) => ({
    bid_version_id: d.bidVersionId,
    line_no: d.lineNo,
    anh_xa_id: d.anhXaId,
    canonical_item_id: d.canonicalItemId,
    tien_te: d.tienTe,
    cua_so_tu: d.cuaSoTu === null ? null : d.cuaSoTu.toString(),
    nhan: d.nhan,
    chieu: d.chieu,
    ly_do: d.lyDo,
    so_quan_sat: d.soQuanSat,
    so_goi: d.soGoi,
    so_ncc: d.soNcc,
    so_goi_cung_nguoi_tao: d.soGoiCungNguoiTao,
    so_quan_sat_hoi_to: d.soQuanSatHoiTo,
    so_loai_tien_te: d.soLoaiTienTe,
    so_loai_gia_0: d.soLoaiGia0,
    hoi_to: d.hoiTo,
  }));
  if (dong.length > 0) {
    await client.query(
      `INSERT INTO public.price_benchmark_snapshot_lines
         (org_id, snapshot_id, rfq_id, policy_id, bid_version_id, line_no, anh_xa_id, canonical_item_id, tien_te, cua_so_tu, nhan,
          chieu, ly_do, so_quan_sat, so_goi, so_ncc, so_goi_cung_nguoi_tao, so_quan_sat_hoi_to, so_loai_tien_te, so_loai_gia_0, hoi_to)
       SELECT $1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid, d.bid_version_id, d.line_no,
              d.anh_xa_id, d.canonical_item_id, d.tien_te,
              'epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+)
                (d.cua_so_tu::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval),
              d.nhan, d.chieu, d.ly_do, d.so_quan_sat, d.so_goi, d.so_ncc, d.so_goi_cung_nguoi_tao, d.so_quan_sat_hoi_to,
              d.so_loai_tien_te, d.so_loai_gia_0, d.hoi_to
         FROM pg_catalog.jsonb_to_recordset($5::pg_catalog.jsonb) AS d(
                bid_version_id pg_catalog.uuid, line_no pg_catalog.int4, anh_xa_id pg_catalog.uuid,
                canonical_item_id pg_catalog.uuid, tien_te pg_catalog.text, cua_so_tu pg_catalog.int8, nhan pg_catalog.text,
                chieu pg_catalog.text, ly_do pg_catalog.text, so_quan_sat pg_catalog.int4, so_goi pg_catalog.int4,
                so_ncc pg_catalog.int4, so_goi_cung_nguoi_tao pg_catalog.int4, so_quan_sat_hoi_to pg_catalog.int4,
                so_loai_tien_te pg_catalog.int4, so_loai_gia_0 pg_catalog.int4, hoi_to pg_catalog.text[])`,
      [orgId, hang.id, kq.rfqId, input.policyId, JSON.stringify(dong)],
    );
  }
  // [S1.9101 / S4.6b] Nhãn theo dải lịch sử ngoài — cùng giao dịch (`…_cung_ban_luu_fk` của `9501`), sau các dòng mà nó trỏ về.
  const ngoai = (kq.ngoai ?? []).map((d) => ({
    bid_version_id: d.bidVersionId,
    line_no: d.lineNo,
    canonical_item_id: d.canonicalItemId,
    tien_te: d.tienTe,
    cua_so_tu: d.cuaSoTu,
    den_ngay: d.denNgay,
    nhan: d.nhan,
    chieu: d.chieu,
    so_dong: d.soDong,
    so_goi: d.soGoi,
    so_ncc: d.soNcc,
    so_loai_tien_te: d.soLoaiTienTe,
    so_loai_khong_quy_doi: d.soLoaiKhongQuyDoi,
  }));
  if (ngoai.length > 0) {
    await client.query(
      `INSERT INTO public.price_benchmark_snapshot_external_lines
         (org_id, snapshot_id, rfq_id, policy_id, bid_version_id, line_no, canonical_item_id, tien_te, cua_so_tu, den_ngay, nhan, chieu,
          so_dong, so_goi, so_ncc, so_loai_tien_te, so_loai_khong_quy_doi)
       SELECT $1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.uuid, d.bid_version_id, d.line_no,
              d.canonical_item_id, d.tien_te, d.cua_so_tu, d.den_ngay, d.nhan, d.chieu, d.so_dong, d.so_goi, d.so_ncc,
              d.so_loai_tien_te, d.so_loai_khong_quy_doi
         FROM pg_catalog.jsonb_to_recordset($5::pg_catalog.jsonb) AS d(
                bid_version_id pg_catalog.uuid, line_no pg_catalog.int4, canonical_item_id pg_catalog.uuid, tien_te pg_catalog.text,
                cua_so_tu pg_catalog.date, den_ngay pg_catalog.date, nhan pg_catalog.text, chieu pg_catalog.text,
                so_dong pg_catalog.int4, so_goi pg_catalog.int4, so_ncc pg_catalog.int4, so_loai_tien_te pg_catalog.int4,
                so_loai_khong_quy_doi pg_catalog.int4)`,
      [orgId, hang.id, kq.rfqId, input.policyId, JSON.stringify(ngoai)],
    );
  }
  return hang.id;
}

export interface TinhDaiDongInput {
  readonly rfqId: string;
  readonly canonicalItemId: string;
  /** Tiền tệ của các báo giá trên dòng — mỗi tiền tệ một dải. */
  readonly tienTe: readonly string[];
  readonly nhom: NhomBenchmark;
  /** Mốc mở giá đã lưu, micro giây. */
  readonly mocMoGia: bigint;
  /** `ghi_luc` của bản lưu, micro giây — giá quy đổi của chính các báo giá đọc tại đây, đúng mốc mà nhãn đã dùng. */
  readonly mocDoc: bigint;
}

/** Một dải tính lại khi bấm *Xem dải*: số của dải (khi đủ sàn) và `SAU_MOC` cộng trên mọi quan sát đã vào dải. */
export interface DaiDong extends DaiBenchmark {
  readonly canonicalItemId: string;
  /** Hàng nền mới hơn mốc mà lần đọc tại mốc đã BỎ QUA, đếm theo loại, tới LÚC ĐỌC này (spec §2.5 ⑿). */
  readonly sauMoc: Readonly<Record<string, number>>;
}

/** Giá quy đổi của một báo giá của gói X trên dòng — tại `mocDoc`. */
export interface GiaQuyDoiCuaX {
  readonly bidVersionId: string;
  readonly lineNo: number;
  readonly trangThai: string;
  readonly donGiaQuyDoi: string | null;
  readonly tienTe: string | null;
  /**
   * Nhãn tính lại của dòng trên dải tính lại của tiền tệ nó (`ganNhan`, cùng lõi bản lưu) — để người gọi so với nhãn đã lưu (L7).
   * `null` khi dòng không đo được hay tiền tệ của nó không nằm trong `input.tienTe`.
   */
  readonly nhan: Exclude<NhanBenchmark, "KHONG_DO_DUOC"> | null;
  readonly chieu: ChieuLech | null;
  /** [S1.9101 / S4.6b] Nhãn theo dải lịch sử ngoài của tiền tệ ấy — so với nhãn ngoài đã lưu; `null` như `nhan`. */
  readonly nhanNgoai: Exclude<NhanBenchmark, "KHONG_DO_DUOC"> | null;
  readonly chieuNgoai: ChieuLech | null;
  /** [S1.9101 / S4.6b] Độ lệch so với mốc ngoài của tiền tệ ấy, phần trăm một chữ số lẻ (`lechPhanTram`); `null` khi không có mốc. */
  readonly lechMoc: string | null;
}

/** [S1.9101 / S4.6b] Dải lịch sử ngoài của một (hàng chuẩn, tiền tệ) — số khi đủ sàn, nguồn, hàng ghi/rút sau mốc. */
export interface DaiNgoaiDong extends DaiNgoai {
  readonly canonicalItemId: string;
}

/** [S1.9101 / S4.6b] Mốc ngoài của một (hàng chuẩn, tiền tệ) tại mốc mở giá — chỉ độ lệch, không nhãn (ADR-096 ⑷). */
export interface MocNgoaiDong {
  readonly canonicalItemId: string;
  readonly tienTe: string;
  readonly moc: {
    readonly id: string;
    readonly nguon: string;
    readonly ngayHieuLuc: string;
    /** Theo đơn vị gốc, tại mốc mở giá. */
    readonly donGiaQuyDoi: string;
  } | null;
  readonly ghiSauMoc: number;
  /** Mốc được chọn đã bị rút SAU mốc mở giá — vẫn là mốc của gói này (L1). */
  readonly rutSauMoc: boolean;
}

export interface KetQuaDaiDong {
  /** Đơn vị gốc của hàng chuẩn — dải và giá quy đổi tính theo nó (vd. `kg`). `null` khi không quan sát nào ra. */
  readonly donViGoc: string | null;
  readonly dai: readonly DaiDong[];
  readonly giaCuaX: readonly GiaQuyDoiCuaX[];
  /** [S1.9101 / S4.6b] Một mỗi tiền tệ của `input.tienTe`. */
  readonly daiNgoai: readonly DaiNgoaiDong[];
  readonly mocNgoai: readonly MocNgoaiDong[];
}

/**
 * [S1.262 / S4.5c2] Một hàng của `quan_sat_gia(mốc, hàng chuẩn)` — MỌI trạng thái — cộng cờ *"gói của hàng do chính người tạo gói X
 * lập"*, mốc ở micro giây. Chung cho *Xem dải* (`tinhDaiDong`) và bộ bằng chứng (`dungBoBangChung` của `packages/danh-gia`): hai bộ
 * đọc cùng một câu thì không trôi khỏi nhau.
 */
export interface HangQuanSatTaiMoc {
  readonly rfqId: string;
  readonly supplierId: string;
  readonly bidVersionId: string;
  readonly lineNo: number;
  readonly anhXaId: string | null;
  readonly trangThai: string;
  /** Chuỗi `numeric`; chỉ có khi `HOP_LE`. */
  readonly donGiaQuyDoi: string | null;
  readonly tienTe: string | null;
  readonly donViGoc: string | null;
  readonly hoiTo: readonly string[];
  readonly sauMoc: Readonly<Record<string, number>>;
  /** Mốc mở giá của gói chứa hàng, micro giây kể từ epoch. */
  readonly ngayMicro: bigint;
  readonly cungNguoiTao: boolean;
}

export interface DocQuanSatTaiMocInput {
  /** Gói X — người tạo của nó định nghĩa cờ `cungNguoiTao`. */
  readonly rfqId: string;
  readonly canonicalItemId: string;
  /** Mốc đọc, micro giây. */
  readonly mocMicro: bigint;
}

/**
 * Một lần đọc `quan_sat_gia` cho một hàng chuẩn tại một mốc. KHÔNG CỔNG ở đây (khối đầu tệp): người gọi là `tinhDaiDong` (sau cổng
 * `bid.view` của `docDaiBenchmark`) và `dungBoBangChung` (sau cổng `audit.read` + `bid.view` của `xuatBoBangChung`, hay công cụ vận
 * hành giữ `DATABASE_URL`). `ban-ro-liet-ke.test.ts` ghim hai chỗ gọi ấy theo ký hiệu.
 */
export async function docQuanSatTaiMoc(
  client: pg.PoolClient,
  orgId: string,
  input: DocQuanSatTaiMocInput,
): Promise<readonly HangQuanSatTaiMoc[]> {
  const { rows } = await client.query<{
    rfq_id: string;
    supplier_id: string;
    bid_version_id: string;
    line_no: number;
    anh_xa_id: string | null;
    trang_thai: string;
    don_gia_quy_doi: string | null;
    tien_te: string | null;
    don_vi_goc: string | null;
    hoi_to: string[];
    sau_moc: Record<string, number> | null;
    ngay: string;
    cung_nguoi_tao: boolean | null;
  }>(
    `SELECT q.rfq_id, q.supplier_id, q.bid_version_id, q.line_no, q.anh_xa_id, q.trang_thai,
            q.don_gia_quy_doi::pg_catalog.text AS don_gia_quy_doi, q.tien_te, q.don_vi_goc, q.hoi_to, q.sau_moc,
            (pg_catalog.extract('epoch', q.ngay_quan_sat) OPERATOR(pg_catalog.*) 1000000)::pg_catalog.int8::pg_catalog.text AS ngay,
            (r.created_by OPERATOR(pg_catalog.=) x.created_by) AS cung_nguoi_tao
       FROM public.quan_sat_gia(
              'epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+)
                ($1::pg_catalog.int8::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval),
              $2::pg_catalog.uuid) q
       JOIN public.rfq_packages r ON r.id OPERATOR(pg_catalog.=) q.rfq_id
                                 AND r.org_id OPERATOR(pg_catalog.=) $3::pg_catalog.uuid
       JOIN public.rfq_packages x ON x.id OPERATOR(pg_catalog.=) $4::pg_catalog.uuid
                                 AND x.org_id OPERATOR(pg_catalog.=) $3::pg_catalog.uuid
      ORDER BY q.rfq_id, q.supplier_id, q.line_no, q.bid_version_id`,
    [input.mocMicro.toString(), input.canonicalItemId, orgId, input.rfqId],
  );
  return rows.map((r) => ({
    rfqId: r.rfq_id,
    supplierId: r.supplier_id,
    bidVersionId: r.bid_version_id,
    lineNo: r.line_no,
    anhXaId: r.anh_xa_id,
    trangThai: r.trang_thai,
    donGiaQuyDoi: r.don_gia_quy_doi,
    tienTe: r.tien_te,
    donViGoc: r.don_vi_goc,
    hoiTo: r.hoi_to,
    sauMoc: r.sau_moc ?? {},
    ngayMicro: BigInt(r.ngay),
    cungNguoiTao: r.cung_nguoi_tao === true,
  }));
}

/**
 * Dải của MỘT hàng chuẩn tại mốc mở giá đã lưu, cho từng tiền tệ, cùng giá quy đổi của các báo giá của X trên hàng chuẩn ấy. Hai lần
 * đọc `quan_sat_gia` — đúng chi phí *"bấm từng dòng"* mà chủ dự án chọn. Tính lại bằng CÙNG lõi `tinhDai` của bản lưu, nên số đếm phải
 * trùng bản lưu (L7); người gọi so.
 */
export async function tinhDaiDong(client: pg.PoolClient, orgId: string, input: TinhDaiDongInput): Promise<KetQuaDaiDong> {
  const { rows: goi } = await client.query<{ created_by: string }>(
    `SELECT r.created_by FROM public.rfq_packages r
      WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND r.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, input.rfqId],
  );
  if (goi[0] === undefined) throw new Error("không tìm thấy gói thầu để tính dải");

  const docTai = (moc: bigint): Promise<readonly HangQuanSatTaiMoc[]> =>
    docQuanSatTaiMoc(client, orgId, { rfqId: input.rfqId, canonicalItemId: input.canonicalItemId, mocMicro: moc });

  const tapDai = await docTai(input.mocMoGia);
  const quanSat: QuanSatBenchmark[] = tapDai.map((r) => ({
    rfqId: r.rfqId,
    supplierId: r.supplierId,
    bidVersionId: r.bidVersionId,
    lineNo: r.lineNo,
    anhXaId: r.anhXaId,
    ngayQuanSat: r.ngayMicro,
    trangThai: r.trangThai,
    donGiaQuyDoi: r.donGiaQuyDoi,
    tienTe: r.tienTe,
    hoiTo: r.hoiTo,
    goiCungNguoiTao: r.cungNguoiTao,
  }));
  const sauMocCua = new Map(tapDai.map((r) => [`${r.bidVersionId}:${String(r.lineNo)}`, r.sauMoc]));
  const dai: DaiDong[] = [...new Set(input.tienTe)].sort().map((tienTe) => {
    const d = tinhDai(quanSat, { rfqId: input.rfqId, tienTe, mocMoGia: input.mocMoGia, nhom: input.nhom });
    const sauMoc: Record<string, number> = {};
    for (const q of d.dauVao) {
      for (const [loai, n] of Object.entries(sauMocCua.get(`${q.bidVersionId}:${String(q.lineNo)}`) ?? {})) {
        sauMoc[loai] = (sauMoc[loai] ?? 0) + n;
      }
    }
    return { ...d, canonicalItemId: input.canonicalItemId, sauMoc };
  });

  // [S1.9101 / S4.6b] Dải lịch sử ngoài và mốc ngoài của hàng chuẩn tại MỐC MỞ GIÁ đã lưu (L1) — cùng mốc của dải nội bộ.
  const docNgoai = { canonicalItemIds: [input.canonicalItemId], mocMicro: input.mocMoGia };
  const hangNgoai = await docLichSuNgoaiTaiMoc(client, orgId, docNgoai);
  const hangMoc = await docMocNgoaiTaiMoc(client, orgId, docNgoai);
  const tienTeDs = [...new Set(input.tienTe)].sort();
  const daiNgoai: DaiNgoaiDong[] = tienTeDs.map((tienTe) => ({
    ...tinhDaiNgoai(hangNgoai, { tienTe, mocMoGia: input.mocMoGia, nhom: input.nhom }),
    canonicalItemId: input.canonicalItemId,
  }));
  const mocNgoai: MocNgoaiDong[] = tienTeDs.map((tienTe) => {
    const c = chonMocNgoai(hangMoc, { tienTe, mocMoGia: input.mocMoGia, cuaSoThang: input.nhom.cuaSoThang });
    if (c.moc !== null && c.moc.donGiaQuyDoi === null) throw new Error("mốc ngoài quy đổi được mà không có đơn giá quy đổi");
    return {
      canonicalItemId: input.canonicalItemId,
      tienTe,
      moc:
        c.moc === null
          ? null
          : { id: c.moc.id, nguon: c.moc.nguon, ngayHieuLuc: c.moc.ngayHieuLuc, donGiaQuyDoi: c.moc.donGiaQuyDoi as string },
      ghiSauMoc: c.ghiSauMoc,
      rutSauMoc: c.rutSauMoc,
    };
  });

  const tapX = (await docTai(input.mocDoc)).filter((r) => r.rfqId === input.rfqId);
  const giaCuaX: GiaQuyDoiCuaX[] = tapX.map((r) => {
    const hopLe = r.trangThai === "HOP_LE" && r.donGiaQuyDoi !== null ? r.donGiaQuyDoi : null;
    const d = dai.find((x) => x.tienTe === r.tienTe);
    const gan = hopLe !== null && d !== undefined ? ganNhan(hopLe, d, input.nhom) : null;
    const dn = daiNgoai.find((x) => x.tienTe === r.tienTe);
    const ganNgoai = hopLe !== null && dn !== undefined ? ganNhan(hopLe, dn, input.nhom) : null;
    const moc = mocNgoai.find((x) => x.tienTe === r.tienTe)?.moc ?? null;
    return {
      bidVersionId: r.bidVersionId,
      lineNo: r.lineNo,
      trangThai: r.trangThai,
      donGiaQuyDoi: r.donGiaQuyDoi,
      tienTe: r.tienTe,
      nhan: gan?.nhan ?? null,
      chieu: gan?.chieu ?? null,
      nhanNgoai: ganNgoai?.nhan ?? null,
      chieuNgoai: ganNgoai?.chieu ?? null,
      lechMoc: hopLe !== null && moc !== null ? lechPhanTram(hopLe, moc.donGiaQuyDoi) : null,
    };
  });
  const donViGoc = tapX.find((r) => r.donViGoc !== null)?.donViGoc ?? tapDai.find((r) => r.donViGoc !== null)?.donViGoc ?? null;
  return { donViGoc, dai, giaCuaX, daiNgoai, mocNgoai };
}

/** [S1.9101 / S4.6b] Cờ *"có mốc ngoài"* của một (hàng chuẩn, tiền tệ) ở bảng benchmark — nguồn và ngày hiệu lực, KHÔNG con số. */
export interface CoMocNgoai {
  readonly canonicalItemId: string;
  readonly tienTe: string;
  readonly nguon: string;
  readonly ngayHieuLuc: string;
}

/**
 * [S1.9101 / S4.6b] Cờ mốc ngoài cho các (hàng chuẩn, tiền tệ) của bảng benchmark, tại mốc mở giá đã lưu — một lần đọc không đơn giá
 * (`docMocNgoaiCo`), cùng luật chọn của *Xem dải* (`chonMocNgoai`). Đọc ở MỖI lần đọc bảng (chủ dự án chốt 2026-10-06: cờ ở bảng, số ở
 * *Xem dải*): tất định vì mọi hàng đọc tại mốc đã lưu (L1). Chỉ trả cặp CÓ mốc. KHÔNG CỔNG (khối đầu tệp) — người gọi là
 * `docBenchmark`.
 */
export async function docCoMocNgoai(
  client: pg.PoolClient,
  orgId: string,
  input: {
    readonly cap: readonly { readonly canonicalItemId: string; readonly tienTe: string }[];
    readonly mocMoGia: bigint;
    readonly cuaSoThang: number;
  },
): Promise<readonly CoMocNgoai[]> {
  const khoa = [...new Set(input.cap.map((c) => `${c.canonicalItemId}|${c.tienTe}`))].sort();
  const hang = await docMocNgoaiCo(client, orgId, {
    canonicalItemIds: [...new Set(input.cap.map((c) => c.canonicalItemId))].sort(),
    mocMicro: input.mocMoGia,
  });
  const ra: CoMocNgoai[] = [];
  for (const k of khoa) {
    const [canonicalItemId, tienTe] = k.split("|") as [string, string];
    const c = chonMocNgoai(
      hang.filter((h) => h.canonicalItemId === canonicalItemId),
      { tienTe, mocMoGia: input.mocMoGia, cuaSoThang: input.cuaSoThang },
    );
    if (c.moc !== null) ra.push({ canonicalItemId, tienTe, nguon: c.moc.nguon, ngayHieuLuc: c.moc.ngayHieuLuc });
  }
  return ra;
}
