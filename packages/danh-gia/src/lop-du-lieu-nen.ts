// ==============================================================================================
// [S1.9101 / S4.5c2] LỚP DỮ LIỆU NỀN CỦA BỘ BẰNG CHỨNG — benchmark giá của MỌI lượt chấm, tính lại được khi đã ngắt CSDL
// (spec S4 §2.5 ㉑, §4.6, §9 S4.5c; ADR-059; ADR-9201)
//
// Chủ dự án chốt 2026-10-02, cả bốn theo đề xuất:
//   ⑴ định danh gói và nhà cung cấp của các quan sát BĂM với một muối NGẪU NHIÊN mỗi lần xuất, không lưu, không ghi vào bundle —
//      hai mã băm bằng nhau ⇔ cùng một gói (hay nhà cung cấp) TRONG bundle này; không ai đọc ra được định danh thô từ mã băm.
//      [rà soát S4.5c2 — chủ dự án chốt 2026-10-02] Mã băm KHÔNG chặn được phép khớp: mốc mở giá của một gói chính xác tới micro giây
//      tự nó là định danh của gói, và (ngày, giá) khớp được với lịch sử giá mà người giữ `bid.view` đọc thẳng. Nên: `ngay` ra ở dạng
//      NGÀY UTC, trừ quan sát nằm trên một NGÀY BIÊN (ngày của mốc mở giá hay của một biên cửa sổ) — ở đó bộ kiểm cần đủ micro giây
//      để phán xử luật cửa sổ; thứ tự quan sát theo NỘI DUNG; lời hứa còn lại, nói thật: mã băm chặn ĐỌC RA định danh, không chặn
//      KHỚP (ngày, giá) với lịch sử giá của chính tổ chức, và hai bundle của cùng tổ chức nối được qua các quan sát chung;
//   ⑵ bộ kiểm tính lại TỪ ĐƠN GIÁ ĐÃ QUY ĐỔI — cửa sổ, trung vị theo gói, tứ phân vị, sàn, ngưỡng, nhãn, chiều, số đếm; phép quy đổi
//      đơn vị KHÔNG tính lại (`DAC-TA.md` nói ra);
//   ⑶ chỉ lớp LƯỢT CHẤM (`103`): bản lưu của bảng so sánh (`104`) là thứ màn hiện, không vào bundle;
//   ⑷ người ánh xạ: mã người dùng + họ tên, kèm lúc ghi, nguồn, lý do.
//
// ĐỌC GÌ, Ở ĐÂU:
//   • hàng kết quả và hàng đầu vào của lượt chấm (`price_benchmark_results`, `price_benchmark_inputs`) — nhãn, chiều, lý do, số đếm,
//     và tham chiếu (báo giá, dòng) của các quan sát đã vào dải. Không cột tiền nào: đơn giá đọc LẠI ở dưới;
//   • `quan_sat_gia(mốc mở giá, hàng chuẩn)` qua `docQuanSatTaiMoc` — một lần cho mỗi (mốc, hàng chuẩn); mốc mở giá là
//     `min(unsealed_at)` của gói nên mọi lượt chấm của gói dùng chung — bảng quan sát mang các hàng `HOP_LE` từ biên cửa sổ rộng nhất
//     tới mốc. ~~Lề một tháng trước biên~~ [rà soát S4.5c2] bỏ: nó không thêm phép phát hiện nào — một cửa sổ sai của lõi lộ ra ở
//     `cuaSoTu` đã lưu, mà bộ kiểm tính lại và so — chỉ thêm giá của gói không lượt chấm nào dùng;
//   • `quan_sat_gia(lúc chấm, hàng chuẩn)` lọc theo gói X — giá của chính các dòng tại đúng mốc lượt chấm đã đọc — cho mọi hàng chuẩn
//     mà một ánh xạ ghi TRƯỚC lúc chấm của gói trỏ tới (cùng tập ứng viên của phép tính benchmark của lượt chấm);
//   • hàng ánh xạ mà hàng kết quả trỏ tới, nối tên người ghi.
// Chi phí: (1 + số lượt chấm) × số hàng chuẩn lần đọc `quan_sat_gia` — ~0,45 s mỗi lần ở 5.000 gói (§S1.256).
//
// KHÔNG CỔNG Ở ĐÂY — cùng tư thế `dungBoBangChung`: người gọi là `xuatBoBangChung` (cổng `audit.read` + `bid.view`) hay công cụ vận
// hành giữ `DATABASE_URL`.
// ==============================================================================================
import { createHmac } from "node:crypto";
import type pg from "pg";
import { docQuanSatTaiMoc, truThang, type HangQuanSatTaiMoc } from "@trustprocure/du-lieu-nen";

/** Câu đi kèm MỌI mốc thời gian của lớp này — cùng nguồn đồng hồ CSDL chưa chứng thực (khoản 196). */
export const NGUON_THOI_GIAN_DU_LIEU_NEN =
  "đồng hồ của cơ sở dữ liệu lúc ghi — nguồn thời gian CHƯA được chứng thực (khoản 196); mọi mốc ở lớp này là micro giây UTC, " +
  "và nhãn tính lại đúng TƯƠNG ĐỐI với các mốc trong bundle, không với thời gian thực";

/** Một quan sát của bảng — định danh gói và nhà cung cấp đã băm (muối ngẫu nhiên của lần xuất này). */
export interface QuanSatBundle {
  /** Mã của quan sát TRONG bundle (`q1`, `q2`, …) — hàng đầu vào trỏ tới nó. */
  readonly ma: string;
  readonly goi: string;
  readonly ncc: string;
  /**
   * Mốc mở giá của gói chứa quan sát: NGÀY UTC (`2026-03-01`) — hay ISO đủ sáu chữ số micro giây khi ngày ấy là một ngày biên (ngày
   * của mốc mở giá hay của một biên cửa sổ). `DAC-TA.md` §8.2.
   */
  readonly ngay: string;
  /** Đơn giá đã quy đổi về đơn vị gốc của hàng chuẩn — chuỗi thập phân. */
  readonly gia: string;
  readonly tienTe: string;
  /** Gói chứa quan sát do CHÍNH người tạo gói này lập. */
  readonly cungNguoiTao: boolean;
  readonly hoiTo: readonly string[];
}

/** Mọi quan sát `HOP_LE` của một hàng chuẩn tại một mốc mở giá, từ `tuNgay` (biên cửa sổ rộng nhất) tới mốc. */
export interface BangQuanSatBundle {
  readonly mocMoGia: string;
  readonly hangChuan: string;
  readonly tuNgay: string;
  readonly quanSat: readonly QuanSatBundle[];
}

/** Hàng ánh xạ mà hàng kết quả trỏ tới — *"dòng này do ai ánh xạ, lúc nào"*. */
export interface AnhXaBundle {
  readonly anhXaId: string;
  readonly hangChuan: string | null;
  readonly nguon: string;
  readonly lyDo: string | null;
  readonly tacGia: { readonly userId: string; readonly hoTen: string | null };
  readonly ghiLuc: string;
}

/** Giá của chính dòng tại lúc chấm — một hàng `quan_sat_gia(lúc chấm, …)` của gói X; `null` khi không ánh xạ hiệu lực nào trỏ ra. */
export interface GiaDongBundle {
  /** Hàng ánh xạ hiệu lực của dòng tại lúc chấm — bộ kiểm đòi nó trùng `anhXa` của hàng kết quả. */
  readonly anhXaId: string | null;
  readonly trangThai: string;
  readonly gia: string | null;
  readonly tienTe: string | null;
  readonly hangChuan: string;
  readonly hoiTo: readonly string[];
}

/** Một hàng kết quả của lượt chấm — NGUYÊN VĂN như `price_benchmark_results` giữ — cùng đầu vào để tính lại nó. */
export interface DongBenchmarkBundle {
  readonly bidVersionId: string;
  readonly lineNo: number;
  readonly nhan: string;
  readonly chieu: string | null;
  readonly lyDo: string | null;
  readonly hangChuan: string | null;
  readonly tienTe: string | null;
  readonly cuaSoTu: string | null;
  readonly soQuanSat: number | null;
  readonly soGoi: number | null;
  readonly soNcc: number | null;
  readonly soGoiCungNguoiTao: number | null;
  readonly soQuanSatHoiTo: number | null;
  readonly soLoaiTienTe: number | null;
  readonly soLoaiGia0: number | null;
  readonly hoiTo: readonly string[];
  readonly giaDong: GiaDongBundle | null;
  readonly anhXa: AnhXaBundle | null;
}

/** Các quan sát đã vào dải của một (hàng chuẩn, tiền tệ) — NGUYÊN VĂN `price_benchmark_inputs`, trỏ bằng mã trong bundle. */
export interface DauVaoBundle {
  readonly hangChuan: string;
  readonly tienTe: string;
  readonly quanSat: readonly string[];
}

export interface LuotChamDuLieuNen {
  readonly evaluationId: string;
  /** Nhóm khoá `benchmark` của phiên bản chính sách lượt chấm đã dùng — NGUYÊN VĂN (cách viết khoá của `103`). */
  readonly chinhSachBenchmark: Readonly<Record<string, string>>;
  readonly mocMoGia: string;
  /** Lúc chấm — mốc đọc giá của chính các dòng. */
  readonly docLuc: string;
  readonly dong: readonly DongBenchmarkBundle[];
  readonly dauVao: readonly DauVaoBundle[];
  /** Số hàng đầu vào đã lưu KHÔNG tìm thấy trong bảng quan sát đọc lại — > 0 là dữ liệu đã đổi ngoài luật chỉ-ghi-thêm. */
  readonly dauVaoThieu: number;
}

export interface DuLieuNenBundle {
  readonly phuongPhap: string;
  readonly nguonThoiGian: string;
  /** Băm định danh của CHÍNH gói này, cùng muối — để người kiểm loại quan sát của gói này khỏi dải (luật ⑴ của phương pháp). */
  readonly goiX: string;
  readonly hangMuc: readonly { readonly lineNo: number; readonly moTa: string; readonly donVi: string; readonly soLuong: string }[];
  readonly bangQuanSat: readonly BangQuanSatBundle[];
  readonly luotCham: readonly LuotChamDuLieuNen[];
}

/** Micro giây kể từ epoch → ISO 8601 UTC với ĐÚNG sáu chữ số lẻ — so chuỗi theo thứ tự từ điển là so thời gian. */
export function isoMicro(micro: bigint): string {
  if (micro < 0n) throw new RangeError("mốc trước 1970 không có trong dữ liệu của hệ thống");
  const ms = micro / 1000n;
  const du = micro % 1000n;
  const iso = new Date(Number(ms)).toISOString();
  return `${iso.slice(0, 23)}${String(du).padStart(3, "0")}Z`;
}

const MICRO = (cot: string): string =>
  `(pg_catalog.extract('epoch', ${cot}) OPERATOR(pg_catalog.*) 1000000)::pg_catalog.int8::pg_catalog.text`;

interface HangKetQua {
  readonly evaluation_id: string;
  readonly bid_version_id: string;
  readonly line_no: number;
  readonly nhan: string;
  readonly chieu: string | null;
  readonly ly_do: string | null;
  readonly canonical_item_id: string | null;
  readonly anh_xa_id: string | null;
  readonly tien_te: string | null;
  readonly cua_so_tu: string | null;
  readonly so_quan_sat: number | null;
  readonly so_goi: number | null;
  readonly so_ncc: number | null;
  readonly so_goi_cung_nguoi_tao: number | null;
  readonly so_quan_sat_hoi_to: number | null;
  readonly so_loai_tien_te: number | null;
  readonly so_loai_gia_0: number | null;
  readonly hoi_to: string[];
  readonly moc: string;
  readonly cham: string;
  readonly benchmark: Record<string, string> | null;
}

/**
 * Lớp dữ liệu nền của một gói, cho các lượt chấm theo ĐÚNG thứ tự `evaluationIds` (thứ tự của lớp chấm thầu). `null` khi không lượt
 * chấm nào có hàng kết quả benchmark (phiên bản ghim chưa cấu hình nhóm `benchmark`). `muoi` — ngẫu nhiên mỗi lần xuất, người gọi
 * sinh và VỨT; không đi vào bundle.
 */
export async function docLopDuLieuNen(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
  evaluationIds: readonly string[],
  muoi: Buffer,
): Promise<DuLieuNenBundle | null> {
  // [rà soát S4.5c2] Muối ngắn hay cố định là mã băm dò ngược được — chặn ở đây, không trông vào người gọi.
  if (muoi.length < 32) throw new RangeError("muối của định danh băm phải đủ 32 byte ngẫu nhiên");
  const bam = (loai: string, id: string): string => createHmac("sha256", muoi).update(`${loai}:${id}`).digest("hex").slice(0, 32);

  const { rows: ketQua } = await client.query<HangKetQua>(
    `SELECT r.evaluation_id, r.bid_version_id, r.line_no, r.nhan, r.chieu, r.ly_do, r.canonical_item_id, r.anh_xa_id, r.tien_te,
            ${MICRO("r.cua_so_tu")} AS cua_so_tu,
            r.so_quan_sat, r.so_goi, r.so_ncc, r.so_goi_cung_nguoi_tao, r.so_quan_sat_hoi_to, r.so_loai_tien_te, r.so_loai_gia_0,
            r.hoi_to, ${MICRO("r.moc_mo_gia")} AS moc, ${MICRO("e.created_at")} AS cham, o.benchmark
       FROM public.price_benchmark_results r
       JOIN public.rfq_evaluations e ON e.id OPERATOR(pg_catalog.=) r.evaluation_id
                                    AND e.org_id OPERATOR(pg_catalog.=) r.org_id
       JOIN public.org_procurement_policies o ON o.id OPERATOR(pg_catalog.=) r.policy_id
                                             AND o.org_id OPERATOR(pg_catalog.=) r.org_id
      WHERE r.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND r.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY r.evaluation_id, r.line_no, r.bid_version_id`,
    [orgId, rfqId],
  );
  if (ketQua.length === 0) return null;
  const ketQuaTheoLuot = new Map<string, HangKetQua[]>();
  for (const r of ketQua) ketQuaTheoLuot.set(r.evaluation_id, [...(ketQuaTheoLuot.get(r.evaluation_id) ?? []), r]);

  const { rows: dauVaoLuu } = await client.query<{
    evaluation_id: string;
    canonical_item_id: string;
    tien_te: string;
    bid_version_id: string;
    line_no: number;
  }>(
    `SELECT i.evaluation_id, i.canonical_item_id, i.tien_te, i.bid_version_id, i.line_no
       FROM public.price_benchmark_inputs i
       JOIN public.rfq_evaluations e ON e.id OPERATOR(pg_catalog.=) i.evaluation_id
                                    AND e.org_id OPERATOR(pg_catalog.=) i.org_id
      WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND e.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY i.evaluation_id, i.canonical_item_id, i.tien_te, i.bid_version_id, i.line_no`,
    [orgId, rfqId],
  );

  const { rows: hangMuc } = await client.query<{ line_no: number; description: string; unit: string; quantity: string }>(
    `SELECT i.line_no, i.description, i.unit, i.quantity::pg_catalog.text AS quantity
       FROM public.rfq_items i
      WHERE i.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND i.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY i.line_no`,
    [orgId, rfqId],
  );

  const anhXaIds = [...new Set(ketQua.map((r) => r.anh_xa_id).filter((x): x is string => x !== null))];
  const { rows: anhXa } = await client.query<{
    id: string;
    canonical_item_id: string | null;
    nguon: string;
    ly_do: string | null;
    tac_gia: string;
    full_name: string | null;
    ghi: string;
  }>(
    `SELECT m.id, m.canonical_item_id, m.nguon, m.ly_do, m.tac_gia, u.full_name, ${MICRO("m.ghi_luc")} AS ghi
       FROM public.rfq_item_mappings m
       LEFT JOIN public.users u ON u.id OPERATOR(pg_catalog.=) m.tac_gia AND u.org_id OPERATOR(pg_catalog.=) m.org_id
      WHERE m.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND m.id OPERATOR(pg_catalog.=) ANY ($2::pg_catalog.uuid[])`,
    [orgId, anhXaIds],
  );
  const anhXaTheoId = new Map(
    anhXa.map((m): [string, AnhXaBundle] => [
      m.id,
      {
        anhXaId: m.id,
        hangChuan: m.canonical_item_id,
        nguon: m.nguon,
        lyDo: m.ly_do,
        tacGia: { userId: m.tac_gia, hoTen: m.full_name },
        ghiLuc: isoMicro(BigInt(m.ghi)),
      },
    ]),
  );

  // ⑴ Giá của chính các dòng tại lúc chấm của từng lượt — đúng tập ứng viên của phép tính lượt chấm, giới hạn ở ánh xạ ghi TRƯỚC lúc
  //    chấm (ánh xạ ghi sau không hiệu lực tại mốc ấy, đọc nó chỉ tốn một lần quét).
  const luotIds = evaluationIds.filter((id) => ketQuaTheoLuot.has(id));
  const giaCuaLuot = new Map<string, Map<string, GiaDongBundle>>();
  for (const id of luotIds) {
    const cham = BigInt(ketQuaTheoLuot.get(id)![0]!.cham);
    const { rows: ungVien } = await client.query<{ canonical_item_id: string }>(
      `SELECT DISTINCT m.canonical_item_id FROM public.rfq_item_mappings m
        WHERE m.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
          AND m.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
          AND m.canonical_item_id IS NOT NULL
          AND m.ghi_luc OPERATOR(pg_catalog.<) ('epoch'::pg_catalog.timestamptz OPERATOR(pg_catalog.+)
                ($3::pg_catalog.int8::pg_catalog.float8 OPERATOR(pg_catalog.*) '00:00:00.000001'::pg_catalog.interval))
        ORDER BY 1`,
      [orgId, rfqId, cham.toString()],
    );
    const gia = new Map<string, GiaDongBundle>();
    for (const { canonical_item_id: hang } of ungVien) {
      for (const r of await docQuanSatTaiMoc(client, orgId, { rfqId, canonicalItemId: hang, mocMicro: cham })) {
        if (r.rfqId !== rfqId) continue;
        gia.set(`${r.bidVersionId}:${String(r.lineNo)}`, {
          anhXaId: r.anhXaId,
          trangThai: r.trangThai,
          gia: r.donGiaQuyDoi,
          tienTe: r.tienTe,
          hangChuan: hang,
          hoiTo: r.hoiTo,
        });
      }
    }
    giaCuaLuot.set(id, gia);
  }

  // ⑵ Bảng quan sát: một cho mỗi (mốc mở giá, hàng chuẩn) mà một dòng đo được hay một hàng đầu vào cần. Biên dưới: một tháng trước
  //    biên cửa sổ rộng nhất trong các lượt chấm dùng bảng ấy.
  const canBang = new Map<string, { moc: bigint; hang: string; cuaSo: Set<number> }>();
  const can = (moc: bigint, hang: string, cuaSoThang: number): void => {
    const khoa = `${moc.toString()}|${hang}`;
    const co = canBang.get(khoa) ?? { moc, hang, cuaSo: new Set<number>() };
    co.cuaSo.add(cuaSoThang);
    canBang.set(khoa, co);
  };
  const cuaSoCua = (r: HangKetQua): number => {
    const n = Number(r.benchmark?.["cua_so_thang"]);
    if (!Number.isInteger(n) || n <= 0) throw new Error("hàng kết quả benchmark mà phiên bản chính sách không có nhóm benchmark đọc được");
    return n;
  };
  for (const r of ketQua) {
    const cuaSo = cuaSoCua(r);
    const g = giaCuaLuot.get(r.evaluation_id)?.get(`${r.bid_version_id}:${String(r.line_no)}`);
    if (g !== undefined && g.trangThai === "HOP_LE") can(BigInt(r.moc), g.hangChuan, cuaSo);
  }
  for (const i of dauVaoLuu) {
    const r = ketQuaTheoLuot.get(i.evaluation_id)?.[0];
    if (r !== undefined) can(BigInt(r.moc), i.canonical_item_id, cuaSoCua(r));
  }

  const bangQuanSat: BangQuanSatBundle[] = [];
  /** (mốc|hàng chuẩn) → (báo giá:dòng) → mã trong bundle. */
  const maCua = new Map<string, Map<string, string>>();
  let dem = 0;
  for (const { moc, hang, cuaSo } of [...canBang.values()].sort((a, b) =>
    a.moc === b.moc ? (a.hang < b.hang ? -1 : a.hang > b.hang ? 1 : 0) : a.moc < b.moc ? -1 : 1,
  )) {
    const bien = [...cuaSo].map((n) => truThang(moc, n));
    const tu = bien.reduce((a, b) => (b < a ? b : a));
    const ngayBien = new Set([moc, ...bien].map((t) => isoMicro(t).slice(0, 10)));
    const hangs = (await docQuanSatTaiMoc(client, orgId, { rfqId, canonicalItemId: hang, mocMicro: moc }))
      .filter((r) => r.trangThai === "HOP_LE" && r.ngayMicro >= tu)
      .map((r) => {
        if (r.donGiaQuyDoi === null || r.tienTe === null) throw new Error("quan sát HOP_LE không có đơn giá quy đổi hay tiền tệ");
        return { r, ngay: ngayXuat(r.ngayMicro, ngayBien), gia: r.donGiaQuyDoi, tienTe: r.tienTe };
      })
      .sort(soQuanSat);
    const ma = new Map<string, string>();
    const quanSat = hangs.map(({ r, ngay, gia, tienTe }): QuanSatBundle => {
      dem += 1;
      const m = `q${String(dem)}`;
      ma.set(`${r.bidVersionId}:${String(r.lineNo)}`, m);
      return {
        ma: m,
        goi: bam("goi", r.rfqId),
        ncc: bam("ncc", r.supplierId),
        ngay,
        gia,
        tienTe,
        cungNguoiTao: r.cungNguoiTao,
        hoiTo: r.hoiTo,
      };
    });
    maCua.set(`${moc.toString()}|${hang}`, ma);
    bangQuanSat.push({ mocMoGia: isoMicro(moc), hangChuan: hang, tuNgay: isoMicro(tu), quanSat });
  }

  const luotCham: LuotChamDuLieuNen[] = luotIds.map((id) => {
    const cuaLuot = ketQuaTheoLuot.get(id)!;
    const dau = cuaLuot[0]!;
    const gia = giaCuaLuot.get(id)!;
    const nhomDauVao = new Map<string, { hangChuan: string; tienTe: string; quanSat: string[] }>();
    let thieu = 0;
    for (const i of dauVaoLuu.filter((x) => x.evaluation_id === id)) {
      const khoa = `${i.canonical_item_id}|${i.tien_te}`;
      const nhom = nhomDauVao.get(khoa) ?? { hangChuan: i.canonical_item_id, tienTe: i.tien_te, quanSat: [] };
      const m = maCua.get(`${dau.moc}|${i.canonical_item_id}`)?.get(`${i.bid_version_id}:${String(i.line_no)}`);
      if (m === undefined) thieu += 1;
      else nhom.quanSat.push(m);
      nhomDauVao.set(khoa, nhom);
    }
    return {
      evaluationId: id,
      chinhSachBenchmark: dau.benchmark ?? {},
      mocMoGia: isoMicro(BigInt(dau.moc)),
      docLuc: isoMicro(BigInt(dau.cham)),
      dong: cuaLuot.map((r) => ({
        bidVersionId: r.bid_version_id,
        lineNo: r.line_no,
        nhan: r.nhan,
        chieu: r.chieu,
        lyDo: r.ly_do,
        hangChuan: r.canonical_item_id,
        tienTe: r.tien_te,
        cuaSoTu: r.cua_so_tu === null ? null : isoMicro(BigInt(r.cua_so_tu)),
        soQuanSat: r.so_quan_sat,
        soGoi: r.so_goi,
        soNcc: r.so_ncc,
        soGoiCungNguoiTao: r.so_goi_cung_nguoi_tao,
        soQuanSatHoiTo: r.so_quan_sat_hoi_to,
        soLoaiTienTe: r.so_loai_tien_te,
        soLoaiGia0: r.so_loai_gia_0,
        hoiTo: r.hoi_to,
        giaDong: gia.get(`${r.bid_version_id}:${String(r.line_no)}`) ?? null,
        anhXa: r.anh_xa_id === null ? null : (anhXaTheoId.get(r.anh_xa_id) ?? null),
      })),
      dauVao: [...nhomDauVao.values()].map((n) => ({ ...n, quanSat: [...n.quanSat].sort(soMa) })),
      dauVaoThieu: thieu,
    };
  });

  return {
    phuongPhap: ketQua[0]!.benchmark?.["phuong_phap"] ?? "",
    nguonThoiGian: NGUON_THOI_GIAN_DU_LIEU_NEN,
    goiX: bam("goi", rfqId),
    hangMuc: hangMuc.map((h) => ({ lineNo: h.line_no, moTa: h.description, donVi: h.unit, soLuong: h.quantity })),
    bangQuanSat,
    luotCham,
  };
}

/**
 * [rà soát S4.5c2] `ngay` của một quan sát: NGÀY UTC, trừ khi ngày ấy là một ngày biên — ở đó đủ micro giây (`DAC-TA.md` §8.2). Một
 * quan sát ngoài ngày biên phán xử được luật cửa sổ bằng ngày; quan sát TRÊN ngày biên thì không.
 */
export function ngayXuat(micro: bigint, ngayBien: ReadonlySet<string>): string {
  const iso = isoMicro(micro);
  return ngayBien.has(iso.slice(0, 10)) ? iso : iso.slice(0, 10);
}

/** So hai chuỗi thập phân không âm theo GIÁ TRỊ. */
function soGia(a: string, b: string): number {
  const [na = "", la = ""] = a.split(".");
  const [nb = "", lb = ""] = b.split(".");
  const x = na.replace(/^0+(?=\d)/u, "");
  const y = nb.replace(/^0+(?=\d)/u, "");
  if (x.length !== y.length) return x.length - y.length;
  if (x !== y) return x < y ? -1 : 1;
  const n = Math.max(la.length, lb.length);
  const u = la.padEnd(n, "0");
  const v = lb.padEnd(n, "0");
  return u === v ? 0 : u < v ? -1 : 1;
}

/**
 * Thứ tự quan sát trong bảng: theo NỘI DUNG ĐÃ XUẤT — ngày (dạng đã làm thô), giá, tiền tệ, cờ — để thứ tự không kể gì thêm ngoài thứ
 * nội dung đã kể. Định danh thô chỉ phá hoà giữa các quan sát GIỐNG HỆT nhau về nội dung — hai lần xuất cùng thứ tự dù khác muối.
 */
function soQuanSat(
  a: { readonly r: HangQuanSatTaiMoc; readonly ngay: string; readonly gia: string; readonly tienTe: string },
  b: { readonly r: HangQuanSatTaiMoc; readonly ngay: string; readonly gia: string; readonly tienTe: string },
): number {
  if (a.ngay !== b.ngay) return a.ngay < b.ngay ? -1 : 1;
  const g = soGia(a.gia, b.gia);
  if (g !== 0) return g;
  for (const [x, y] of [
    [a.tienTe, b.tienTe],
    [String(a.r.cungNguoiTao), String(b.r.cungNguoiTao)],
    [a.r.hoiTo.join(","), b.r.hoiTo.join(",")],
    [a.r.rfqId, b.r.rfqId],
    [a.r.supplierId, b.r.supplierId],
    [a.r.bidVersionId, b.r.bidVersionId],
  ] as const) {
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.r.lineNo - b.r.lineNo;
}

/** `q2` trước `q10`. */
function soMa(a: string, b: string): number {
  return Number(a.slice(1)) - Number(b.slice(1));
}
