// ==============================================================================================
// [S1.9101 / S4.5c1] BENCHMARK Ở MÀN `/mo-thau` — CHỮ CỦA NHÃN, THÀNH PHẦN DẢI, ĐỘ PHỦ, CHỮ CỦA DẢI (spec S4 §4.6, §2.5 ⒁; ADR-9201)
//
// Phép tính THUẦN trên chính dữ liệu route trả về, nên chúng sống ở đây, được `tsc` gác và `benchmark.test.ts` đo, rồi phục vụ cho trình
// duyệt ở `/lib/benchmark.js` — khuôn `chinh-sach.ts`. Không lớp nào ở máy chủ đọc chúng: chúng là lời nói với người đọc, không phải chốt.
//
// CHỮ CỦA NHÃN theo spec §4.6: `BINH_THUONG` là *"trong dải lịch sử nội bộ (n gói, m nhà cung cấp)"* — vắng tín hiệu không có nghĩa là
// sạch, và dải có thể là dải của một cartel; `LECH_CAO` phía trên là *"Giá bất thường — nên xem xét"*; phía dưới là *"thấp bất thường"*,
// không bao giờ *"tốt"*, và chỉ dẫn tới một yêu cầu làm rõ — không bao giờ là căn cứ loại một báo giá (§2.4 ⑾).
// ĐỘ PHỦ (§2.5 ⒁): phần GIÁ TRỊ của báo giá nằm trên dòng đo được — nhãn có dải (`BINH_THUONG`, `LECH_VUA`, `LECH_CAO`). Dòng
// `CHUA_DU_LICH_SU` và `KHONG_DO_DUOC` không phủ.
// ==============================================================================================

import { nhomSo, sangNguyen } from "./so-tien.js";

/** Một hàng của `GET /rfqs/:rfqId/benchmark` (`dong[]`), đúng các trường màn đọc. */
export interface DongBenchmark {
  readonly bidVersionId: string;
  readonly lineNo: number;
  readonly nhan: string;
  readonly chieu: string | null;
  readonly lyDo: string | null;
  readonly soGoi: number | null;
  readonly soNcc: number | null;
  readonly soGoiCungNguoiTao: number | null;
  readonly soQuanSatHoiTo: number | null;
  readonly soLoaiTienTe: number | null;
  readonly soLoaiGia0: number | null;
  readonly hoiTo: readonly string[];
}

const LY_DO: Readonly<Record<string, string>> = {
  CHUA_ANH_XA: "dòng chưa ánh xạ về hàng chuẩn nào",
  KHONG_DOC_DUOC: "báo giá không đọc được dòng này",
  LECH_TONG: "đơn giá × số lượng lệch thành tiền của dòng",
  LECH_TIEN_TE: "dòng khác tiền tệ của báo giá",
  KHONG_QUY_DOI_DUOC: "không quy đổi được đơn vị của dòng về đơn vị gốc",
};

const HOI_TO: Readonly<Record<string, string>> = {
  ANH_XA: "ánh xạ",
  BI_DANH_DON_VI: "bí danh đơn vị",
  QUY_DOI: "quy đổi",
  PHIEN_BAN_HANG_CHUAN: "phiên bản hàng chuẩn",
};

/** Nhãn thành chữ. Nhãn lạ thì in nguyên mã — không đoán. */
export function chuNhan(d: DongBenchmark): string {
  const quyMo = `${String(d.soGoi ?? 0)} gói, ${String(d.soNcc ?? 0)} nhà cung cấp`;
  switch (d.nhan) {
    case "BINH_THUONG":
      return `trong dải lịch sử nội bộ (${quyMo})`;
    case "LECH_VUA":
      return d.chieu === "DUOI" ? "thấp hơn trung vị lịch sử — lệch vừa" : "cao hơn trung vị lịch sử — lệch vừa";
    case "LECH_CAO":
      return d.chieu === "DUOI"
        ? "Thấp bất thường — nên yêu cầu làm rõ, không phải căn cứ loại báo giá"
        : "Giá bất thường — nên xem xét";
    case "CHUA_DU_LICH_SU":
      return `chưa đủ lịch sử để so (${quyMo})`;
    case "KHONG_DO_DUOC":
      return `không đo được — ${LY_DO[d.lyDo ?? ""] ?? d.lyDo ?? "không rõ lý do"}`;
    default:
      return d.nhan;
  }
}

/** Thành phần của dải — spec §4.6: *n gói · m nhà cung cấp · k gói do chính người tạo gói này lập · h quan sát ánh xạ hồi tố*. */
export function chuThanhPhan(d: DongBenchmark): string {
  if (d.nhan === "KHONG_DO_DUOC") return d.hoiTo.length === 0 ? "—" : chuHoiTo(d.hoiTo);
  const phan = [
    `${String(d.soGoi ?? 0)} gói`,
    `${String(d.soNcc ?? 0)} nhà cung cấp`,
    `${String(d.soGoiCungNguoiTao ?? 0)} gói do chính người tạo gói này lập`,
    `${String(d.soQuanSatHoiTo ?? 0)} quan sát ánh xạ hồi tố`,
  ];
  const loai: string[] = [];
  if ((d.soLoaiTienTe ?? 0) > 0) loai.push(`${String(d.soLoaiTienTe)} khác tiền tệ`);
  if ((d.soLoaiGia0 ?? 0) > 0) loai.push(`${String(d.soLoaiGia0)} đơn giá 0`);
  const chu = phan.join(" · ") + (loai.length === 0 ? "" : ` (đã loại ${loai.join(", ")})`);
  return d.hoiTo.length === 0 ? chu : `${chu}. ${chuHoiTo(d.hoiTo)}`;
}

function chuHoiTo(hoiTo: readonly string[]): string {
  return `Dòng này đọc ${hoiTo.map((h) => HOI_TO[h] ?? h).join(", ")} ghi SAU mốc mở giá`;
}

const DO_DUOC = new Set(["BINH_THUONG", "LECH_VUA", "LECH_CAO"]);

/** Một dòng của phong bì như bảng so sánh trả (`payload.lines[]`) — chỉ hai trường màn đọc. */
export interface DongBaoGia {
  readonly lineNo: number;
  readonly amount: string;
}

export interface DoPhu {
  /** Số dòng của báo giá có nhãn đo được / tổng số dòng có hàng benchmark. */
  readonly soDoDuoc: number;
  readonly soDong: number;
  /** Phần trăm giá trị trên dòng đo được, một chữ số lẻ (cắt xuống); `null` khi thành tiền không đọc được hay tổng bằng 0. */
  readonly phanTramGiaTri: string | null;
}

/** Độ phủ của MỘT báo giá: các hàng benchmark của nó và các dòng phong bì của nó. */
export function doPhu(dong: readonly DongBenchmark[], dongBaoGia: readonly DongBaoGia[]): DoPhu {
  const soDoDuoc = dong.filter((d) => DO_DUOC.has(d.nhan)).length;
  const doDuoc = new Set(dong.filter((d) => DO_DUOC.has(d.nhan)).map((d) => d.lineNo));
  let tong = 0n;
  let phu = 0n;
  for (const l of dongBaoGia) {
    const v = sangNguyen(l.amount, 2);
    if (v === null) return { soDoDuoc, soDong: dong.length, phanTramGiaTri: null };
    tong += v;
    if (doDuoc.has(l.lineNo)) phu += v;
  }
  if (tong === 0n) return { soDoDuoc, soDong: dong.length, phanTramGiaTri: null };
  const phanNghin = (phu * 1000n) / tong;
  return { soDoDuoc, soDong: dong.length, phanTramGiaTri: `${String(phanNghin / 10n)},${String(phanNghin % 10n)}` };
}

/** Tóm tắt nhãn của một báo giá cho bảng xếp hạng: đếm theo nhóm, bỏ nhóm rỗng. */
export function tomTatNhan(dong: readonly DongBenchmark[]): string {
  const dem = (f: (d: DongBenchmark) => boolean): number => dong.filter(f).length;
  const phan: [number, string][] = [
    [dem((d) => d.nhan === "BINH_THUONG"), "trong dải"],
    [dem((d) => d.nhan === "LECH_VUA"), "lệch vừa"],
    [dem((d) => d.nhan === "LECH_CAO" && d.chieu !== "DUOI"), "bất thường (cao)"],
    [dem((d) => d.nhan === "LECH_CAO" && d.chieu === "DUOI"), "thấp bất thường"],
    [dem((d) => d.nhan === "CHUA_DU_LICH_SU"), "chưa đủ lịch sử"],
    [dem((d) => d.nhan === "KHONG_DO_DUOC"), "không đo được"],
  ];
  const chu = phan.filter(([n]) => n > 0).map(([n, ten]) => `${String(n)} ${ten}`);
  return chu.length === 0 ? "—" : chu.join(" · ");
}

/** Câu của các trạng thái không có nhãn — `null` khi trạng thái là `CO`. */
export function chuTrangThai(b: { readonly trangThai: string; readonly rfqStatus?: string; readonly policyVersion?: number | null }): string | null {
  switch (b.trangThai) {
    case "CO":
      return null;
    case "VONG_CHAO_LAI_DANG_MO":
      return "Vòng chào lại đang mở hay chưa mở niêm phong — benchmark đóng tới khi vòng ấy mở niêm phong.";
    case "KHONG_HIEN":
      return `Benchmark chỉ hiện khi bảng so sánh mở — gói đang ở trạng thái ${b.rfqStatus ?? "?"}.`;
    case "CHUA_CAU_HINH":
      return b.policyVersion === null || b.policyVersion === undefined
        ? "Gói không ghim phiên bản chính sách nào lúc mở — không có cấu hình benchmark."
        : `Phiên bản chính sách ${String(b.policyVersion)} mà gói ghim lúc mở chưa cấu hình benchmark.`;
    default:
      return b.trangThai;
  }
}

/** Số thập phân không dấu → dạng đọc được, làm tròn nửa-ra-xa-0 về hai chữ số lẻ: `12500.125` → `12.500,13`. */
export function soDai(chuoi: string | null): string {
  if (chuoi === null) return "—";
  const k = /^(\d+)(?:\.(\d+))?$/u.exec(chuoi.trim());
  if (k === null) return chuoi;
  const le = k[2] ?? "";
  const giu = BigInt(`${k[1] ?? "0"}${(le + "00").slice(0, 2)}`);
  const tron = le.length > 2 && Number(le[2]) >= 5 ? giu + 1n : giu;
  return `${nhomSo(String(tron / 100n))},${String(tron % 100n).padStart(2, "0")}`;
}

/** Một dải của *Xem dải* (`GET /rfqs/:rfqId/items/:lineNo/benchmark`) thành một câu. */
export function chuDai(
  d: {
    readonly tienTe: string;
    readonly duSan: boolean;
    readonly q1: string | null;
    readonly trungVi: string | null;
    readonly q3: string | null;
    readonly soGoi: number;
    readonly soNcc: number;
    readonly sauMoc: Readonly<Record<string, number>>;
    readonly khopBanLuu: boolean;
  },
  donViGoc: string | null,
): string {
  const donVi = `${d.tienTe}/${donViGoc ?? "đơn vị gốc"}`;
  const so = d.duSan
    ? `Q1 ${soDai(d.q1)} · trung vị ${soDai(d.trungVi)} · Q3 ${soDai(d.q3)} ${donVi} (${String(d.soGoi)} gói, ${String(d.soNcc)} nhà cung cấp)`
    : `chưa đủ lịch sử — không con số nào (${String(d.soGoi)} gói, ${String(d.soNcc)} nhà cung cấp)`;
  const sau = Object.entries(d.sauMoc).filter(([, n]) => n > 0);
  const chuSau =
    sau.length === 0
      ? ""
      : `. Hàng nền ghi SAU mốc mở giá mà dải này không dùng: ${sau.map(([loai, n]) => `${String(n)} ${HOI_TO[loai] ?? loai}`).join(", ")}`;
  const lech = d.khopBanLuu ? "" : ". CẢNH BÁO: số đếm tính lại KHÁC bản lưu — dữ liệu nền đã đổi ngoài luật chỉ-ghi-thêm";
  return `${so}${chuSau}${lech}`;
}
