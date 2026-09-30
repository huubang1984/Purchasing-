// [S1.204 / S4.3a] Lõi thuần của bộ chuẩn hoá (spec S4 §4.4). Tất định: không I/O, không ngẫu nhiên, không đồng hồ.
//
// Hai bước đầu của V2.1 §14 KHÔNG ở đây (§2.5 ⒄): làm sạch là hàm SQL `chuoi_sach`, đơn vị là `don_vi_tai`. Lõi nhận chuỗi
// ĐÃ làm sạch và tập hàng chuẩn đã đọc — không cài lại luật làm sạch.
//
// `TU_DONG` cũng KHÔNG ở đây (§2.4 ⑹): nó tồn tại khi và chỉ khi chuỗi đã làm sạch trùng CHÍNH XÁC một bí danh còn hiệu lực,
// và CSDL phán điều ấy ở trigger (L2). Lõi chỉ sinh GỢI Ý — `GOI_Y` hay `CAN_DUYET` — cho người quản lý dữ liệu; mọi khớp mờ,
// kể cả ≥ 95%, là gợi ý.
//
// Bộ luật có PHIÊN BẢN. Mọi đổi luật ở bước trích thuộc tính, khớp, độ tin cậy hay định tuyến phải thêm một bộ luật mới vào
// `BO_LUAT` và tăng `PHIEN_BAN_BO_CHUAN_HOA` — bộ cũ giữ nguyên (§2.5 ㉓). Bảng ca ở `chuan-hoa.test.ts` ghim đầu ra của từng
// phiên bản: đổi luật mà không đổi hằng thì bảng ca đỏ.

/** Phiên bản hiện hành của bộ luật — mọi hàng gợi ý và ánh xạ mang nó. */
export const PHIEN_BAN_BO_CHUAN_HOA = 1;

/**
 * Ngưỡng GIẢ ĐỊNH của bộ luật bản 1 (§2.4 ⑹): hai con số của V2.1 §14, rời chính sách. `NGUONG_TU_DONG` không định tuyến gì —
 * `TU_DONG` là việc của bí danh — mà là trần của độ tin cậy khi một thuộc tính trọng yếu THIẾU: thiếu thì không được đọc như
 * chắc chắn. Mâu thuẫn thì bị chặn dưới `NGUONG_GOI_Y`: *"D10"* không bao giờ là gợi ý cho D32.
 */
export const NGUONG_TU_DONG = 0.95;
export const NGUONG_GOI_Y = 0.8;

/** Số ứng viên lưu trên hàng gợi ý. */
export const SO_UNG_VIEN = 5;

export interface UngVienHangChuan {
  readonly id: string;
  readonly ma: string;
  /** `chuoi_sach` của tên phiên bản mới nhất. */
  readonly tenSach: string;
  /** `chuoi_sach` của các bí danh còn hiệu lực — đã sạch sẵn trong bảng. */
  readonly biDanhSach: readonly string[];
  readonly thuocTinh: Readonly<Record<string, string>>;
  readonly thuocTinhTrongYeu: readonly string[];
}

export interface DiemUngVien {
  readonly hangChuanId: string;
  readonly ma: string;
  readonly diem: number;
}

export interface KetQuaChuanHoa {
  readonly phienBan: number;
  readonly ketQua: "GOI_Y" | "CAN_DUYET";
  /** Điểm của ứng viên đầu, 0 khi không có ứng viên nào. */
  readonly doTinCay: number;
  readonly thuocTinh: Readonly<Record<string, string>>;
  /** Tối đa `SO_UNG_VIEN`, điểm dương, giảm dần, hoà thì theo mã. */
  readonly ungVien: readonly DiemUngVien[];
}

interface BoLuat {
  trichThuocTinh(chuoiSach: string): Readonly<Record<string, string>>;
  cham(chuoiSach: string, thuocTinh: Readonly<Record<string, string>>, ung: UngVienHangChuan): number;
}

// ---- Bộ luật bản 1 -----------------------------------------------------------------------------------------------------------
// Chuỗi vào đã qua `chuoi_sach` bản 1: chữ thường `a-z0-9`, cách nhau một khoảng trắng (*"Thép D10-HP"* → `thep d10 hp`).
// Thuộc tính trọng yếu duy nhất được trích là `kich_thuoc` (chủ dự án chốt 2026-09-30): `d10`, `d 10`, `phi10`, `phi 10`,
// `10mm`, `10 mm` → `"10"`. Hai kích thước khác nhau trong một chuỗi là mơ hồ — không trích.
const RE_KICH_THUOC_V1 = /(?:^| )(?:(?:d|phi) ?(\d+)|(\d+) ?mm)(?= |$)/gu;

function trichThuocTinhV1(chuoiSach: string): Readonly<Record<string, string>> {
  const tap = new Set<string>();
  for (const m of chuoiSach.matchAll(RE_KICH_THUOC_V1)) {
    const so = m[1] ?? m[2];
    if (so !== undefined) tap.add(String(Number.parseInt(so, 10)));
  }
  return tap.size === 1 ? { kich_thuoc: [...tap][0] as string } : {};
}

/** Trigram theo từ, khuôn `pg_trgm`: mỗi từ đệm hai khoảng trắng đầu và một ở cuối. */
function trigram(s: string): Set<string> {
  const tap = new Set<string>();
  for (const tu of s.split(" ")) {
    if (tu === "") continue;
    const dem = `  ${tu} `;
    for (let i = 0; i + 3 <= dem.length; i++) tap.add(dem.slice(i, i + 3));
  }
  return tap;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let chung = 0;
  for (const x of a) if (b.has(x)) chung++;
  return chung / (a.size + b.size - chung);
}

/** Làm tròn bốn chữ số: điểm được lưu và so — hai lần tính không được lệch ở chữ số thứ mười bảy. */
function tron(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

/**
 * Điểm bản 1: độ giống chữ (Jaccard trigram, lấy cao nhất giữa tên và các bí danh), rồi ba luật thuộc tính trên `kich_thuoc`:
 * trùng thì cộng `THUONG_KHOP`; hai bên cùng khai mà khác nhau thì chặn dưới `NGUONG_GOI_Y` (mâu thuẫn — không bao giờ là
 * gợi ý); hàng chuẩn coi nó là trọng yếu mà chuỗi không có thì chặn dưới `NGUONG_TU_DONG` (thiếu — V2.1 §14 *"must not silently
 * merge"*).
 */
const THUONG_KHOP = 0.1;

function chamV1(chuoiSach: string, thuocTinh: Readonly<Record<string, string>>, ung: UngVienHangChuan): number {
  const tgVao = trigram(chuoiSach);
  let diem = jaccard(tgVao, trigram(ung.tenSach));
  for (const bd of ung.biDanhSach) diem = Math.max(diem, jaccard(tgVao, trigram(bd)));

  const kichThuocHang = ung.thuocTinh["kich_thuoc"];
  const kichThuocVao = thuocTinh["kich_thuoc"];
  if (kichThuocHang !== undefined && kichThuocVao !== undefined) {
    diem = kichThuocHang === kichThuocVao ? Math.min(1, diem + THUONG_KHOP) : Math.min(diem, NGUONG_GOI_Y - 0.01);
  } else if (kichThuocVao === undefined && ung.thuocTinhTrongYeu.includes("kich_thuoc")) {
    diem = Math.min(diem, NGUONG_TU_DONG - 0.01);
  }
  return tron(diem);
}

const BO_LUAT: Readonly<Record<number, BoLuat>> = {
  1: { trichThuocTinh: trichThuocTinhV1, cham: chamV1 },
};

/**
 * Chuẩn hoá một dòng dưới bộ luật `phienBan` (mặc định: hiện hành). Phiên bản không có trong `BO_LUAT` thì NÉM — một hàng cũ
 * mang phiên bản lạ không được tính lại bằng luật khác (L2 *"tái lập được"*).
 */
export function chuanHoa(
  chuoiSach: string,
  tapHangChuan: readonly UngVienHangChuan[],
  phienBan: number = PHIEN_BAN_BO_CHUAN_HOA,
): KetQuaChuanHoa {
  const boLuat = BO_LUAT[phienBan];
  if (boLuat === undefined) throw new Error(`không có bộ luật chuẩn hoá phiên bản ${phienBan}`);
  const thuocTinh = boLuat.trichThuocTinh(chuoiSach);
  const ungVien = tapHangChuan
    .map((u) => ({ hangChuanId: u.id, ma: u.ma, diem: boLuat.cham(chuoiSach, thuocTinh, u) }))
    .filter((u) => u.diem > 0)
    .sort((a, b) => b.diem - a.diem || (a.ma < b.ma ? -1 : a.ma > b.ma ? 1 : 0))
    .slice(0, SO_UNG_VIEN);
  const doTinCay = ungVien[0]?.diem ?? 0;
  return { phienBan, ketQua: doTinCay >= NGUONG_GOI_Y ? "GOI_Y" : "CAN_DUYET", doTinCay, thuocTinh, ungVien };
}
