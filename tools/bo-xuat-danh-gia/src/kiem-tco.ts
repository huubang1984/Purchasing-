// ==============================================================================================
// [S1.9101 / S4.7c2] KIỂM PHÉP QUY ĐỔI TCO VÀ CAM KẾT CỦA ĐỀ XUẤT — `DAC-TA.md` §9, §10
//
// Hai lớp như `kiem.ts`: lớp ⑵ (`doc-lap/quy-doi-lai.ts`, viết từ đặc tả, mảng chữ số) là CHỦ THỂ của bảo đảm; lớp ⑴ gọi CHÍNH ba
// hàm lượt chấm dùng (`chiPhiThanhToan`, `chiPhiTre`, `xepHang` của `@trustprocure/danh-gia`) — rẻ, và để bắt chính nó bất đồng
// với lớp ⑵. Hai lớp bất đồng ⇒ ĐỎ và nói ra (ADR-059).
//
// Chủ dự án chốt 2026-10-10 (ADR-9201): tính lại phép quy đổi ở MỌI hàng của MỌI lượt chấm, không chỉ báo giá được đề xuất; phán
// cam kết cả vế khớp lẫn luật giải trình (có ⇔ lệch hạng); văn bản giải trình vào bộ nguyên văn. KHÔNG phán ai được trao là đúng
// (§7 giữ nguyên).
// ==============================================================================================

import { chiPhiThanhToan, chiPhiTre, xepHang } from "@trustprocure/danh-gia";
import type { CamKetDoc, GoiTcoDoc, HangBundle, LuotChamBundle, ThanhPhanLuu, BoBangChung } from "./bo.js";
import { chiPhiThanhToanLai, chiPhiTreLai, hangGiaLai } from "./doc-lap/quy-doi-lai.js";

export const MA_THANH_TOAN = "chi_phi_thanh_toan";
export const MA_TRE = "chi_phi_tre";
const KHOA_THANH_TOAN = ["coSo", "ngayChuan", "ngayKhai", "tyLe"];
const KHOA_TRE = ["coSo", "ngayKhai", "ngayYeuCau", "tyLe"];
const KHUON_NGAY = /^(0|[1-9][0-9]{0,4})$/u;
const KHUON_TIEN = /^[0-9]{1,16}\.[0-9]{2}$/u;

/** Chữ ký của lớp ⑴. Mặc định bọc ba hàm thật; test tiêm một bản CÓ LỖI vào đây để đo lời báo hai lớp bất đồng. */
export interface QuyDoiHamThuan {
  readonly thanhToan: (coSo: string, ngayKhai: string, ngayChuan: string, tyLe: string) => string | null;
  readonly tre: (coSo: string, ngayKhai: string, ngayYeuCau: string, tyLe: string) => string | null;
  readonly xepHang: (gia: readonly (string | null)[]) => readonly (number | null)[];
}

function boc(f: () => string): string | null {
  try {
    return f();
  } catch {
    return null;
  }
}

export const QUY_DOI_THAT: QuyDoiHamThuan = {
  thanhToan: (coSo, ngayKhai, ngayChuan, tyLe) =>
    KHUON_NGAY.test(ngayKhai) && KHUON_NGAY.test(ngayChuan)
      ? boc(() => chiPhiThanhToan(coSo, Number(ngayChuan), Number(ngayKhai), tyLe))
      : null,
  tre: (coSo, ngayKhai, ngayYeuCau, tyLe) =>
    KHUON_NGAY.test(ngayKhai) && KHUON_NGAY.test(ngayYeuCau)
      ? boc(() => chiPhiTre(coSo, Number(ngayYeuCau), Number(ngayKhai), tyLe))
      : null,
  xepHang: (gia) => xepHang(gia),
};

function thanhPhanGia(hang: HangBundle | { readonly components: readonly ThanhPhanLuu[] }): ThanhPhanLuu | undefined {
  return hang.components.find((c) => c.ma === "gia");
}

/** Lời báo của một phép tính hai lớp: lệch theo từng lớp, rồi một câu khi chỉ MỘT lớp lệch. */
function haiLop(nhan: string, luu: string | undefined, docLap: string | null, thuan: string | null): readonly string[] {
  const noi: string[] = [];
  const lechDocLap = docLap === null || docLap !== luu;
  const lechThuan = thuan === null || thuan !== luu;
  if (lechDocLap) {
    noi.push(`lớp độc lập: ${nhan} đã lưu ${String(luu)}, tính lại ra ${docLap === null ? "KHÔNG tính được" : docLap}`);
  }
  if (lechThuan) {
    noi.push(`lớp hàm thuần: ${nhan} đã lưu ${String(luu)}, tính lại ra ${thuan === null ? "KHÔNG tính được" : thuan}`);
  }
  if (!lechDocLap && lechThuan) {
    noi.push("HAI LỚP BẤT ĐỒNG: lớp độc lập nói ĐẠT, lớp hàm thuần nói LỆCH — một trong hai bản cài đang sai");
  }
  if (lechDocLap && !lechThuan) {
    noi.push(
      "HAI LỚP BẤT ĐỒNG: lớp hàm thuần nói ĐẠT, lớp độc lập nói LỆCH — hình dạng của một lỗi NẰM TRONG phép quy đổi của lượt chấm (ADR-059)",
    );
  }
  return noi;
}

/**
 * `DAC-TA.md` §9.3, §9.4 cho MỘT hàng: mọi mã quy đổi mang `nguon` đủ khoá, khớp `gia` của hàng và thước của gói, `giaTri` tính lại
 * được ở cả hai lớp; hàng có số thì không mang `maThieu`. Rỗng khi ĐẠT.
 */
export function kiemQuyDoiHang(goi: GoiTcoDoc, hang: HangBundle, hamThuan: QuyDoiHamThuan = QUY_DOI_THAT): readonly string[] {
  const noi: string[] = [];
  if (hang.effectiveCost !== null && hang.maThieu !== null) {
    noi.push(`hàng có effectiveCost mà mang maThieu [${hang.maThieu.join(", ")}] (§9.4)`);
  }
  const gia = thanhPhanGia(hang);
  for (const c of hang.components) {
    if (c.ma !== MA_THANH_TOAN && c.ma !== MA_TRE) continue;
    const ten = `thành phần "${c.ma}"`;
    const khoa = c.ma === MA_THANH_TOAN ? KHOA_THANH_TOAN : KHOA_TRE;
    if (c.nguon === undefined) {
      noi.push(`${ten} là mã quy đổi mà không mang \`nguon\` (§9.3 bước 1)`);
      continue;
    }
    const n = c.nguon;
    const coKhoa = Object.keys(n).sort().join(",");
    if (coKhoa !== khoa.join(",")) {
      noi.push(`${ten}: \`nguon\` cần đúng khoá ${khoa.join(",")}, gặp ${coKhoa} (§9.3 bước 1)`);
      continue;
    }
    const coSo = n["coSo"] ?? "";
    const ngayKhai = n["ngayKhai"] ?? "";
    const tyLe = n["tyLe"] ?? "";
    if (gia?.giaTri === undefined || coSo !== gia.giaTri) {
      noi.push(`${ten}: nguon.coSo ${coSo} khác giaTri của "gia" ${String(gia?.giaTri)} (§9.3 bước 2)`);
    }
    if (c.ma === MA_THANH_TOAN) {
      const ngayChuan = n["ngayChuan"] ?? "";
      const tyLeGoi = goi.thamSo?.["chi_phi_von_nam"];
      const ngayChuanGoi = goi.thamSo?.["ngay_thanh_toan_chuan"];
      if (tyLe !== tyLeGoi) noi.push(`${ten}: nguon.tyLe ${tyLe} khác goiTco.thamSo.chi_phi_von_nam ${String(tyLeGoi)} (§9.3 bước 3)`);
      if (ngayChuan !== ngayChuanGoi) {
        noi.push(`${ten}: nguon.ngayChuan ${ngayChuan} khác goiTco.thamSo.ngay_thanh_toan_chuan ${String(ngayChuanGoi)} (§9.3 bước 3)`);
      }
      noi.push(
        ...haiLop(
          `giaTri của ${ten}`,
          c.giaTri,
          chiPhiThanhToanLai(coSo, ngayKhai, ngayChuan, tyLe),
          hamThuan.thanhToan(coSo, ngayKhai, ngayChuan, tyLe),
        ),
      );
    } else {
      const ngayYeuCau = n["ngayYeuCau"] ?? "";
      const tyLeGoi = goi.thamSo?.["ty_le_tre_ngay"];
      const yeuCauGoi = goi.soNgayGiao === null ? null : String(goi.soNgayGiao);
      if (tyLe !== tyLeGoi) noi.push(`${ten}: nguon.tyLe ${tyLe} khác goiTco.thamSo.ty_le_tre_ngay ${String(tyLeGoi)} (§9.3 bước 3)`);
      if (ngayYeuCau !== yeuCauGoi) {
        noi.push(`${ten}: nguon.ngayYeuCau ${ngayYeuCau} khác goiTco.soNgayGiao ${String(yeuCauGoi)} (§9.3 bước 3)`);
      }
      noi.push(
        ...haiLop(
          `giaTri của ${ten}`,
          c.giaTri,
          chiPhiTreLai(coSo, ngayKhai, ngayYeuCau, tyLe),
          hamThuan.tre(coSo, ngayKhai, ngayYeuCau, tyLe),
        ),
      );
    }
  }
  return noi;
}

/** Số thành phần quy đổi của một hàng — để tổng kết đếm được phép đo đã chạy trên bao nhiêu con số. */
export function soQuyDoi(hang: HangBundle): number {
  return hang.components.filter((c) => c.ma === MA_THANH_TOAN || c.ma === MA_TRE).length;
}

/** §9.3 đoạn cuối: tập mã của mọi lượt chấm bằng tập mã chụp lúc mở. Rỗng khi ĐẠT hay khi gói không chụp tập mã. */
export function kiemTapMa(goi: GoiTcoDoc, luot: LuotChamBundle): readonly string[] {
  if (goi.tapMa === null) return [];
  const ma = luot.chinhSachThanhPhan.map((c) => c.ma);
  if (ma.length === goi.tapMa.length && ma.every((m, i) => m === goi.tapMa?.[i])) return [];
  return [`lượt chấm ${luot.evaluationId}: tập mã [${ma.join(", ")}] khác goiTco.tapMa [${goi.tapMa.join(", ")}] (§9.3)`];
}

// ---- §10 cam kết --------------------------------------------------------------------------------

function bangThanhPhan(a: ThanhPhanLuu, b: ThanhPhanLuu): boolean {
  const khoa = ["ma", "donVi", "heSo", "giaTri", "tien"] as const;
  if (khoa.some((k) => a[k] !== b[k])) return false;
  return bangChuoiTheoKhoa(a.nguon ?? null, b.nguon ?? null);
}

function bangChuoiTheoKhoa(a: Readonly<Record<string, string>> | null, b: Readonly<Record<string, string>> | null): boolean {
  if (a === null || b === null) return a === b;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

function bangMang(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export interface KetQuaKiemCamKet {
  /** Số cam kết đã kiểm. */
  readonly soCamKet: number;
  readonly soDat: number;
  /** Đề xuất `PROPOSED` không mang cam kết — đề xuất có trước khi hệ thống chụp cam kết. BÁO, không đỏ (§10). */
  readonly soDeXuatKhongCamKet: number;
  /** Mỗi dòng gọi tên ĐÚNG cam kết và chỗ lệch. Rỗng khi ĐẠT. */
  readonly loi: readonly string[];
}

function tienGiaDau(h: HangBundle): string | null {
  const g = thanhPhanGia(h);
  return g === undefined ? null : g.tien;
}

/** Hạng giá theo lớp ⑴ — cùng bộ lọc §10 bước 4, phép xếp của lượt chấm. */
function hangGiaThuan(luot: LuotChamBundle, bidVersionId: string, hamThuan: QuyDoiHamThuan): number | null {
  const coHang = luot.hang.filter((h) => h.rank !== null);
  const gia = coHang.map((h) => {
    const t = tienGiaDau(h);
    return t !== null && KHUON_TIEN.test(t) ? t : null;
  });
  const xep = hamThuan.xepHang(gia);
  const i = coHang.findIndex((h) => h.bidVersionId === bidVersionId);
  return i < 0 ? null : (xep[i] ?? null);
}

function kiemMotCamKet(
  bo: BoBangChung,
  awardId: string,
  luot: LuotChamBundle,
  h: HangBundle,
  k: CamKetDoc,
  hamThuan: QuyDoiHamThuan,
): readonly string[] {
  const noi: string[] = [];
  const ten = `cam kết của trao thầu ${awardId}`;
  if (k.hangTco !== h.rank) noi.push(`${ten}: hangTco ${String(k.hangTco)} khác hạng của hàng ${String(h.rank)} (§10 bước 1)`);
  if (k.effectiveCost !== h.effectiveCost) {
    noi.push(`${ten}: effectiveCost ${k.effectiveCost} khác của hàng ${String(h.effectiveCost)} (§10 bước 1)`);
  }
  if (k.components.length !== h.components.length || k.components.some((c, i) => !bangThanhPhan(c, h.components[i] as ThanhPhanLuu))) {
    noi.push(`${ten}: components khác components của hàng (§10 bước 1)`);
  }
  if (!bangMang(k.tapMa, bo.goiTco.tapMa)) noi.push(`${ten}: tapMa khác goiTco.tapMa (§10 bước 2)`);
  if (!bangChuoiTheoKhoa(k.thamSo, bo.goiTco.thamSo)) noi.push(`${ten}: thamSo khác goiTco.thamSo (§10 bước 2)`);
  if (k.soNgayGiao !== bo.goiTco.soNgayGiao) {
    noi.push(`${ten}: soNgayGiao ${String(k.soNgayGiao)} khác goiTco.soNgayGiao ${String(bo.goiTco.soNgayGiao)} (§10 bước 2)`);
  }
  // §10 bước 3 — lời khai khớp hàng.
  for (const c of h.components) {
    if (c.ma === MA_THANH_TOAN && c.nguon?.["ngayKhai"] !== (k.khai.paymentDays === null ? undefined : String(k.khai.paymentDays))) {
      noi.push(`${ten}: khai.paymentDays ${String(k.khai.paymentDays)} khác nguon.ngayKhai của "${MA_THANH_TOAN}" (§10 bước 3)`);
    }
    if (c.ma === MA_TRE && c.nguon?.["ngayKhai"] !== (k.khai.leadTimeDays === null ? undefined : String(k.khai.leadTimeDays))) {
      noi.push(`${ten}: khai.leadTimeDays ${String(k.khai.leadTimeDays)} khác nguon.ngayKhai của "${MA_TRE}" (§10 bước 3)`);
    }
    if (c.ma === "van_chuyen" && c.giaTri !== (k.khai.freight ?? undefined)) {
      noi.push(`${ten}: khai.freight ${String(k.khai.freight)} khác giaTri của "van_chuyen" (§10 bước 3)`);
    }
    if (c.ma === "nhap_khau" && c.giaTri !== (k.khai.importCost ?? undefined)) {
      noi.push(`${ten}: khai.importCost ${String(k.khai.importCost)} khác giaTri của "nhap_khau" (§10 bước 3)`);
    }
  }
  // §10 bước 4 — hạng giá, hai lớp.
  const docLap = hangGiaLai(
    luot.hang.map((x) => ({ bidVersionId: x.bidVersionId, rank: x.rank, tienGia: tienGiaDau(x) })),
    h.bidVersionId,
  );
  const thuan = hangGiaThuan(luot, h.bidVersionId, hamThuan);
  const viet = (x: number | null): string => (x === null ? "null" : String(x));
  noi.push(
    ...haiLop(`hangGia của ${ten}`, viet(k.hangGia), viet(docLap), viet(thuan)).map((d) => `${d} (§10 bước 4)`),
  );
  // §10 bước 5 — có giải trình ⇔ lệch hạng.
  const lech = k.hangGia !== k.hangTco;
  if (lech && k.giaiTrinhLechHang === null) {
    noi.push(`${ten}: hạng giá ${viet(k.hangGia)} khác hạng chi phí ${String(k.hangTco)} mà KHÔNG có giải trình (§10 bước 5)`);
  }
  if (!lech && k.giaiTrinhLechHang !== null) {
    noi.push(`${ten}: hạng giá bằng hạng chi phí (${String(k.hangTco)}) mà có giải trình (§10 bước 5)`);
  }
  return noi;
}

/** `DAC-TA.md` §10 trên mọi hàng trao thầu của bundle. */
export function kiemCamKet(bo: BoBangChung, hamThuan: QuyDoiHamThuan = QUY_DOI_THAT): KetQuaKiemCamKet {
  const loi: string[] = [];
  let soCamKet = 0;
  let soDat = 0;
  let soDeXuatKhongCamKet = 0;
  for (const t of bo.traoThau) {
    if (t.camKet === null) {
      if (t.status === "PROPOSED") soDeXuatKhongCamKet += 1;
      continue;
    }
    soCamKet += 1;
    if (t.status !== "PROPOSED") {
      loi.push(`trao thầu ${t.awardId} ở trạng thái ${t.status} mà mang cam kết — chỉ đề xuất mang cam kết (§10)`);
      continue;
    }
    const luot = bo.luotCham.find((l) => l.evaluationId === t.evaluationId);
    const h = luot?.hang.find((x) => x.bidVersionId === t.bidVersionId);
    if (luot === undefined || h === undefined) {
      loi.push(`cam kết của trao thầu ${t.awardId} trỏ một hàng KHÔNG có trong bundle (§10)`);
      continue;
    }
    const noi = kiemMotCamKet(bo, t.awardId, luot, h, t.camKet, hamThuan);
    if (noi.length === 0) soDat += 1;
    loi.push(...noi);
  }
  return { soCamKet, soDat, soDeXuatKhongCamKet, loi };
}
