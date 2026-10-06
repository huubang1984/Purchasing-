// ==============================================================================================
// [S1.9101 / S4.6a] ĐỌC VĂN BẢN DÁN VÀO Ô — mốc giá ngoài và lịch sử mua ngoài hệ thống (spec S4 §4.7; ADR-096 ⑸; ADR-9201)
//
// Thuần: không CSDL, không đồng hồ. Ra một danh sách dòng ĐÃ ĐỌC (chuỗi, chưa phân giải hàng chuẩn hay đơn vị — việc của
// `du-lieu-ngoai.ts`, ở SQL) hoặc một danh sách lỗi theo SỐ DÒNG. Không lỗi nào lặp lại GIÁ TRỊ của ô: câu trả về màn của người
// quản lý dữ liệu (mù giá, ADR-096 ⑵) chỉ nói dòng nào, cột nào, sai thế nào.
//
// HÌNH DẠNG (tự chốt trong phạm vi ADR-9201, nói ở biên bản):
//   • dòng đầu là tiêu đề; tên cột so sau khi bỏ dấu, hạ chữ, mọi ký tự ngoài [a-z0-9] thành `_` — *"Mã hàng"* là `ma_hang`;
//     thứ tự cột tự do, cột lạ thì từ chối (một cột *"VAT"* bị lờ đi là một con số người dán tưởng đã vào);
//   • phân cách là TAB nếu dòng tiêu đề có tab (dán thẳng từ bảng tính), không thì `;` nếu có, không thì `,`; ô có thể đặt trong
//     ngoặc kép, `""` là một dấu ngoặc kép (RFC 4180) — tên nhà cung cấp mang dấu phẩy;
//   • đơn giá là số thập phân DƯƠNG với dấu CHẤM thập phân, không dấu phân cách nghìn: *"1.234,5"* và *"1,234.5"* đều từ chối —
//     đoán sai một trong hai là một giá lệch nghìn lần mà không ai thấy (người nhập không đọc lại được giá);
//   • ngày `YYYY-MM-DD` hoặc `DD/MM/YYYY` (cách bảng tính tiếng Việt hiện ngày), phải là một ngày có thật;
//   • lô tất-cả-hoặc-không: một dòng sai là cả lô bị từ chối, kèm MỌI lỗi.
// ==============================================================================================

export type LoaiDuLieuNgoai = "MOC_NGOAI" | "LICH_SU_NGOAI";

/** Trần số dòng của một lô — thân yêu cầu đã chặn ở 64 KB (`TRAN_THAN_BYTE`); trần này nói tên lý do trước khi thân chạm trần. */
export const TRAN_DONG_MOT_LO = 1000;

/** Một dòng đã đọc. `ngay` là ngày hiệu lực của mốc ngoài hay ngày mua của lịch sử ngoài, dạng `YYYY-MM-DD`. */
export interface DongNgoaiDaDoc {
  /** Số dòng VẬT LÝ trong văn bản dán (dòng tiêu đề là 1). */
  readonly dong: number;
  readonly maHang: string;
  readonly donGia: string;
  readonly donVi: string;
  readonly tienTe: "VND" | "USD";
  readonly ngay: string;
  readonly nguon: string;
  /** Chỉ lịch sử ngoài. */
  readonly nhaCungCap: string | null;
}

export type MaLoiDong =
  | "LO_RONG"
  | "QUA_NHIEU_DONG"
  | "THIEU_COT"
  | "KHONG_CO_TIEU_DE"
  | "COT_LA"
  | "COT_TRUNG"
  | "SO_O_SAI"
  | "NGOAC_KEP_HO"
  | "MA_HANG_SAI_HINH_DANG"
  | "DON_GIA_SAI_HINH_DANG"
  | "DON_GIA_MO_HO"
  | "DON_VI_RONG"
  | "TIEN_TE_SAI"
  | "NGAY_SAI_HINH_DANG"
  | "NGAY_MUA_SAU_HOM_NAY"
  | "NGUON_SAI_HINH_DANG"
  | "NHA_CUNG_CAP_SAI_HINH_DANG"
  // Ba mã dưới do `du-lieu-ngoai.ts` gắn sau khi hỏi CSDL — cùng hình dạng lỗi để màn in một danh sách.
  | "KHONG_CO_HANG_CHUAN"
  | "DON_VI_KHONG_QUY_DOI_DUOC";

/** Một lỗi: dòng (1 = tiêu đề), cột (tên đã chuẩn hoá) hay `null`, mã, câu cho người đọc — không mang giá trị của ô. */
export interface LoiDongNgoai {
  readonly dong: number;
  readonly cot: string | null;
  readonly ma: MaLoiDong;
  readonly cau: string;
}

export type KetQuaDocCsv =
  | { readonly hopLe: true; readonly dong: readonly DongNgoaiDaDoc[] }
  | { readonly hopLe: false; readonly loi: readonly LoiDongNgoai[] };

const COT_CHUNG = ["ma_hang", "don_gia", "don_vi", "tien_te", "nguon"] as const;
const COT_THEO_LOAI: Readonly<Record<LoaiDuLieuNgoai, readonly string[]>> = {
  MOC_NGOAI: [...COT_CHUNG, "ngay_hieu_luc"],
  LICH_SU_NGOAI: [...COT_CHUNG, "ngay_mua", "nha_cung_cap"],
};
/** Một tên cột lạ được nhắc lại trong lỗi chỉ khi khớp dạng này — một con số, một ngày, một mã có chữ số không bao giờ khớp. */
const TEN_COT_NHAC_LAI = /^[a-z][a-z_]{0,39}$/u;
/** Tên khác của cùng cột — sau chuẩn hoá. */
const TEN_KHAC: Readonly<Record<string, string>> = { ma_hang_chuan: "ma_hang", don_vi_tinh: "don_vi", ncc: "nha_cung_cap" };

const MA_HANG = /^[A-Z0-9][A-Z0-9._-]{0,39}$/u;
const DON_GIA = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/u;
const NGAY_ISO = /^(\d{4})-(\d{2})-(\d{2})$/u;
const NGAY_VN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u;

/** Tên cột: bỏ dấu, `đ`→`d`, hạ chữ, ngoài [a-z0-9] thành `_`, gộp và cắt `_`. */
export function chuanHoaTenCot(ten: string): string {
  return ten
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[đĐ]/gu, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

/** Tách một dòng theo phân cách, ngoặc kép kiểu RFC 4180. `null` khi ngoặc kép mở mà không đóng, hay có chữ ngay sau ngoặc đóng. */
function tachDong(dong: string, phanCach: string): string[] | null {
  const o: string[] = [];
  let i = 0;
  for (;;) {
    if (dong[i] === '"') {
      let gt = "";
      i += 1;
      for (;;) {
        if (i >= dong.length) return null;
        if (dong[i] === '"') {
          if (dong[i + 1] === '"') {
            gt += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        gt += dong[i];
        i += 1;
      }
      // Sau ngoặc đóng chỉ được là phân cách hay hết dòng (RFC 4180). ~~Phần thừa nối vào ô~~ [rà soát §S1.9101 THẤP-5] `"1"5` ở cột
      // đơn giá thành `15` và được nhận — một ô sai hình dạng là một lỗi, không phải một ô ghép.
      o.push(gt);
      if (i >= dong.length) return o;
      if (!dong.startsWith(phanCach, i)) return null;
      i += phanCach.length;
    } else {
      const ket = dong.indexOf(phanCach, i);
      if (ket === -1) {
        o.push(dong.slice(i));
        return o;
      }
      o.push(dong.slice(i, ket));
      i = ket + phanCach.length;
    }
  }
}

/** `YYYY-MM-DD` hoặc `DD/MM/YYYY` → `YYYY-MM-DD` của một ngày có thật; không thì `null`. */
export function docNgay(chuoi: string): string | null {
  let nam: number;
  let thang: number;
  let ngay: number;
  const iso = NGAY_ISO.exec(chuoi);
  const vn = NGAY_VN.exec(chuoi);
  if (iso !== null) {
    nam = Number(iso[1]);
    thang = Number(iso[2]);
    ngay = Number(iso[3]);
  } else if (vn !== null) {
    nam = Number(vn[3]);
    thang = Number(vn[2]);
    ngay = Number(vn[1]);
  } else {
    return null;
  }
  if (nam < 1900 || thang < 1 || thang > 12 || ngay < 1) return null;
  const nhuan = (nam % 4 === 0 && nam % 100 !== 0) || nam % 400 === 0;
  const cuoi = [31, nhuan ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][thang - 1]!;
  if (ngay > cuoi) return null;
  return `${String(nam).padStart(4, "0")}-${String(thang).padStart(2, "0")}-${String(ngay).padStart(2, "0")}`;
}

/** Đơn giá: số thập phân dương, dấu chấm, không phân cách nghìn. */
export function laDonGia(chuoi: string): boolean {
  return DON_GIA.test(chuoi) && !/^0(?:\.0+)?$/u.test(chuoi);
}

/**
 * [S1.9101 / chủ dự án chốt sau rà soát 2026-10-06] `15.500` — một đến ba chữ số, MỘT dấu chấm, ĐÚNG ba chữ số sau — là cách bảng tính
 * tiếng Việt hiện số 15500. Đọc theo luật dấu chấm thập phân nó thành 15,5, lệch nghìn lần, và người nhập mù giá không thấy lại con số.
 * Dạng ấy bị từ chối ở cả hai tiền tệ; `15.5`, `15.50`, `15.5000`, `0.500` vẫn nhận (rà soát §S1.9101 CAO-1).
 */
export function laDonGiaMoHo(chuoi: string): boolean {
  return /^[1-9]\d{0,2}\.\d{3}$/u.test(chuoi);
}

/** Ngày hôm nay theo giờ Việt Nam (UTC+7, không giờ mùa hè) — trần của ngày mua; cùng phép tính với trigger `du_lieu_ngoai_kiem_ghi`. */
export function ngayHomNayVn(luc: Date = new Date()): string {
  return new Date(luc.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

const CAU: Readonly<Record<MaLoiDong, string>> = {
  LO_RONG: "văn bản dán không có dòng dữ liệu nào",
  QUA_NHIEU_DONG: `một lô tối đa ${String(TRAN_DONG_MOT_LO)} dòng — chia thành nhiều lần dán`,
  THIEU_COT: "dòng tiêu đề thiếu cột này",
  KHONG_CO_TIEU_DE: "dòng đầu phải là dòng tiêu đề theo mẫu — không ô nào của nó là tên một cột của mẫu",
  COT_LA: "cột không thuộc mẫu — bỏ cột này khỏi văn bản dán",
  COT_TRUNG: "cột xuất hiện hai lần ở dòng tiêu đề",
  SO_O_SAI: "số ô của dòng khác số cột của dòng tiêu đề",
  NGOAC_KEP_HO: "ô mở ngoặc kép mà không đóng, hoặc có chữ ngay sau ngoặc kép đóng",
  MA_HANG_SAI_HINH_DANG: "mã hàng chuẩn viết hoa, bắt đầu bằng chữ hoặc số, chỉ chữ, số, chấm, gạch — tối đa 40 ký tự",
  DON_GIA_SAI_HINH_DANG: "đơn giá là số thập phân dương, dấu CHẤM thập phân, không dấu phân cách nghìn (ví dụ 15500 hay 12.75)",
  DON_GIA_MO_HO:
    "đơn giá mơ hồ: một dấu chấm và đúng ba chữ số sau nó đọc được thành hai số chênh nhau nghìn lần — viết 15500 nếu là mười lăm " +
    "nghìn năm trăm, 15.5 nếu là mười lăm phẩy năm",
  DON_VI_RONG: "đơn vị trống",
  TIEN_TE_SAI: "tiền tệ là VND hoặc USD",
  NGAY_SAI_HINH_DANG: "ngày dạng YYYY-MM-DD hoặc DD/MM/YYYY, và là một ngày có thật",
  NGAY_MUA_SAU_HOM_NAY: "ngày mua sau ngày hôm nay (giờ Việt Nam) — lịch sử mua là việc đã xảy ra",
  NGUON_SAI_HINH_DANG: "nguồn dài 1 đến 500 ký tự",
  NHA_CUNG_CAP_SAI_HINH_DANG: "tên nhà cung cấp dài 1 đến 300 ký tự",
  KHONG_CO_HANG_CHUAN: "không có hàng chuẩn mang mã này trong tổ chức",
  DON_VI_KHONG_QUY_DOI_DUOC: "đơn vị không quy đổi được sang đơn vị gốc của hàng chuẩn — khai quy đổi riêng trước, hoặc dùng đơn vị khác",
};

/** Câu cho người đọc của một mã lỗi dòng. */
export function cauLoiDong(ma: MaLoiDong): string {
  return CAU[ma];
}

const loi = (dong: number, cot: string | null, ma: MaLoiDong): LoiDongNgoai => ({ dong, cot, ma, cau: CAU[ma] });

/**
 * Đọc văn bản dán của một lô. Dòng trống (sau khi cắt) bỏ qua; số dòng trong lỗi là số dòng VẬT LÝ, đúng thứ người dán nhìn thấy
 * trong bảng tính của mình.
 */
export function docCsvNgoai(loai: LoaiDuLieuNgoai, vanBan: string, homNay: string = ngayHomNayVn()): KetQuaDocCsv {
  const dongVatLy = vanBan.replace(/^﻿/u, "").split(/\r\n|\n|\r/u);
  const coNoiDung = dongVatLy.map((d, i) => ({ so: i + 1, d })).filter((x) => x.d.trim() !== "");
  const tieuDe = coNoiDung[0];
  if (tieuDe === undefined || coNoiDung.length < 2) return { hopLe: false, loi: [loi(1, null, "LO_RONG")] };
  if (coNoiDung.length - 1 > TRAN_DONG_MOT_LO) return { hopLe: false, loi: [loi(1, null, "QUA_NHIEU_DONG")] };

  const phanCach = tieuDe.d.includes("\t") ? "\t" : tieuDe.d.includes(";") ? ";" : ",";
  const o = tachDong(tieuDe.d, phanCach);
  if (o === null) return { hopLe: false, loi: [loi(tieuDe.so, null, "NGOAC_KEP_HO")] };
  const cot = o.map((t) => {
    const c = chuanHoaTenCot(t);
    return TEN_KHAC[c] ?? c;
  });
  const can = COT_THEO_LOAI[loai];
  // [rà soát §S1.9101 TRUNG-2] Dán thiếu dòng tiêu đề: dòng đầu là DỮ LIỆU, và bản trước nhắc lại từng ô của nó ở cột `cot` của lỗi
  // `COT_LA` — đơn giá, ngày, tên nhà cung cấp quay về màn của người mù giá. Không ô nào là tên cột ⇒ một lỗi, không nhắc ô nào.
  if (!cot.some((c) => can.includes(c))) return { hopLe: false, loi: [loi(tieuDe.so, null, "KHONG_CO_TIEU_DE")] };
  const loiTieuDe: LoiDongNgoai[] = [];
  const daThay = new Set<string>();
  for (const [i, c] of cot.entries()) {
    // Tên cột lạ chỉ được nhắc lại khi nó trông như một tên cột — chữ thường không dấu và gạch dưới, KHÔNG chữ số; không thì nêu vị trí.
    if (!can.includes(c)) loiTieuDe.push(loi(tieuDe.so, TEN_COT_NHAC_LAI.test(c) ? c : `#${String(i + 1)}`, "COT_LA"));
    else if (daThay.has(c)) loiTieuDe.push(loi(tieuDe.so, c, "COT_TRUNG"));
    daThay.add(c);
  }
  for (const c of can) if (!daThay.has(c)) loiTieuDe.push(loi(tieuDe.so, c, "THIEU_COT"));
  if (loiTieuDe.length > 0) return { hopLe: false, loi: loiTieuDe };

  const viTri = (ten: string): number => cot.indexOf(ten);
  const loiDong: LoiDongNgoai[] = [];
  const dong: DongNgoaiDaDoc[] = [];
  for (const { so, d } of coNoiDung.slice(1)) {
    const oDong = tachDong(d, phanCach);
    if (oDong === null) {
      loiDong.push(loi(so, null, "NGOAC_KEP_HO"));
      continue;
    }
    if (oDong.length !== cot.length) {
      loiDong.push(loi(so, null, "SO_O_SAI"));
      continue;
    }
    const gt = (ten: string): string => oDong[viTri(ten)]!.trim();
    const truocDo = loiDong.length;
    const maHang = gt("ma_hang").toUpperCase();
    if (!MA_HANG.test(maHang)) loiDong.push(loi(so, "ma_hang", "MA_HANG_SAI_HINH_DANG"));
    const donGia = gt("don_gia");
    if (!laDonGia(donGia)) loiDong.push(loi(so, "don_gia", "DON_GIA_SAI_HINH_DANG"));
    else if (laDonGiaMoHo(donGia)) loiDong.push(loi(so, "don_gia", "DON_GIA_MO_HO"));
    const donVi = gt("don_vi");
    if (donVi === "") loiDong.push(loi(so, "don_vi", "DON_VI_RONG"));
    const tienTe = gt("tien_te").toUpperCase();
    if (tienTe !== "VND" && tienTe !== "USD") loiDong.push(loi(so, "tien_te", "TIEN_TE_SAI"));
    const tenNgay = loai === "MOC_NGOAI" ? "ngay_hieu_luc" : "ngay_mua";
    const ngay = docNgay(gt(tenNgay));
    if (ngay === null) loiDong.push(loi(so, tenNgay, "NGAY_SAI_HINH_DANG"));
    // So chuỗi ISO là so ngày.
    else if (loai === "LICH_SU_NGOAI" && ngay > homNay) loiDong.push(loi(so, tenNgay, "NGAY_MUA_SAU_HOM_NAY"));
    const nguon = gt("nguon");
    if (nguon.length < 1 || nguon.length > 500) loiDong.push(loi(so, "nguon", "NGUON_SAI_HINH_DANG"));
    let nhaCungCap: string | null = null;
    if (loai === "LICH_SU_NGOAI") {
      nhaCungCap = gt("nha_cung_cap");
      if (nhaCungCap.length < 1 || nhaCungCap.length > 300) loiDong.push(loi(so, "nha_cung_cap", "NHA_CUNG_CAP_SAI_HINH_DANG"));
    }
    if (loiDong.length > truocDo) continue;
    dong.push({ dong: so, maHang, donGia, donVi, tienTe: tienTe as "VND" | "USD", ngay: ngay!, nguon, nhaCungCap });
  }
  if (loiDong.length > 0) return { hopLe: false, loi: loiDong };
  return { hopLe: true, dong };
}
