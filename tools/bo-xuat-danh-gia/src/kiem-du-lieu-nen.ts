// ==============================================================================================
// [S1.9101 / S4.5c2] KIỂM LỚP DỮ LIỆU NỀN — HAI LỚP, CÙNG KHUÔN `kiem.ts` (ADR-059)
//
// ⑴ Lớp gọi hàm thuần — `nhanMotDong` của `@trustprocure/du-lieu-nen` (đúng `tinhDai` + `ganNhan` của lượt chấm). Rẻ, bắt hồi quy.
// ⑵ Lớp độc lập — `./doc-lap/benchmark-lai.ts`, viết từ `DAC-TA.md` §8. KẾT LUẬN của lớp dữ liệu nền là kết luận của lớp ⑵; hai lớp
//    bất đồng ⇒ đỏ, và nói ra rằng hai lớp bất đồng.
//
// So gì, mỗi dòng: nhãn, chiều, lý do, tiền tệ, cửa sổ, bảy số đếm, cờ hồi tố của dòng (với `giaDong.hoiTo`); mỗi (lượt chấm, hàng
// chuẩn, tiền tệ): tập quan sát vào dải tính lại BẰNG tập đầu vào đã lưu (§8.6). Mỗi lượt chấm: `dauVaoThieu = 0`, lượt chấm có trong
// lớp chấm thầu, mọi báo giá của dòng có trong bảng xếp hạng của lượt ấy.
// ==============================================================================================

import { docNhomBenchmark, nhanMotDong, type QuanSatBenchmark } from "@trustprocure/du-lieu-nen";
import { tinhLaiDong, type DongTinhLai, type QuanSatTinh } from "./doc-lap/benchmark-lai.js";
import type { BoBangChung, DongBenchmarkDoc, DuLieuNenDoc, LuotChamDuLieuNenDoc } from "./bo.js";

/** Chữ ký của lớp ⑴ cho một dòng `HOP_LE`. Test tiêm một bản CÓ LỖI vào đây. */
export type TinhBenchmarkHamThuan = (
  quanSat: readonly QuanSatTinh[],
  vao: {
    readonly goiX: string;
    readonly mocMoGia: string;
    readonly nhom: LuotChamDuLieuNenDoc["chinhSachBenchmark"];
    readonly tienTe: string;
    readonly gia: string;
  },
) => {
  readonly nhan: string;
  readonly chieu: string | null;
  readonly dauVao: readonly string[];
  /** Cửa sổ và bảy số đếm của dải — hai lớp so TRỌN, không chỉ nhãn (rà soát S4.5c2). */
  readonly cuaSoTu: string;
  readonly soDem: readonly number[];
};

/**
 * ISO sáu chữ số lẻ → micro giây; ngày trơn (§8.2, ngoài ngày biên) → giữa trưa của ngày ấy — mọi giờ trong một ngày không biên cho cùng
 * một phán xử cửa sổ. Ở lớp ⑴ (không phải lớp độc lập) — nó nói ngôn ngữ của lõi.
 */
function micro(iso: string): bigint {
  const day = iso.length === 10 ? `${iso}T12:00:00.000000Z` : iso;
  return BigInt(Date.parse(`${day.slice(0, 23)}Z`)) * 1000n + BigInt(day.slice(23, 26));
}

/** Micro giây → ISO sáu chữ số lẻ. */
function isoMicro(m: bigint): string {
  return `${new Date(Number(m / 1000n)).toISOString().slice(0, 23)}${String(m % 1000n).padStart(3, "0")}Z`;
}

export const HAM_THUAN_BENCHMARK_THAT: TinhBenchmarkHamThuan = (quanSat, vao) => {
  const nhom = docNhomBenchmark(vao.nhom);
  if (nhom === null) throw new Error("nhóm benchmark rỗng");
  const qs: QuanSatBenchmark[] = quanSat.map((q) => ({
    rfqId: q.goi,
    supplierId: q.ncc,
    bidVersionId: q.ma,
    lineNo: 1,
    anhXaId: null,
    ngayQuanSat: micro(q.ngay),
    trangThai: "HOP_LE",
    donGiaQuyDoi: q.gia,
    tienTe: q.tienTe,
    hoiTo: q.hoiTo,
    goiCungNguoiTao: q.cungNguoiTao,
  }));
  const kq = nhanMotDong(qs, { rfqId: vao.goiX, tienTe: vao.tienTe, mocMoGia: micro(vao.mocMoGia), nhom, gia: vao.gia });
  const d = kq.dai;
  return {
    nhan: kq.nhan,
    chieu: kq.chieu,
    dauVao: d.dauVao.map((q) => q.bidVersionId),
    cuaSoTu: isoMicro(d.cuaSoTu),
    soDem: [d.soQuanSat, d.soGoi, d.soNcc, d.soGoiCungNguoiTao, d.soQuanSatHoiTo, d.soLoaiTienTe, d.soLoaiGia0],
  };
};

export interface KiemDongBenchmark {
  readonly evaluationId: string;
  readonly bidVersionId: string;
  readonly lineNo: number;
  readonly ketLuan: "DAT" | "LECH";
  readonly noi: readonly string[];
}

export interface KetQuaKiemDuLieuNen {
  readonly soDong: number;
  readonly soDat: number;
  readonly soLech: number;
  readonly dong: readonly KiemDongBenchmark[];
  /** Lệch ở mức lớp: lượt chấm lạ, đầu vào đã lưu thiếu hay thừa, bảng quan sát thiếu. */
  readonly loi: readonly string[];
}

const TRUONG_SO_SANH = [
  "nhan",
  "chieu",
  "lyDo",
  "tienTe",
  "cuaSoTu",
  "soQuanSat",
  "soGoi",
  "soNcc",
  "soGoiCungNguoiTao",
  "soQuanSatHoiTo",
  "soLoaiTienTe",
  "soLoaiGia0",
] as const;

function kiemMotDong(
  dln: DuLieuNenDoc,
  luot: LuotChamDuLieuNenDoc,
  d: DongBenchmarkDoc,
  hamThuan: TinhBenchmarkHamThuan,
  dauVaoTinh: Map<string, readonly string[]>,
): KiemDongBenchmark {
  const noi: string[] = [];
  const ten = `lượt ${luot.evaluationId} · báo giá ${d.bidVersionId} · dòng ${String(d.lineNo)}`;
  const bang =
    d.giaDong === null || d.giaDong.trangThai !== "HOP_LE"
      ? []
      : dln.bangQuanSat.find((b) => b.mocMoGia === luot.mocMoGia && b.hangChuan === d.giaDong?.hangChuan)?.quanSat;
  if (bang === undefined) {
    return { evaluationId: luot.evaluationId, bidVersionId: d.bidVersionId, lineNo: d.lineNo, ketLuan: "LECH", noi: [`${ten}: không có bảng quan sát của (mốc, hàng chuẩn) — không tính lại được`] };
  }
  let tinh: DongTinhLai;
  try {
    tinh = tinhLaiDong(d.giaDong, bang, { goiX: dln.goiX, mocMoGia: luot.mocMoGia, nhom: luot.chinhSachBenchmark });
  } catch (e) {
    return { evaluationId: luot.evaluationId, bidVersionId: d.bidVersionId, lineNo: d.lineNo, ketLuan: "LECH", noi: [`${ten}: ${e instanceof Error ? e.message : String(e)}`] };
  }
  for (const truong of TRUONG_SO_SANH) {
    if (tinh[truong] !== d[truong]) {
      noi.push(`${ten}: \`${truong}\` đã lưu ${JSON.stringify(d[truong])}, tính lại ra ${JSON.stringify(tinh[truong])}`);
    }
  }
  if (d.giaDong !== null && [...d.hoiTo].sort().join(",") !== [...d.giaDong.hoiTo].sort().join(",")) {
    noi.push(`${ten}: cờ hồi tố đã lưu [${d.hoiTo.join(",")}] khác giá của dòng [${d.giaDong.hoiTo.join(",")}]`);
  }
  // [rà soát S4.5c2] §8.7: hàng ánh xạ mà hàng kết quả trỏ tới PHẢI là hàng hiệu lực của dòng tại lúc chấm — câu "do ai ánh xạ" đứng
  // trên nó. Dòng không ánh xạ thì không hàng ánh xạ, không hàng chuẩn, không cờ hồi tố.
  if (d.giaDong === null) {
    if (d.anhXa !== null || d.hangChuan !== null || d.hoiTo.length > 0) {
      noi.push(`${ten}: dòng không có ánh xạ hiệu lực mà hàng đã lưu mang ánh xạ, hàng chuẩn hay cờ hồi tố`);
    }
  } else {
    if (d.anhXa === null || d.anhXa.anhXaId !== d.giaDong.anhXaId) {
      noi.push(`${ten}: hàng ánh xạ đã lưu ${d.anhXa?.anhXaId ?? "null"} KHÁC hàng hiệu lực tại lúc chấm ${d.giaDong.anhXaId ?? "null"}`);
    }
    if (d.hangChuan !== d.giaDong.hangChuan || (d.anhXa !== null && d.anhXa.hangChuan !== d.giaDong.hangChuan)) {
      noi.push(`${ten}: hàng chuẩn của hàng đã lưu / của hàng ánh xạ khác hàng chuẩn của giá dòng (${d.giaDong.hangChuan})`);
    }
  }
  if (tinh.dauVao !== null && d.giaDong?.tienTe !== null && d.giaDong !== null) {
    const khoa = `${d.giaDong.hangChuan}|${d.giaDong.tienTe ?? ""}`;
    const co = dauVaoTinh.get(khoa);
    const moi = [...tinh.dauVao].sort().join(",");
    if (co !== undefined && [...co].sort().join(",") !== moi) {
      noi.push(`${ten}: hai dòng cùng (hàng chuẩn, tiền tệ) tính ra hai tập quan sát khác nhau`);
    }
    dauVaoTinh.set(khoa, tinh.dauVao);
  }
  // Lớp ⑴ — chỉ trên dòng có dải; bất đồng với lớp ⑵ là một kết luận, không phải một chi tiết.
  if (d.giaDong !== null && d.giaDong.trangThai === "HOP_LE" && d.giaDong.gia !== null && d.giaDong.tienTe !== null) {
    try {
      const ht = hamThuan(bang, {
        goiX: dln.goiX,
        mocMoGia: luot.mocMoGia,
        nhom: luot.chinhSachBenchmark,
        tienTe: d.giaDong.tienTe,
        gia: d.giaDong.gia,
      });
      const demDocLap = [
        tinh.soQuanSat,
        tinh.soGoi,
        tinh.soNcc,
        tinh.soGoiCungNguoiTao,
        tinh.soQuanSatHoiTo,
        tinh.soLoaiTienTe,
        tinh.soLoaiGia0,
      ];
      if (
        ht.nhan !== tinh.nhan ||
        ht.chieu !== tinh.chieu ||
        ht.cuaSoTu !== tinh.cuaSoTu ||
        ht.soDem.join(",") !== demDocLap.join(",") ||
        [...ht.dauVao].sort().join(",") !== [...(tinh.dauVao ?? [])].sort().join(",")
      ) {
        noi.push(`${ten}: HAI LỚP BẤT ĐỒNG — hàm thuần ra ${ht.nhan}/${String(ht.chieu)}, bản cài độc lập ra ${tinh.nhan}/${String(tinh.chieu)}`);
      }
    } catch (e) {
      noi.push(`${ten}: lớp gọi hàm thuần ném: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { evaluationId: luot.evaluationId, bidVersionId: d.bidVersionId, lineNo: d.lineNo, ketLuan: noi.length === 0 ? "DAT" : "LECH", noi };
}

/** Kiểm lớp dữ liệu nền. Thuần: không CSDL, không đồng hồ, không đĩa. `null` khi bundle không mang lớp này. */
export function kiemDuLieuNen(
  bo: BoBangChung,
  hamThuan: TinhBenchmarkHamThuan = HAM_THUAN_BENCHMARK_THAT,
): KetQuaKiemDuLieuNen | null {
  const dln = bo.duLieuNen;
  const canBenchmark = bo.luotCham.filter((l) => l.coBenchmark).map((l) => l.evaluationId);
  if (dln === null) {
    // [rà soát S4.5c2] Một bundle bỏ cả lớp không được qua như một bundle không có gì để kiểm (§8, *đủ*).
    if (canBenchmark.length === 0) return null;
    return {
      soDong: 0,
      soDat: 0,
      soLech: 0,
      dong: [],
      loi: [`lớp dữ liệu nền VẮNG mà ${String(canBenchmark.length)} lượt chấm có phiên bản chính sách cấu hình benchmark`],
    };
  }
  const loi: string[] = [];
  const dong: KiemDongBenchmark[] = [];
  for (const id of canBenchmark) {
    if (!dln.luotCham.some((l) => l.evaluationId === id)) {
      loi.push(`lượt chấm ${id} có phiên bản chính sách cấu hình benchmark mà lớp dữ liệu nền không mang nó`);
    }
  }
  for (const luot of dln.luotCham) {
    const luotCham = bo.luotCham.find((l) => l.evaluationId === luot.evaluationId);
    if (luotCham === undefined) loi.push(`lớp dữ liệu nền mang lượt chấm ${luot.evaluationId} KHÔNG có ở lớp chấm thầu`);
    else if (!luotCham.coBenchmark) loi.push(`lớp dữ liệu nền mang lượt chấm ${luot.evaluationId} mà chính sách của nó KHÔNG cấu hình benchmark`);
    // §8.5 *đủ*: mỗi (báo giá của bảng xếp hạng, dòng của gói) ĐÚNG MỘT hàng — không thiếu, không trùng.
    if (luotCham !== undefined) {
      const daThay = new Set<string>();
      const trung: string[] = [];
      for (const d of luot.dong) {
        const k = `${d.bidVersionId}:${String(d.lineNo)}`;
        if (daThay.has(k)) trung.push(k);
        daThay.add(k);
      }
      const thieu = luotCham.hang
        .flatMap((h) => dln.hangMuc.map((m) => `${h.bidVersionId}:${String(m.lineNo)}`))
        .filter((k) => !daThay.has(k));
      if (trung.length > 0) loi.push(`lượt ${luot.evaluationId}: hàng benchmark TRÙNG (${trung.join(", ")})`);
      if (thieu.length > 0) loi.push(`lượt ${luot.evaluationId}: THIẾU hàng benchmark cho (báo giá:dòng) ${thieu.join(", ")}`);
    }
    if (luot.dauVaoThieu > 0) {
      loi.push(`lượt ${luot.evaluationId}: ${String(luot.dauVaoThieu)} đầu vào đã lưu không còn trong bảng quan sát đọc lại (§8.6)`);
    }
    const dauVaoTinh = new Map<string, readonly string[]>();
    for (const d of luot.dong) {
      if (luotCham !== undefined && !luotCham.hang.some((h) => h.bidVersionId === d.bidVersionId)) {
        loi.push(`lượt ${luot.evaluationId}: báo giá ${d.bidVersionId} có nhãn benchmark mà không có trong bảng xếp hạng`);
      }
      dong.push(kiemMotDong(dln, luot, d, hamThuan, dauVaoTinh));
    }
    // §8.6: tập đầu vào đã lưu của mỗi (hàng chuẩn, tiền tệ) BẰNG tập tính lại — không thiếu, không thừa nhóm nào.
    for (const dv of luot.dauVao) {
      const tinh = dauVaoTinh.get(`${dv.hangChuan}|${dv.tienTe}`);
      if (tinh === undefined) {
        loi.push(`lượt ${luot.evaluationId}: đầu vào đã lưu của (${dv.hangChuan}, ${dv.tienTe}) không ứng với dòng đo được nào`);
      } else if ([...tinh].sort().join(",") !== [...dv.quanSat].sort().join(",")) {
        loi.push(
          `lượt ${luot.evaluationId}: đầu vào đã lưu của (${dv.hangChuan}, ${dv.tienTe}) có ${String(dv.quanSat.length)} quan sát, ` +
            `tính lại ra ${String(tinh.length)} — hai tập khác nhau`,
        );
      }
    }
    for (const [khoa, tinh] of dauVaoTinh) {
      if (tinh.length > 0 && !luot.dauVao.some((dv) => `${dv.hangChuan}|${dv.tienTe}` === khoa)) {
        loi.push(`lượt ${luot.evaluationId}: (${khoa.replace("|", ", ")}) tính lại ra ${String(tinh.length)} quan sát mà không có đầu vào đã lưu nào`);
      }
    }
  }
  const soDat = dong.filter((d) => d.ketLuan === "DAT").length;
  return { soDong: dong.length, soDat, soLech: dong.length - soDat, dong, loi };
}
