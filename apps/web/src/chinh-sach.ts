// ==============================================================================================
// [S1.169 / S3.1c] MÀN KHAI CHÍNH SÁCH — CẢNH BÁO CẤU HÌNH RỖNG RUỘT VÀ SỐ NGƯỜI TỐI THIỂU
//
// Spec S3 §8.1 ⑵: màn khai chính sách CẢNH BÁO — không chặn — ba cấu hình rỗng ruột. §8.10: màn phải cho thấy số người
// tối thiểu mà một cấu hình đòi, TRƯỚC khi tổ chức bật S3 — vì khi thiếu người, lối thoát dễ nhất là nới chính sách, tức
// đúng kiểm soát giả của §8.1. Cả hai là phép tính THUẦN trên chính ma trận người dùng đang soạn, nên chúng sống ở đây,
// được `tsc` gác và `chinh-sach.test.ts` đo, rồi phục vụ cho trình duyệt ở `/lib/chinh-sach.js` — khuôn `so-tien.ts`.
// Không lớp nào ở máy chủ đọc hai phép tính này: chúng là lời nói với người khai, không phải chốt.
//
// ----------------------------------------------------------------------------------------------
// SỐ NGƯỜI TỐI THIỂU LÀ SỐ CỦA MÔ HÌNH §7 — MỖI NGƯỜI MỘT VAI — VÀ ĐÂY LÀ GIẢ ĐỊNH CỦA NÓ
// ----------------------------------------------------------------------------------------------
// Bảng vai §7 của spec xếp từng bước của một gói cho một vai, và ghi vì sao hai bước không được cùng một người. Hàm
// dưới tính lại bảng ấy cho TỪNG bậc của cấu hình, với đúng các luật mà bảng dựa vào:
//   · FINANCE: người khai (F1) và người ký phiên bản (F2, khác F1 — ADR-082 ⑺). F2 cũng xác minh và thẩm định.
//   · Mua sắm (BUYER/PM): người tạo gói (P1, cũng điều phối mở thầu) và `s` người ký mở gói (PM — chỉ PM giữ
//     `rfq.approve`), khác P1 (D2). Người đề xuất trao thầu là một người ký mở gói: khác P1 và người điều phối (J3).
//   · DIRECTOR: `s` người phê duyệt mở niêm phong (chỉ DIRECTOR giữ `rfq.unseal.approve`).
//   · `s` = 2 khi bậc chứa giá trị ≥ ngưỡng kép, còn không là 1 — ngưỡng quyết cả chữ ký mở gói (C-1, sàn một chữ ký
//     `068`) lẫn phê duyệt mở thầu (`unseal_so_phe_duyet_can`, `019`). Tính ở ĐẦU TRÊN của bậc: gói lớn nhất của bậc.
//   · Người ký trao thầu: `award_so_chu_ky` người thuộc `award_vai`, không phải tác giả chính sách (F1), không phải người
//     thẩm định (F2 khi `tham_dinh_truoc_trao`) — §7: *"F1 bị loại, F2 bị loại (đã thẩm định B)"*. Dùng lại người đã có
//     trước; `award_vai_khac_nhau` đòi hai người ký thuộc hai vai.
// Ba vai tách nhau vì D3 và `033` cấm một người mang FINANCE cùng BUYER/PM, và DIRECTOR cùng BUYER/PM. D3 KHÔNG cấm
// FINANCE cùng DIRECTOR: một tổ chức gán cả hai cho một người thì con số THẬT có thể thấp hơn con số ở đây. Màn nói rõ
// điều đó; con số này là của mô hình mỗi-người-một-vai mà §7 dùng, không phải một cận dưới đã chứng minh.
// Đối chứng: bậc 2 mặc định (§4.1) ra 7 — đúng con số §7 tự nêu — và bật `award_vai_khac_nhau` ở bậc ấy ra 8, đúng câu
// *"bật nó ở bậc 2 thì kịch bản §7 cần thêm một người FINANCE"* của chính spec.
// ==============================================================================================

import { nhomSo, sangNguyen } from "./so-tien.js";

/** Một bậc như CSDL cất (`069`): khoá viết theo lối CSDL, cùng lý do `ThanhPhanTrongSoVao`. */
export interface Bac {
  readonly tu_so_tien: number;
  readonly so_ncc_toi_thieu?: number;
  readonly award_vai_khac_nhau?: boolean;
  readonly ky_danh_sach_moi?: boolean;
  readonly xoay_vong_n?: number;
  readonly award_so_chu_ky?: number;
  readonly award_vai?: readonly string[];
  readonly tham_dinh_truoc_trao?: boolean;
  readonly khai_xung_dot?: boolean;
  readonly dau_thau_chinh_thuc: boolean;
}

/** Mặc định của spec S3 §4.1 — mọi ô là GIẢ ĐỊNH, mẫu điền sẵn của màn; không migration nào tự tạo chính sách. */
export const BAC_MAC_DINH: readonly Bac[] = [
  { tu_so_tien: 0, so_ncc_toi_thieu: 2, award_vai_khac_nhau: false, ky_danh_sach_moi: false, xoay_vong_n: 0, award_so_chu_ky: 1, award_vai: ["FINANCE", "DIRECTOR"], tham_dinh_truoc_trao: false, khai_xung_dot: true, dau_thau_chinh_thuc: false },
  { tu_so_tien: 100000000, so_ncc_toi_thieu: 3, award_vai_khac_nhau: false, ky_danh_sach_moi: true, xoay_vong_n: 5, award_so_chu_ky: 1, award_vai: ["FINANCE", "DIRECTOR"], tham_dinh_truoc_trao: false, khai_xung_dot: true, dau_thau_chinh_thuc: false },
  { tu_so_tien: 1000000000, so_ncc_toi_thieu: 5, award_vai_khac_nhau: false, ky_danh_sach_moi: true, xoay_vong_n: 5, award_so_chu_ky: 2, award_vai: ["FINANCE", "DIRECTOR"], tham_dinh_truoc_trao: true, khai_xung_dot: true, dau_thau_chinh_thuc: false },
  { tu_so_tien: 10000000000, dau_thau_chinh_thuc: true },
];

/** Mức chính sách mặc định (§4.1): cửa sổ chia nhỏ 30 ngày, hiệu lực thẩm định 12 tháng — GIẢ ĐỊNH. */
export const MUC_MAC_DINH = { chiaNhoCuaSoNgay: 30, thamDinhHieuLucThang: 12 } as const;

/** Ngưỡng phê duyệt kép mặc định (§4.1 bổ sung): trùng mốc bậc 2 và giá trị `gieo:demo` đặt. */
export const NGUONG_KEP_MAC_DINH = "1000000000.00";

/** Số đồng tiền của một cận dưới, tỉ lệ 10^2 — so bằng `bigint`, không so `double` (khuôn `so-tien.ts`). */
function xu(soTien: number | string): bigint | null {
  return sangNguyen(typeof soTien === "number" ? soTien.toFixed(2) : soTien, 2);
}

function moTa(b: Bac): string {
  return `bậc từ ${nhomSo(b.tu_so_tien.toFixed(0))}`;
}

/**
 * Ba cấu hình rỗng ruột của §8.1 ⑵, mỗi cái một câu. Không chặn: không lớp nào của S3 phán được một chính sách là ĐỦ
 * CHẶT — đó là quyết định của khách hàng; màn chỉ nói ra điều người khai có thể chưa thấy.
 */
export function canhBaoChinhSach(bac: readonly Bac[]): readonly string[] {
  const thuong = bac.filter((b) => !b.dau_thau_chinh_thuc);
  const ra: string[] = [];
  for (const [i, b] of thuong.entries()) {
    if (i > 0 && b.so_ncc_toi_thieu === 1) {
      ra.push(`${moTa(b)} chỉ đòi 1 nhà cung cấp — một bậc trên bậc thấp nhất mà một báo giá là đủ.`);
    }
    const duoi = thuong[i - 1];
    if (duoi !== undefined) {
      if ((b.so_ncc_toi_thieu ?? 0) < (duoi.so_ncc_toi_thieu ?? 0)) {
        ra.push(`${moTa(b)} đòi ÍT nhà cung cấp hơn ${moTa(duoi)} — giá trị tăng mà kiểm soát lỏng đi.`);
      }
      if ((b.award_so_chu_ky ?? 0) < (duoi.award_so_chu_ky ?? 0)) {
        ra.push(`${moTa(b)} đòi ÍT chữ ký trao thầu hơn ${moTa(duoi)} — giá trị tăng mà kiểm soát lỏng đi.`);
      }
    }
  }
  if (thuong.length > 0 && thuong.every((b) => b.ky_danh_sach_moi !== true)) {
    ra.push("Không bậc nào đòi ký danh sách mời (K5): danh sách nhà cung cấp của mọi gói do một người quyết.");
  }
  return ra;
}

/** Số người mỗi vai mà một bậc đòi, theo mô hình §7. */
export interface NguoiCuaBac {
  readonly finance: number;
  readonly muaSam: number;
  readonly giamDoc: number;
  readonly tong: number;
  /** `s`: số chữ ký mở gói và số phê duyệt mở niêm phong của gói lớn nhất trong bậc. */
  readonly chuKyMoGoi: number;
}

export type KetQuaBac =
  | { readonly tuSoTien: number; readonly loai: "DAU_THAU_CHINH_THUC" }
  | { readonly tuSoTien: number; readonly loai: "KHONG_KHA_THI"; readonly lyDo: string }
  | { readonly tuSoTien: number; readonly loai: "NGUOI"; readonly nguoi: NguoiCuaBac };

/**
 * Số người khác nhau mà MỘT gói ở mỗi bậc đòi, theo bảng vai §7 (mỗi người một vai) — xem khối đầu tệp. `nguongKep` là
 * `dual_approval_threshold` của chính phiên bản đang soạn, dạng chuỗi máy (`1000000000.00`).
 */
export function soNguoiToiThieu(bac: readonly Bac[], nguongKep: string): readonly KetQuaBac[] {
  const nguong = xu(nguongKep);
  return bac.map((b, i): KetQuaBac => {
    if (b.dau_thau_chinh_thuc) return { tuSoTien: b.tu_so_tien, loai: "DAU_THAU_CHINH_THUC" };
    const tren = bac[i + 1];
    const canTren = tren === undefined ? null : xu(tren.tu_so_tien);
    // Bậc chứa một giá trị ≥ ngưỡng khi nó không có đầu trên, hay đầu trên LỚN HƠN ngưỡng.
    const s = nguong === null || canTren === null || canTren > nguong ? 2 : 1;

    const vai = new Set(b.award_vai ?? []);
    const k = b.award_so_chu_ky ?? 1;
    const thamDinh = b.tham_dinh_truoc_trao === true;
    const giamDocRanh = vai.has("DIRECTOR") ? s : 0;
    // F1 là tác giả chính sách, luôn bị loại; F2 bị loại khi chính F2 thẩm định.
    const financeRanh = vai.has("FINANCE") && !thamDinh ? 1 : 0;
    let themGiamDoc = 0;
    let themFinance = 0;
    if (b.award_vai_khac_nhau === true && k === 2) {
      if (!vai.has("DIRECTOR") || !vai.has("FINANCE")) {
        return { tuSoTien: b.tu_so_tien, loai: "KHONG_KHA_THI", lyDo: "award_vai_khac_nhau đòi hai vai khác nhau trong award_vai" };
      }
      themFinance = financeRanh >= 1 ? 0 : 1;
    } else {
      let con = k - Math.min(k, giamDocRanh);
      con -= Math.min(con, financeRanh);
      if (con > 0) {
        if (vai.has("DIRECTOR")) themGiamDoc = con;
        else if (vai.has("FINANCE")) themFinance = con;
        else return { tuSoTien: b.tu_so_tien, loai: "KHONG_KHA_THI", lyDo: "award_vai rỗng — không ai ký được trao thầu" };
      }
    }
    const finance = 2 + themFinance;
    const muaSam = 1 + s;
    const giamDoc = s + themGiamDoc;
    return { tuSoTien: b.tu_so_tien, loai: "NGUOI", nguoi: { finance, muaSam, giamDoc, tong: finance + muaSam + giamDoc, chuKyMoGoi: s } };
  });
}

// ----------------------------------------------------------------------------------------------
// [S1.256 / S4.5b] NHÓM KHOÁ `benchmark` — MẪU ĐIỀN SẴN VÀ CẢNH BÁO TĨNH (spec S4 §4.1, §2.5 ㉒)
// ----------------------------------------------------------------------------------------------
// Mẫu là mặc định GIẢ ĐỊNH của spec S4 §4.1 — bản chép của `NHOM_BENCHMARK_MAU` (`packages/du-lieu-nen/src/benchmark.ts`), khoá
// với nó ở `tests/architecture/bac-mac-dinh-dong-bo.test.ts`: màn không import được gói. Cảnh báo là lời nói với người khai, không
// chặn: tập khoá, biên và thứ tự ngưỡng là của `CHECK` `org_procurement_policies_benchmark_hinh_dang`, và máy chủ nói điều ấy.
// Phần *"tác động trên lịch sử thật"* (bao nhiêu gói của tổ chức sẽ đổi nhãn) chờ S4.5c — nó cần một đường đọc có cổng.

/** Nhóm khoá `benchmark` như CSDL cất: sáu khoá, mọi giá trị là chuỗi. */
export interface NhomBenchmark {
  readonly cua_so_thang: string;
  readonly san_goi: string;
  readonly san_ncc: string;
  readonly nguong_lech_vua: string;
  readonly nguong_lech_cao: string;
  readonly phuong_phap: string;
}

export const BENCHMARK_MAC_DINH: NhomBenchmark = {
  cua_so_thang: "12",
  san_goi: "3",
  san_ncc: "3",
  nguong_lech_vua: "0.05",
  nguong_lech_cao: "0.10",
  phuong_phap: "TRUNG_VI_THEO_GOI_V1",
};

/** Biên của cảnh báo — GIẢ ĐỊNH, cùng hạng mặc định: hiệu chỉnh sau pilot. Ngưỡng tỉ lệ 10^4 (bốn chữ số lẻ, `103`). */
const SAN_TOI_THIEU = 3;
const NGUONG_VUA_RONG = 2000n;
const CUA_SO_DAI = 24;
const CUA_SO_NGAN = 3;

/** Chuỗi chữ số → số; mọi dạng khác (kể cả chuỗi rỗng) → `null`. */
const nguyenTuChuoi = (chuoi: string): number | null => (/^[0-9]{1,4}$/u.test(chuoi.trim()) ? Number(chuoi.trim()) : null);

/**
 * Cảnh báo tĩnh cho nhóm khoá đang soạn — một câu mỗi điều. `null`: phiên bản KHÔNG cấu hình benchmark. Giá trị không đọc được
 * thì im — máy chủ từ chối nó bằng lời của chính nó.
 */
export function canhBaoBenchmark(nhom: NhomBenchmark | null): readonly string[] {
  if (nhom === null) {
    return [
      "Phiên bản này KHÔNG cấu hình benchmark: mọi gói mở dưới nó hiện «chưa cấu hình» ở bảng so sánh và lượt chấm, kể cả khi phiên bản trước có cấu hình.",
    ];
  }
  const ra: string[] = [];
  const goi = nguyenTuChuoi(nhom.san_goi);
  const ncc = nguyenTuChuoi(nhom.san_ncc);
  if ((goi !== null && goi < SAN_TOI_THIEU) || (ncc !== null && ncc < SAN_TOI_THIEU)) {
    ra.push(`Sàn dưới ${String(SAN_TOI_THIEU)} gói hay ${String(SAN_TOI_THIEU)} nhà cung cấp: một hai người quen báo giá là đủ đặt cả dải mà gói sau bị so.`);
  }
  const vua = sangNguyen(nhom.nguong_lech_vua, 4);
  if (vua !== null && vua >= NGUONG_VUA_RONG) {
    ra.push("Ngưỡng lệch vừa từ 20% trở lên: một giá lệch tới mức ấy so với trung vị vẫn hiện «trong dải lịch sử».");
  }
  const cuaSo = nguyenTuChuoi(nhom.cua_so_thang);
  if (cuaSo !== null && cuaSo > CUA_SO_DAI) {
    ra.push(`Cửa sổ dài hơn ${String(CUA_SO_DAI)} tháng: giá cũ kéo trung vị, nhất là khi giá thị trường đã đổi.`);
  }
  if (cuaSo !== null && cuaSo < CUA_SO_NGAN) {
    ra.push(`Cửa sổ ngắn hơn ${String(CUA_SO_NGAN)} tháng: ít gói vào dải, và nhãn thường là «chưa đủ lịch sử».`);
  }
  return ra;
}

// ----------------------------------------------------------------------------------------------
// [S1.258 / khoản 329] TRỌNG SỐ CHẤM VÀ BAFO TOP-N — MẪU ĐIỀN SẴN VÀ CẢNH BÁO TĨNH
// ----------------------------------------------------------------------------------------------
// Trước vòng này màn không gửi `evalComponents`/`bafoTopN`, nên mọi phiên bản tạo trên màn không chấm được, và từ S4.5a (ADR-141)
// gói mở dưới phiên bản ấy không bao giờ chấm được. Chủ dự án chốt 2026-10-01: thành phần là CỐ ĐỊNH — đúng vế hẹp mà lượt chấm đọc
// được hôm nay (`luot-danh-gia.ts`: một thành phần, mã `MA_THANH_PHAN_GIA`, đơn vị `TIEN`) — màn hiện nó chỉ-đọc; BAFO top-N là ô
// sửa được. Mẫu là bản chép của `TRONG_SO_DEMO`/`BAFO_TOP_N_DEMO` (`tools/gieo-demo/src/chinh-sach-demo.ts`), khoá với nó và với
// mã của lượt chấm ở `tests/architecture/bac-mac-dinh-dong-bo.test.ts`. Cảnh báo không chặn: hình dạng là của `CHECK` `057`, cặp
// đi cùng nhau là của `056`, và máy chủ nói điều ấy.

/** Một thành phần trọng số như CSDL cất (`057`): khoá viết theo lối CSDL, cùng lý do `Bac`. */
export interface ThanhPhanTrongSo {
  readonly ma: string;
  readonly don_vi: string;
  readonly he_so: string;
}

export const TRONG_SO_MAC_DINH: readonly ThanhPhanTrongSo[] = [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }];

/** Số nhà thầu vào vòng BAFO; `0` là quy ước *"tổ chức không dùng BAFO"* (`056`). */
export const BAFO_TOP_N_MAC_DINH = 2;

// ----------------------------------------------------------------------------------------------
// [S1.9101 / S4.7b1] TCO — NĂM MÃ CÓ NGUỒN VÀ NHÓM KHOÁ `tco` (spec S4 §4.8, §2.5 ㉒; ADR-153)
// ----------------------------------------------------------------------------------------------
// Từ S4.7a (`112_tco`) lượt chấm đọc được năm mã tiền, mỗi mã đúng một nguồn; trước vòng này màn chỉ khai được `gia` (vế hẹp của
// khoản 329). Màn cho chọn mã — mỗi mã một ô, `gia` luôn bật, đơn vị `TIEN`, hệ số 1 — và khai ba tham số quy đổi. Phép kiểm dưới là
// BẢN CHÉP của `kiemChinhSachTco` (`packages/danh-gia/src/tco.ts`) trừ vế số ngày giao của gói: màn không import được gói, nên
// `tests/architecture/bac-mac-dinh-dong-bo.test.ts` đối chiếu hai bản trên một bảng ca. Cảnh báo không chặn (§2.5 ㉒): lượt chấm
// từ chối phiên bản hỏng bằng câu của chính nó.

/** Một mã thành phần có nguồn: tên trên màn và nguồn của nó — câu §8.6 *"phần nào là số đo, phần nào là số khai"*. */
export interface MaTco {
  readonly ma: string;
  readonly ten: string;
  readonly nguon: string;
}

/** Thứ tự là thứ tự chính sách — thứ tự `ma_thieu` gọi tên mã thiếu. `gia` đứng đầu và không bỏ được. */
export const MA_TCO: readonly MaTco[] = [
  { ma: "gia", ten: "Giá", nguon: "tổng báo giá nhà cung cấp nộp" },
  { ma: "van_chuyen", ten: "Vận chuyển", nguon: "ô nhà cung cấp khai trong báo giá" },
  { ma: "nhap_khau", ten: "Chi phí nhập khẩu", nguon: "ô nhà cung cấp khai trong báo giá" },
  {
    ma: "chi_phi_thanh_toan",
    ten: "Chi phí thanh toán",
    nguon: "quy đổi: số ngày trả sớm hơn kỳ chuẩn × chi phí vốn năm ÷ 365 × tổng báo giá",
  },
  {
    ma: "chi_phi_tre",
    ten: "Chi phí trễ giao",
    nguon: "quy đổi: số ngày giao khai vượt số ngày giao yêu cầu của gói × tỉ lệ mỗi ngày × tổng báo giá",
  },
];

/** Hệ số của mọi mã tiền — tiền cộng với tiền, không nhân hệ số (L8). */
export const HE_SO_TIEN = "1.0000";

/** Nhóm khoá `tco` như CSDL cất (`112`): mọi khoá tuỳ chọn, mọi giá trị là chuỗi. */
export interface NhomTco {
  readonly chi_phi_von_nam?: string;
  readonly ngay_thanh_toan_chuan?: string;
  readonly ty_le_tre_ngay?: string;
}

/** Mã của lượt chấm không có nguồn — bản chép của `MA_KHONG_NGUON`, cùng câu. */
const MA_KHONG_NGUON: Readonly<Record<string, string>> = {
  chat_luong: "chi phí chất lượng cần tỷ lệ lỗi từ phiếu nhập kho (GRN), chưa có nguồn dữ liệu tới S5",
  thue: "thuế GTGT khấu trừ được không phải chi phí, và mã này đã bị bỏ (ADR-097 ⑻)",
};

/** Thành phần cho một tập mã bật, theo thứ tự `MA_TCO`; `gia` luôn có. Mã ngoài năm mã bị bỏ qua. */
export function thanhPhanTuMa(ma: Iterable<string>): ThanhPhanTrongSo[] {
  const bat = new Set(ma);
  bat.add("gia");
  return MA_TCO.filter((m) => bat.has(m.ma)).map((m) => ({ ma: m.ma, don_vi: "TIEN", he_so: HE_SO_TIEN }));
}

/**
 * Lý do ĐẦU TIÊN lượt chấm sẽ từ chối trọng số này, cùng thứ tự kiểm của `kiemChinhSachTco`; `null` khi chấm được. Không gồm vế số
 * ngày giao — đó là của gói, `/tao-thau` nói.
 */
export function loiTrongSo(thanhPhan: readonly ThanhPhanTrongSo[], tco: NhomTco | null): string | null {
  const daThay = new Set<string>();
  for (const c of thanhPhan) {
    if (c.don_vi !== "TIEN") return `thành phần "${c.ma}" là điểm phi giá (DIEM), mà chưa có màn chấm điểm nào cho nó`;
    const khongNguon = Object.hasOwn(MA_KHONG_NGUON, c.ma) ? MA_KHONG_NGUON[c.ma] : undefined;
    if (khongNguon !== undefined) return `thành phần "${c.ma}" không chấm được: ${khongNguon}`;
    if (!MA_TCO.some((m) => m.ma === c.ma)) {
      return `thành phần "${c.ma}" không có nguồn dữ liệu; mã chấm được là ${MA_TCO.map((m) => `"${m.ma}"`).join(", ")}`;
    }
    if (daThay.has(c.ma)) return `thành phần "${c.ma}" khai hai lần`;
    daThay.add(c.ma);
    if (sangNguyen(c.he_so, 4) !== 10_000n) {
      return `hệ số của thành phần tiền "${c.ma}" là "${c.he_so}", không phải 1 — tiền cộng với tiền, không nhân hệ số (L8)`;
    }
  }
  if (!daThay.has("gia")) return 'không khai thành phần "gia" — chi phí hiệu dụng phải gồm giá';
  const co = (k: keyof NhomTco): boolean => typeof tco?.[k] === "string";
  if (daThay.has("chi_phi_thanh_toan") && (!co("chi_phi_von_nam") || !co("ngay_thanh_toan_chuan"))) {
    return 'thành phần "chi_phi_thanh_toan" cần chi phí vốn một năm và kỳ thanh toán chuẩn ở nhóm khoá tco, mà phiên bản không khai';
  }
  if (daThay.has("chi_phi_tre") && !co("ty_le_tre_ngay")) {
    return 'thành phần "chi_phi_tre" cần tỷ lệ chi phí trễ mỗi ngày ở nhóm khoá tco, mà phiên bản không khai';
  }
  return null;
}

/** [S1.258 / khoản 329] ~~Vế hẹp một thành phần `gia`~~ [S1.9101 / S4.7b1] Lượt chấm đọc được trọng số này (`loiTrongSo` im). */
export function trongSoChamDuoc(thanhPhan: readonly ThanhPhanTrongSo[], tco: NhomTco | null = null): boolean {
  return loiTrongSo(thanhPhan, tco) === null;
}

/** Cảnh báo tĩnh cho trọng số đang soạn. `null`: phiên bản KHÔNG khai trọng số. */
export function canhBaoTrongSo(thanhPhan: readonly ThanhPhanTrongSo[] | null, tco: NhomTco | null = null): readonly string[] {
  if (thanhPhan === null) {
    return [
      "Phiên bản này KHÔNG khai trọng số chấm: mọi gói mở dưới nó không chấm được, nên cũng không đề xuất trao thầu được — " +
        "và phiên bản tạo sau lúc gói mở không áp cho gói ấy.",
    ];
  }
  const loi = loiTrongSo(thanhPhan, tco);
  if (loi !== null) {
    return [`Trọng số này bị từ chối khi chấm — ${loi} — nên gói mở dưới phiên bản này không chấm được.`];
  }
  const ra: string[] = [];
  // [S1.9101 / S4.7b1 — TẠM, gỡ ở S4.7b2] Màn nộp báo giá chưa có ô khai TCO: nhà cung cấp chưa khai được mã nào ngoài giá, nên mọi báo
  // giá của gói mở dưới phiên bản ấy không có hạng (`ma_thieu`). Câu nói thật điều đó cho tới khi `/nop-thau` có ô (ADR-9201 ⑴).
  if (thanhPhan.some((t) => t.ma !== "gia")) {
    ra.push(
      "Màn nộp báo giá CHƯA có ô khai cho các thành phần ngoài giá (tới S4.7b2): nhà cung cấp chưa khai được chúng, nên mọi báo giá " +
        "của gói mở dưới phiên bản này sẽ không có hạng.",
    );
  }
  if (thanhPhan.some((t) => t.ma === "chi_phi_tre")) {
    ra.push(
      "Chi phí trễ giao bật: mỗi gói phải khai số ngày giao yêu cầu ở màn Tạo gói thầu TRƯỚC khi nộp duyệt — gói thiếu con số ấy " +
        "không mở được dưới phiên bản này.",
    );
  }
  return ra;
}

/**
 * [ADR-153, giới hạn ⑴] Gói ĐANG CHỜ DUYỆT chưa khai số ngày giao: nếu phiên bản tính chi phí trễ có hiệu lực trước lúc chúng mở,
 * chúng không mở được. Ở tổ chức đã bật, lối ra là trả gói về soạn thảo; ở tổ chức chưa bật không có cạnh ấy — chỉ còn huỷ.
 */
export function canhBaoGoiThieuSoNgayGiao(
  thanhPhan: readonly ThanhPhanTrongSo[] | null,
  soGoi: number,
  daBat: boolean,
): readonly string[] {
  if (thanhPhan === null || soGoi === 0 || !thanhPhan.some((t) => t.ma === "chi_phi_tre")) return [];
  const loiRa = daBat
    ? "người tạo gói hay người duyệt trả gói về soạn thảo để khai số ngày giao, rồi nộp duyệt lại"
    : "tổ chức chưa bật kiểm soát theo bậc nên gói đã nộp không trả về soạn thảo được — các gói ấy chỉ còn lối huỷ";
  return [
    `${String(soGoi)} gói đang chờ duyệt chưa khai số ngày giao yêu cầu: nếu phiên bản này có hiệu lực trước lúc chúng mở, chúng không ` +
      `mở được — ${loiRa}.`,
  ];
}

/** Một dòng cho nhóm khoá `tco` của một phiên bản — bảng phiên bản. */
export function moTaTco(tco: NhomTco | null): string {
  if (tco === null) return "";
  const ra: string[] = [];
  if (tco.chi_phi_von_nam !== undefined) ra.push(`vốn ${tco.chi_phi_von_nam}/năm`);
  if (tco.ngay_thanh_toan_chuan !== undefined) ra.push(`kỳ chuẩn ${tco.ngay_thanh_toan_chuan} ngày`);
  if (tco.ty_le_tre_ngay !== undefined) ra.push(`trễ ${tco.ty_le_tre_ngay}/ngày`);
  return ra.join(" · ");
}

/** Một dòng cho trọng số của một phiên bản — bảng phiên bản và khối trọng số dùng chung. */
export function moTaTrongSo(thanhPhan: readonly ThanhPhanTrongSo[] | null, bafoTopN: number | null): string {
  if (thanhPhan === null) return "chưa khai";
  const tp = thanhPhan.map((t) => `${t.ma}/${t.don_vi} ×${t.he_so}`).join(", ");
  const bafo = bafoTopN === null ? "" : bafoTopN === 0 ? " · không BAFO" : ` · BAFO top-${String(bafoTopN)}`;
  return `${tp}${bafo}`;
}
