// ==============================================================================================
// [S1.262 / S4.5c2 / ADR-059 ⒝] TÍNH LẠI NHÃN BENCHMARK — VIẾT TỪ `DAC-TA.md` §8, KHÔNG IMPORT `@trustprocure/du-lieu-nen`
// HAY `@trustprocure/danh-gia`
//
// Cùng vai `tinh-lai.ts` cho lớp chấm thầu: một người kiểm ĐỘC LẬP, giữ bằng `g17-` (cả thư mục `doc-lap/`, `reachable: true`).
//
// PHƯƠNG PHÁP KHÁC, KHÔNG CHỈ BẢN SAO KHÁC (khuôn `tinh-lai.ts`):
//   • lõi (`packages/du-lieu-nen/src/benchmark.ts`) giữ mốc là `bigint` micro giây và lùi tháng bằng `Date.UTC`; ở đây mốc là CHUỖI
//     ISO sáu chữ số lẻ (`DAC-TA.md` §8.2), lùi tháng trên các TRƯỜNG chữ của chuỗi với bảng ngày-trong-tháng tự viết, và so thứ tự
//     bằng so chuỗi;
//   • lõi quy số về `bigint` theo tỉ lệ rồi chia lũy thừa của 2 cho phân vị; ở đây số là MẢNG CHỮ SỐ (`tinh-lai.ts`), phần lẻ của vị
//     trí phân vị là một số thập phân (`0.25`, `0.5`, `0.75`) nhân dài vào hiệu.
// Một lỗi CỦA PHƯƠNG PHÁP lõi (kẹp ngày sai, nội suy lệch một bậc) vì thế không tự tái lập ở đây.
//
// Giới hạn, nói ra: lớp này bắt được chỗ MÃ lệch khỏi ĐẶC TẢ, không bắt được một đặc tả sai; và nó tính lại TỪ ĐƠN GIÁ ĐÃ QUY ĐỔI —
// phép quy đổi đơn vị không tính lại (chủ dự án chốt 2026-10-02; `DAC-TA.md` §8.8).
// ==============================================================================================

import { cong, docThapPhan, nhan, soSanh, type SoThapPhan } from "./tinh-lai.js";

// ---------------------------------------------------------------------------------------------
// LỊCH — `DAC-TA.md` §8.2, §8.3
// ---------------------------------------------------------------------------------------------

const KHUON_MOC = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}:\d{2}\.\d{6}Z)$/u;

function laNamNhuan(nam: number): boolean {
  return nam % 4 === 0 && (nam % 100 !== 0 || nam % 400 === 0);
}

const NGAY_TRONG_THANG = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function ngayCuoi(nam: number, thang: number): number {
  return thang === 2 && laNamNhuan(nam) ? 29 : (NGAY_TRONG_THANG[thang - 1] ?? 31);
}

/** §8.3: lùi `soThang` tháng lịch UTC, kẹp ngày về ngày cuối của tháng đích, giữ giờ–phút–giây–micro giây. */
export function luiThang(moc: string, soThang: number): string {
  const k = KHUON_MOC.exec(moc);
  if (k === null) throw new RangeError(`mốc sai dạng §8.2: ${moc}`);
  const nam = Number(k[1]);
  const thang = Number(k[2]);
  const ngay = Number(k[3]);
  // Đếm tháng từ tháng 1 năm 0: (nam, thang) ↔ nam·12 + (thang − 1).
  const tong = nam * 12 + (thang - 1) - soThang;
  const namDich = Math.floor(tong / 12);
  const thangDich = tong - namDich * 12 + 1;
  const ngayDich = Math.min(ngay, ngayCuoi(namDich, thangDich));
  const hai = (n: number): string => String(n).padStart(2, "0");
  return `${String(namDich).padStart(4, "0")}-${hai(thangDich)}-${hai(ngayDich)}${k[4] ?? ""}`;
}

// ---------------------------------------------------------------------------------------------
// SỐ — chỉ những phép §8 cần, dựng trên `tinh-lai.ts`
// ---------------------------------------------------------------------------------------------

function thapPhan(chuoi: string): SoThapPhan {
  const x = docThapPhan(chuoi);
  if (x === null) throw new RangeError(`không phải số thập phân: ${chuoi}`);
  return x;
}

/** Nới về `soLe` chữ số lẻ bằng cách thêm số 0 ở ĐUÔI — giá trị không đổi. */
function noi(x: SoThapPhan, soLe: number): SoThapPhan {
  if (soLe < x.soLe) throw new RangeError("noi chỉ nới");
  return { am: x.am, chuSo: [...x.chuSo, ...new Array<number>(soLe - x.soLe).fill(0)], soLe };
}

function canLe(a: SoThapPhan, b: SoThapPhan): readonly [SoThapPhan, SoThapPhan] {
  const n = Math.max(a.soLe, b.soLe);
  return [noi(a, n), noi(b, n)];
}

function soSanhTuDo(a: SoThapPhan, b: SoThapPhan): number {
  const [x, y] = canLe(a, b);
  return soSanh(x, y);
}

function tru(a: SoThapPhan, b: SoThapPhan): SoThapPhan {
  const [x, y] = canLe(a, b);
  return cong(x, { ...y, am: !y.am });
}

function laKhong(x: SoThapPhan): boolean {
  return x.chuSo.every((c) => c === 0);
}

const PHAN_LE_VI_TRI = ["0", "0.25", "0.5", "0.75"] as const;

/** §8.5 bước 6: phân vị `k`/4 nội suy tuyến tính trên dãy ĐÃ SẮP TĂNG. */
function phanVi(daySapTang: readonly SoThapPhan[], k: 1 | 2 | 3): SoThapPhan {
  const n = daySapTang.length;
  if (n === 0) throw new RangeError("phân vị của dãy rỗng");
  const tuSo = (n - 1) * k; // h = tuSo / 4
  const duoi = Math.floor(tuSo / 4);
  const du = tuSo - duoi * 4;
  const a = daySapTang[duoi]!;
  if (du === 0) return a;
  const b = daySapTang[duoi + 1]!;
  const [x, y] = canLe(a, nhan(thapPhan(PHAN_LE_VI_TRI[du]!), tru(b, a)));
  return cong(x, y);
}

function sapTang(day: readonly SoThapPhan[]): SoThapPhan[] {
  return [...day].sort(soSanhTuDo);
}

// ---------------------------------------------------------------------------------------------
// MỘT DÒNG — `DAC-TA.md` §8.5
// ---------------------------------------------------------------------------------------------

/** Một quan sát như §8.4 mô tả — chỉ những trường phép tính đọc. */
export interface QuanSatTinh {
  readonly ma: string;
  readonly goi: string;
  readonly ncc: string;
  /** Ngày UTC (`YYYY-MM-DD`) hay mốc đủ micro giây trên một ngày biên — §8.2. */
  readonly ngay: string;
  readonly gia: string;
  readonly tienTe: string;
  readonly cungNguoiTao: boolean;
  readonly hoiTo: readonly string[];
}

export interface NhomTinh {
  readonly cua_so_thang: string;
  readonly san_goi: string;
  readonly san_ncc: string;
  readonly nguong_lech_vua: string;
  readonly nguong_lech_cao: string;
}

export interface GiaDongTinh {
  readonly trangThai: string;
  readonly gia: string | null;
  readonly tienTe: string | null;
}

/** Kết quả tính lại của một dòng — cùng các trường mà hàng kết quả đã lưu mang. */
export interface DongTinhLai {
  readonly nhan: string;
  readonly chieu: string | null;
  readonly lyDo: string | null;
  readonly tienTe: string | null;
  readonly cuaSoTu: string | null;
  readonly soQuanSat: number | null;
  readonly soGoi: number | null;
  readonly soNcc: number | null;
  readonly soGoiCungNguoiTao: number | null;
  readonly soQuanSatHoiTo: number | null;
  readonly soLoaiTienTe: number | null;
  readonly soLoaiGia0: number | null;
  /** Mã các quan sát vào dải — `null` khi dòng không đo được. */
  readonly dauVao: readonly string[] | null;
}

const KHONG_SO = {
  tienTe: null,
  cuaSoTu: null,
  soQuanSat: null,
  soGoi: null,
  soNcc: null,
  soGoiCungNguoiTao: null,
  soQuanSatHoiTo: null,
  soLoaiTienTe: null,
  soLoaiGia0: null,
  dauVao: null,
} as const;

/**
 * §8.5. `quanSat` là bảng của (`mocMoGia`, hàng chuẩn của dòng); `giaDong = null` ⇔ dòng không có ánh xạ hiệu lực.
 * Ném `RangeError` khi một số liệu sai dạng — người gọi đổi nó thành một lời báo có địa chỉ.
 */
export function tinhLaiDong(
  giaDong: GiaDongTinh | null,
  quanSat: readonly QuanSatTinh[],
  vao: { readonly goiX: string; readonly mocMoGia: string; readonly nhom: NhomTinh },
): DongTinhLai {
  if (giaDong === null) return { nhan: "KHONG_DO_DUOC", chieu: null, lyDo: "CHUA_ANH_XA", ...KHONG_SO };
  if (giaDong.trangThai !== "HOP_LE" || giaDong.gia === null || giaDong.tienTe === null) {
    return { nhan: "KHONG_DO_DUOC", chieu: null, lyDo: giaDong.trangThai, ...KHONG_SO };
  }
  const tienTe = giaDong.tienTe;
  const cuaSoTu = luiThang(vao.mocMoGia, Number(vao.nhom.cua_so_thang));

  const dai: QuanSatTinh[] = [];
  let soLoaiTienTe = 0;
  let soLoaiGia0 = 0;
  // §8.2: `ngay` là NGÀY (10 ký tự) hay mốc đủ micro giây. Ngày trơn phán xử được cửa sổ bằng phép so chuỗi CHỈ KHI nó không phải
  // một ngày biên — một ngày trơn trên ngày biên là bundle sai (§8.2), không phải một quan sát để xếp vào hay ra.
  const ngayBien = new Set([vao.mocMoGia.slice(0, 10), cuaSoTu.slice(0, 10)]);
  for (const q of quanSat) {
    if (q.ngay.length === 10 && ngayBien.has(q.ngay)) {
      throw new RangeError(`quan sát ${q.ma} mang ngày trơn ${q.ngay} trên một ngày biên — §8.2 đòi đủ micro giây ở ngày ấy`);
    }
    if (q.goi === vao.goiX) continue;
    if (q.ngay >= vao.mocMoGia || q.ngay < cuaSoTu) continue;
    if (q.tienTe !== tienTe) {
      soLoaiTienTe += 1;
      continue;
    }
    if (laKhong(thapPhan(q.gia))) {
      soLoaiGia0 += 1;
      continue;
    }
    dai.push(q);
  }

  const goi = new Map<string, SoThapPhan[]>();
  for (const q of dai) {
    const ds = goi.get(q.goi);
    if (ds === undefined) goi.set(q.goi, [thapPhan(q.gia)]);
    else ds.push(thapPhan(q.gia));
  }
  const soGoi = goi.size;
  const soNcc = new Set(dai.map((q) => q.ncc)).size;
  const dem = {
    tienTe,
    cuaSoTu,
    soQuanSat: dai.length,
    soGoi,
    soNcc,
    soGoiCungNguoiTao: new Set(dai.filter((q) => q.cungNguoiTao).map((q) => q.goi)).size,
    soQuanSatHoiTo: dai.filter((q) => q.hoiTo.length > 0).length,
    soLoaiTienTe,
    soLoaiGia0,
    dauVao: dai.map((q) => q.ma),
  };
  if (soGoi < Number(vao.nhom.san_goi) || soNcc < Number(vao.nhom.san_ncc)) {
    return { nhan: "CHUA_DU_LICH_SU", chieu: null, lyDo: null, ...dem };
  }

  const trungViGoi = sapTang([...goi.values()].map((ds) => phanVi(sapTang(ds), 2)));
  const m = phanVi(trungViGoi, 2);
  const p = thapPhan(giaDong.gia);
  const hieu = tru(p, m);
  const d: SoThapPhan = { ...hieu, am: false };
  if (soSanhTuDo(d, nhan(thapPhan(vao.nhom.nguong_lech_vua), m)) <= 0) {
    return { nhan: "BINH_THUONG", chieu: null, lyDo: null, ...dem };
  }
  const chieu = soSanhTuDo(p, m) > 0 ? "TREN" : "DUOI";
  if (soSanhTuDo(d, nhan(thapPhan(vao.nhom.nguong_lech_cao), m)) <= 0) return { nhan: "LECH_VUA", chieu, lyDo: null, ...dem };
  return { nhan: "LECH_CAO", chieu, lyDo: null, ...dem };
}
