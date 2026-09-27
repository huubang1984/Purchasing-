// ==============================================================================================
// [S1.168 / S3.1c] MÀN KHAI CHÍNH SÁCH — CẢNH BÁO CẤU HÌNH RỖNG RUỘT VÀ SỐ NGƯỜI TỐI THIỂU
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
