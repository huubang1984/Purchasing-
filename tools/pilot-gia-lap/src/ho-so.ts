// ==============================================================================================
// tools/pilot-gia-lap — HỒ SƠ HAI DOANH NGHIỆP GIẢ LẬP
//
// Chủ dự án chọn ngày 2026-09-26: một doanh nghiệp SẢN XUẤT (ưu tiên số 1 của `docs/PRODUCT.md`
// §10) và một doanh nghiệp XÂY DỰNG — hai tổ chức, để lượt chạy đo luôn cả cô lập giữa tổ chức.
//
// MỌI TÊN Ở ĐÂY LÀ BỊA, VÀ NÓ PHẢI TRÔNG LÀ BỊA:
//   ⑴ tên tổ chức mở đầu bằng `[GIẢ LẬP]`, tên nhà cung cấp mở đầu bằng `[GL]` — màn so sánh và bộ
//      bằng chứng in tên pháp lý ra, nên nhãn đi theo dữ liệu tới tận tệp xuất;
//   ⑵ email thuộc tên miền `.invalid` (RFC 2606) — không thư nào đi được tới đâu;
//   ⑶ mã số thuế mở đầu bằng bảy số 0 — đúng hình dạng CHECK của `008`, không trùng hình dạng một
//      mã thật nào;
//   ⑷ số điện thoại sinh lúc chạy (xem `cum.ts` / `index.ts`), không nằm trong tệp này.
//
// Đơn giá thị trường là ƯỚC LƯỢNG của người viết cho năm 2026, đủ để bảng so sánh trông có lý;
// không một con số nào ở đây là báo giá thật hay dữ liệu thị trường đã kiểm.
// ==============================================================================================

export type VaiTro = "PROCUREMENT_MANAGER" | "DIRECTOR" | "FINANCE" | "BUYER";

export type Quyen =
  | "rfq.create"
  | "rfq.approve"
  | "rfq.open"
  | "rfq.invite"
  | "rfq.cancel"
  | "rfq.unseal"
  | "rfq.unseal.approve"
  | "rfq.bafo.open"
  | "bid.view"
  | "evaluation.perform"
  | "award.recommend"
  | "po.approve"
  | "audit.read"
  | "supplier.manage"
  | "policy.manage";

/**
 * BẢN SAO MỘT PHẦN của ma trận quyền (`db/migrations/005`, `023`, `033`, `059`) — chỉ những mã danh
 * mục kịch bản dùng. Nó tồn tại cho ĐÚNG MỘT việc: `kich-ban.test.ts` kiểm TRƯỚC khi chạy rằng mỗi
 * kịch bản giao việc cho một vai giữ quyền ấy. Nó không phải nguồn sự thật: lượt chạy thật đi qua
 * `requirePermission` của CSDL, và một bản sao lệch sẽ lộ ra ở đó thành một bước KHÔNG ĐẠT.
 */
export const QUYEN_THEO_VAI: Readonly<Record<VaiTro, readonly Quyen[]>> = {
  PROCUREMENT_MANAGER: [
    "rfq.create",
    "rfq.invite",
    "rfq.approve",
    "rfq.open",
    "rfq.cancel",
    "rfq.unseal",
    "rfq.bafo.open",
    "bid.view",
    "evaluation.perform",
    "award.recommend",
    "supplier.manage",
  ],
  DIRECTOR: ["rfq.unseal", "rfq.unseal.approve", "bid.view", "award.recommend", "po.approve", "audit.read"],
  FINANCE: ["policy.manage", "bid.view", "evaluation.perform", "award.recommend", "po.approve", "audit.read"],
  BUYER: ["rfq.create", "rfq.invite", "evaluation.perform", "award.recommend"],
};

export function coQuyen(vai: VaiTro, quyen: Quyen): boolean {
  return QUYEN_THEO_VAI[vai].includes(quyen);
}

export interface NguoiHoSo {
  /** Mã ngắn dùng trong danh mục kịch bản. */
  readonly ma: string;
  readonly hoTen: string;
  readonly chucDanh: string;
  readonly vai: VaiTro;
  /** Phần trước `@`; tên miền là của tổ chức. */
  readonly hopThu: string;
}

export interface LienHeHoSo {
  readonly ma: string;
  readonly hoTen: string;
  readonly boPhan: string;
  readonly hopThu: string;
}

export interface NhaCungCapHoSo {
  readonly ma: string;
  readonly tenPhapLy: string;
  readonly mst: string;
  readonly tenMien: string;
  /** Liên hệ ĐẦU TIÊN là người báo giá; liên hệ sau (nếu có) dùng cho kịch bản mời sai người. */
  readonly lienHe: readonly LienHeHoSo[];
}

export interface HangHoa {
  readonly ma: string;
  readonly moTa: string;
  readonly donVi: string;
  /** Số nguyên đồng, ước lượng 2026 — xem khối đầu tệp. */
  readonly donGiaThiTruong: string;
}

export type MaToChuc = "SX" | "XD";

export interface HoSoToChuc {
  readonly ma: MaToChuc;
  readonly ten: string;
  readonly nganh: string;
  readonly tenMien: string;
  readonly slugGoc: string;
  /** Ngưỡng phê duyệt kép của chính sách v1, VND, hai chữ số lẻ. */
  readonly nguongKep: string;
  readonly bafoTopN: number;
  readonly nguoi: readonly NguoiHoSo[];
  readonly nhaCungCap: readonly NhaCungCapHoSo[];
  readonly hangHoa: readonly HangHoa[];
}

const SX: HoSoToChuc = {
  ma: "SX",
  ten: "[GIẢ LẬP] Công ty CP Cơ khí Chính xác Tân Phú Minh",
  nganh: "Sản xuất — gia công cơ khí, chế tạo khuôn dập",
  tenMien: "tan-phu-minh.gia-lap.invalid",
  slugGoc: "gl-co-khi-tpm",
  nguongKep: "500000000.00",
  bafoTopN: 2,
  nguoi: [
    { ma: "tp", hoTen: "Nguyễn Văn Hùng", chucDanh: "Trưởng phòng Mua hàng", vai: "PROCUREMENT_MANAGER", hopThu: "hung.nv" },
    { ma: "pp", hoTen: "Trần Thị Mai", chucDanh: "Phó phòng Mua hàng", vai: "PROCUREMENT_MANAGER", hopThu: "mai.tt" },
    { ma: "cv", hoTen: "Lê Quốc Bảo", chucDanh: "Chuyên viên mua hàng cấp cao", vai: "PROCUREMENT_MANAGER", hopThu: "bao.lq" },
    { ma: "nv", hoTen: "Phạm Thu Trang", chucDanh: "Nhân viên mua hàng", vai: "BUYER", hopThu: "trang.pt" },
    { ma: "gd", hoTen: "Đặng Minh Tuấn", chucDanh: "Giám đốc điều hành", vai: "DIRECTOR", hopThu: "tuan.dm" },
    { ma: "pgd", hoTen: "Võ Thị Hạnh", chucDanh: "Phó Giám đốc sản xuất", vai: "DIRECTOR", hopThu: "hanh.vt" },
    { ma: "ktt", hoTen: "Bùi Thanh Hà", chucDanh: "Kế toán trưởng", vai: "FINANCE", hopThu: "ha.bt" },
  ],
  nhaCungCap: [
    {
      ma: "S1",
      tenPhapLy: "[GL] Công ty TNHH Thép Kim Ngân",
      mst: "0000000101",
      tenMien: "thep-kim-ngan.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Ngô Văn Lực", boPhan: "Kinh doanh dự án", hopThu: "luc.nv" }],
    },
    {
      ma: "S2",
      tenPhapLy: "[GL] Công ty CP Vật tư Công nghiệp Hải Đăng",
      mst: "0000000102",
      tenMien: "vt-hai-dang.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Phùng Thị Yến", boPhan: "Phòng bán hàng", hopThu: "yen.pt" }],
    },
    {
      ma: "S3",
      tenPhapLy: "[GL] Công ty TNHH Kim khí Phú Thịnh",
      mst: "0000000103",
      tenMien: "kk-phu-thinh.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Tạ Đức Thịnh", boPhan: "Kinh doanh", hopThu: "thinh.td" }],
    },
    {
      ma: "S4",
      tenPhapLy: "[GL] Công ty CP Thiết bị Cơ khí Nam Việt",
      mst: "0000000104",
      tenMien: "tbck-nam-viet.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Châu Minh Khoa", boPhan: "Kinh doanh khu vực phía Bắc", hopThu: "khoa.cm" }],
    },
    {
      ma: "S5",
      tenPhapLy: "[GL] Công ty TNHH Dụng cụ Cắt gọt Tâm An",
      mst: "0000000105",
      tenMien: "dccg-tam-an.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Lương Thị Hoa", boPhan: "Chăm sóc khách hàng công nghiệp", hopThu: "hoa.lt" }],
    },
    {
      ma: "S6",
      tenPhapLy: "[GL] Công ty TNHH Hoá chất và Dầu nhớt Bình Minh",
      mst: "0000000106",
      tenMien: "hc-binh-minh.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Kiều Văn Sơn", boPhan: "Kinh doanh", hopThu: "son.kv" }],
    },
  ],
  hangHoa: [
    { ma: "THEP_TAM", moTa: "Thép tấm SS400 dày 10mm, khổ 1500x6000", donVi: "tấm", donGiaThiTruong: "12000000" },
    { ma: "THEP_TRON", moTa: "Thép tròn đặc S45C Ø50, cây 6m", donVi: "cây", donGiaThiTruong: "2000000" },
    { ma: "BU_LONG", moTa: "Bu lông lục giác M16x60 cấp bền 8.8, mạ kẽm", donVi: "bộ", donGiaThiTruong: "6500" },
    { ma: "VONG_BI", moTa: "Vòng bi cầu 6205-2RS", donVi: "vòng", donGiaThiTruong: "45000" },
    { ma: "DAU_TL", moTa: "Dầu thuỷ lực ISO VG 46, phuy 209 lít", donVi: "phuy", donGiaThiTruong: "9500000" },
    { ma: "MANH_DAO", moTa: "Mảnh dao tiện hợp kim CNMG120408, hộp 10 mảnh", donVi: "hộp", donGiaThiTruong: "1200000" },
    { ma: "SON_EPOXY", moTa: "Sơn lót chống gỉ epoxy hai thành phần, thùng 20 lít", donVi: "thùng", donGiaThiTruong: "2800000" },
    { ma: "KHI_AR", moTa: "Khí Argon 99,999%, chai 40 lít", donVi: "chai", donGiaThiTruong: "650000" },
    { ma: "DA_MAI", moTa: "Đá mài 180x6x22", donVi: "viên", donGiaThiTruong: "38000" },
    { ma: "DAY_HAN", moTa: "Dây hàn MIG ER70S-6 Ø1.2, cuộn 15kg (tính theo kg)", donVi: "kg", donGiaThiTruong: "38500" },
    { ma: "MO_CHIU_NHIET", moTa: "Mỡ bôi trơn chịu nhiệt gốc lithium complex", donVi: "kg", donGiaThiTruong: "95000" },
  ],
};

const XD: HoSoToChuc = {
  ma: "XD",
  ten: "[GIẢ LẬP] Công ty CP Xây dựng Hạ tầng Bắc Sơn",
  nganh: "Xây dựng — nhà xưởng khu công nghiệp, hạ tầng thoát nước",
  tenMien: "xd-bac-son.gia-lap.invalid",
  slugGoc: "gl-xay-dung-bs",
  nguongKep: "2000000000.00",
  bafoTopN: 3,
  nguoi: [
    { ma: "tp", hoTen: "Hoàng Văn Nam", chucDanh: "Trưởng phòng Vật tư", vai: "PROCUREMENT_MANAGER", hopThu: "nam.hv" },
    { ma: "pp", hoTen: "Đỗ Thị Lan", chucDanh: "Phó phòng Vật tư", vai: "PROCUREMENT_MANAGER", hopThu: "lan.dt" },
    { ma: "cv", hoTen: "Nguyễn Hữu Phước", chucDanh: "Kỹ sư vật tư dự án", vai: "PROCUREMENT_MANAGER", hopThu: "phuoc.nh" },
    { ma: "nv", hoTen: "Lý Minh Châu", chucDanh: "Nhân viên cung ứng", vai: "BUYER", hopThu: "chau.lm" },
    { ma: "gd", hoTen: "Trịnh Quang Vinh", chucDanh: "Tổng Giám đốc", vai: "DIRECTOR", hopThu: "vinh.tq" },
    { ma: "pgd", hoTen: "Mai Anh Tú", chucDanh: "Phó Tổng Giám đốc phụ trách thi công", vai: "DIRECTOR", hopThu: "tu.ma" },
    { ma: "ktt", hoTen: "Phan Thị Ngọc", chucDanh: "Kế toán trưởng", vai: "FINANCE", hopThu: "ngoc.pt" },
  ],
  nhaCungCap: [
    {
      ma: "X1",
      tenPhapLy: "[GL] Công ty TNHH Vật liệu Xây dựng Hoà Bình Xanh",
      mst: "0000000201",
      tenMien: "vlxd-hbx.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Vũ Đình Khang", boPhan: "Kinh doanh dự án", hopThu: "khang.vd" }],
    },
    {
      ma: "X2",
      tenPhapLy: "[GL] Công ty CP Thép Xây dựng Trường Sơn",
      mst: "0000000202",
      tenMien: "thep-truong-son.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Hà Thị Thu", boPhan: "Phòng kinh doanh thép", hopThu: "thu.ht" }],
    },
    {
      ma: "X3",
      tenPhapLy: "[GL] Công ty TNHH Bê tông Phú Lộc Tiến",
      mst: "0000000203",
      tenMien: "bt-phu-loc-tien.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Đinh Công Lộc", boPhan: "Điều độ và kinh doanh", hopThu: "loc.dc" }],
    },
    {
      ma: "X4",
      tenPhapLy: "[GL] Công ty CP Cát Đá Tây Bắc Sơn",
      mst: "0000000204",
      tenMien: "cat-da-tbs.gia-lap.invalid",
      lienHe: [
        { ma: "kd", hoTen: "Sầm Văn Đạt", boPhan: "Kinh doanh", hopThu: "dat.sv" },
        { ma: "kt", hoTen: "Âu Thị Duyên", boPhan: "Kế toán công nợ", hopThu: "duyen.at" },
      ],
    },
    {
      ma: "X5",
      tenPhapLy: "[GL] Công ty TNHH Cốp pha và Giàn giáo An Khang",
      mst: "0000000205",
      tenMien: "cop-pha-an-khang.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Quách Minh Tâm", boPhan: "Cho thuê thiết bị", hopThu: "tam.qm" }],
    },
    {
      ma: "X6",
      tenPhapLy: "[GL] Công ty CP Ống nhựa Hạ tầng Tân Hưng Phát",
      mst: "0000000206",
      tenMien: "ong-nhua-thp.gia-lap.invalid",
      lienHe: [{ ma: "kd", hoTen: "Lạc Thị Bích", boPhan: "Kinh doanh hạ tầng", hopThu: "bich.lt" }],
    },
  ],
  hangHoa: [
    { ma: "XI_MANG", moTa: "Xi măng PCB40, bao 50kg (quy đổi tấn)", donVi: "tấn", donGiaThiTruong: "1500000" },
    { ma: "THEP_D20", moTa: "Thép thanh vằn CB400-V D20", donVi: "tấn", donGiaThiTruong: "15800000" },
    { ma: "THEP_CUON", moTa: "Thép cuộn CB240-T Ø8", donVi: "tấn", donGiaThiTruong: "15500000" },
    { ma: "CAT_VANG", moTa: "Cát vàng bê tông, giao tại trạm trộn", donVi: "m3", donGiaThiTruong: "420000" },
    { ma: "DA_12", moTa: "Đá dăm 1x2, giao tại trạm trộn", donVi: "m3", donGiaThiTruong: "380000" },
    { ma: "BT_M300", moTa: "Bê tông thương phẩm M300, độ sụt 12±2, bơm cần", donVi: "m3", donGiaThiTruong: "1250000" },
    { ma: "COP_PHA", moTa: "Cốp pha phủ phim 1220x2440x18mm", donVi: "tấm", donGiaThiTruong: "320000" },
    { ma: "GIAN_GIAO", moTa: "Giàn giáo khung 1,7m đủ bộ, thuê 3 tháng", donVi: "bộ", donGiaThiTruong: "85000" },
    { ma: "ONG_HDPE", moTa: "Ống HDPE PE100 D110 PN10", donVi: "m", donGiaThiTruong: "180000" },
    { ma: "DAU_CHONG_DINH", moTa: "Dầu chống dính cốp pha gốc khoáng", donVi: "lít", donGiaThiTruong: "42000" },
  ],
};

export const HO_SO: readonly HoSoToChuc[] = [SX, XD];

export function hoSo(ma: MaToChuc): HoSoToChuc {
  const hs = HO_SO.find((h) => h.ma === ma);
  if (hs === undefined) throw new Error(`không có hồ sơ tổ chức ${ma}`);
  return hs;
}

export function emailNguoi(hs: HoSoToChuc, n: NguoiHoSo): string {
  return `${n.hopThu}@${hs.tenMien}`;
}

export function emailLienHe(ncc: NhaCungCapHoSo, lh: LienHeHoSo): string {
  return `${lh.hopThu}@${ncc.tenMien}`;
}

export function nguoiTheoMa(hs: HoSoToChuc, ma: string): NguoiHoSo {
  const n = hs.nguoi.find((x) => x.ma === ma);
  if (n === undefined) throw new Error(`${hs.ma}: không có người mang mã "${ma}"`);
  return n;
}

export function nhaCungCapTheoMa(hs: HoSoToChuc, ma: string): NhaCungCapHoSo {
  const n = hs.nhaCungCap.find((x) => x.ma === ma);
  if (n === undefined) throw new Error(`${hs.ma}: không có nhà cung cấp mang mã "${ma}"`);
  return n;
}

export function hangHoaTheoMa(hs: HoSoToChuc, ma: string): HangHoa {
  const h = hs.hangHoa.find((x) => x.ma === ma);
  if (h === undefined) throw new Error(`${hs.ma}: không có hàng hoá mang mã "${ma}"`);
  return h;
}
