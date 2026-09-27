// ==============================================================================================
// tools/pilot-gia-lap — DANH MỤC KỊCH BẢN, VIẾT BẰNG DỮ LIỆU
//
// Mỗi kịch bản là MỘT gói thầu đi qua đúng một đường của sản phẩm, và khai trước ba thứ:
//   ⑴ AI làm gì — `vai`: mã người trong hồ sơ tổ chức, cho từng bước;
//   ⑵ nó DỪNG ở đâu — `dungO`: chạy trọn tới trao thầu đã duyệt, hay để lại ở một trạng thái dở cho
//      người trình diễn làm tiếp trên màn hình (chủ dự án chọn "cả hai" ngày 2026-09-26);
//   ⑶ những KIỂM SOÁT nào phải bật lên — `kiem`: mỗi mục là một lần thử SAI có chủ đích, và kết quả
//      mong đợi là một lần TỪ CHỐI (403/422) của chính sản phẩm.
//
// Một bộ chạy DUY NHẤT (`chay-kich-ban.ts`) đọc bảng này; không kịch bản nào có mã riêng. Nhờ vậy
// `kiemDanhMuc` dưới đây kiểm được TRƯỚC KHI CHẠY rằng mỗi bước được giao cho một vai giữ quyền ấy,
// và rằng các ràng buộc tách bạch nhiệm vụ (D2, J3) không bị chính danh mục vi phạm một cách vô ý.
// ==============================================================================================

import {
  coQuyen,
  hangHoaTheoMa,
  hoSo,
  nguoiTheoMa,
  nhaCungCapTheoMa,
  type HoSoToChuc,
  type MaToChuc,
  type Quyen,
} from "./ho-so.js";
import { congTien, donGiaChao, soSanhTien, thanhTien } from "./tien.js";

/** Trạng thái kịch bản dừng lại. Năm trạng thái đầu là "gói dở" để lại cho buổi trình diễn. */
export type DungO =
  | "PENDING_APPROVAL"
  | "OPEN"
  | "UNSEAL_PENDING"
  | "AWARD_PROPOSED"
  | "CANCELLED"
  | "AWARD_APPROVED";

export interface DongHang {
  readonly hang: string;
  /** Bốn chữ số lẻ, đúng dạng `rfq_items.quantity`. */
  readonly soLuong: string;
}

export interface BaoGia {
  readonly ncc: string;
  /** Hệ số giá chào so với giá thị trường, phần nghìn (970 = 97%). */
  readonly heSo: number;
  /** Các lần SỬA GIÁ trước hạn — mỗi phần tử một phiên bản mới (v2, v3, …). */
  readonly suaLai?: readonly number[];
  /** Nộp SAU lần gia hạn thay vì trước. */
  readonly sauGiaHan?: boolean;
  /** Chỉ ở chế độ chậm: nộp SAU hạn, và phải bị từ chối. */
  readonly treHan?: boolean;
}

export interface VaiKichBan {
  readonly tao: string;
  readonly duyetGoi: readonly string[];
  readonly mo?: string;
  readonly moi?: string;
  readonly dong?: string;
  readonly huyGoi?: string;
  readonly giaHan?: string;
  readonly xinMo?: string;
  readonly duyetMo?: readonly string[];
  readonly dieuPhoi?: string;
  readonly cham?: string;
  readonly moBafo?: string;
  readonly deXuat?: string;
  readonly huyTraoThau?: string;
  readonly deXuatLai?: string;
  readonly duyetTraoThau?: string;
  readonly xuatBangChung?: string;
}

export interface KiemSoatKichBan {
  /** Người tạo gói (mang `rfq.approve`) tự phê duyệt gói của mình ⇒ 422 (D2). */
  readonly tuDuyetGoi?: boolean;
  /** Người xin mở thầu tự phê duyệt yêu cầu của mình ⇒ 403/422 (D2, D3). */
  readonly tuDuyetMo?: boolean;
  /** Người tạo gói hay người điều phối mở thầu đề xuất trao thầu ⇒ 422 (J3). */
  readonly j3?: boolean;
  /**
   * Người đề xuất tự duyệt đề xuất của mình. Lớp chặn tuỳ QUYỀN của người ấy, và danh mục đo cả hai
   * (`kich-ban.test.ts`): không giữ `po.approve` ⇒ 403 ở cổng quyền; giữ nó ⇒ 422 ở trigger J3 vế 1.
   */
  readonly tuDuyetTraoThau?: boolean;
  /** Mã một người KHÔNG có `bid.view` đọc bảng so sánh sau mở thầu ⇒ 403. */
  readonly khongXem?: string;
  /** Trước khi đóng: số báo giá bị giấu; trước khi mở thầu: bảng so sánh bị từ chối (A6, A4). */
  readonly muTruocMo?: boolean;
  /** Mã nhà cung cấp ĐÃ nộp, thử sửa giá SAU khi gói bị huỷ bằng khoá đọc từ trước ⇒ bị từ chối. */
  readonly nopSauHuy?: string;
}

export interface KichBan {
  readonly ma: string;
  readonly toChuc: MaToChuc;
  readonly ten: string;
  readonly minhHoa: readonly string[];
  /** Chỉ chạy với cờ `--cham`: đợi hạn nộp thật (≥ 1 giờ). */
  readonly cham?: boolean;
  readonly dungO: DungO;
  readonly goi: {
    readonly tieuDe: string;
    readonly hang: readonly DongHang[];
    readonly nganSach: string;
    /** Hạn nộp tính từ lúc tạo gói; ≥ 62 phút vì sàn `CUA_SO_TOI_THIEU` là 1 giờ tại lúc mở. */
    readonly hanNopPhut: number;
  };
  readonly vai: VaiKichBan;
  readonly moi: readonly { readonly ncc: string; readonly lienHe?: string }[];
  /** Mời NHẦM người liên hệ rồi thu hồi, trước khi mời đúng người. */
  readonly thuHoi?: { readonly ncc: string; readonly lienHeSai: string };
  readonly baoGia: readonly BaoGia[];
  readonly giaHan?: { readonly themPhut: number; readonly lyDo: string };
  readonly lyDoDong?: string;
  readonly lyDoMo?: string;
  readonly lyDoHuyGoi?: string;
  /** Hệ số (phần nghìn) áp lên GIÁ VÒNG MỘT của từng nhà cung cấp trong top-N, theo thứ hạng. */
  readonly bafo?: { readonly heSoTheoHang: readonly number[] };
  readonly lyDoDeXuat?: string;
  readonly huyTraoThau?: { readonly lyDo: string; readonly hangMoi: number; readonly lyDoDeXuatLai: string };
  readonly kiem: KiemSoatKichBan;
}

// ----------------------------------------------------------------------------------------------
// Danh mục
// ----------------------------------------------------------------------------------------------

export const DANH_MUC: readonly KichBan[] = [
  {
    ma: "SX-01",
    toChuc: "SX",
    ten: "Thép tấm, thép tròn và bu lông cho đơn hàng khuôn dập quý IV",
    minhHoa: [
      "đường chuẩn dưới ngưỡng: MỘT chữ ký duyệt gói (sàn một chữ ký, ADR-085)",
      "số báo giá bị giấu tới khi đóng; bảng so sánh bị từ chối tới khi mở thầu",
      "người điều phối mở thầu không đề xuất trao thầu được (J3)",
      "nhân viên mua hàng không có quyền xem giá sau mở thầu",
      "kế toán trưởng duyệt trao thầu và xuất bộ bằng chứng",
    ],
    dungO: "AWARD_APPROVED",
    goi: {
      tieuDe: "Thép tấm, thép tròn và bu lông cho đơn hàng khuôn dập quý IV",
      hang: [
        { hang: "THEP_TAM", soLuong: "20.0000" },
        { hang: "THEP_TRON", soLuong: "40.0000" },
        { hang: "BU_LONG", soLuong: "5000.0000" },
        { hang: "DAY_HAN", soLuong: "262.5000" },
      ],
      nganSach: "360000000.00",
      hanNopPhut: 3 * 24 * 60,
    },
    vai: {
      tao: "nv",
      duyetGoi: ["tp"],
      mo: "tp",
      moi: "nv",
      dong: "tp",
      xinMo: "tp",
      duyetMo: ["gd"],
      dieuPhoi: "tp",
      cham: "cv",
      deXuat: "pp",
      duyetTraoThau: "ktt",
      xuatBangChung: "ktt",
    },
    moi: [{ ncc: "S1" }, { ncc: "S2" }, { ncc: "S3" }, { ncc: "S4" }],
    baoGia: [
      { ncc: "S1", heSo: 970 },
      { ncc: "S2", heSo: 1020 },
      { ncc: "S3", heSo: 990 },
      { ncc: "S4", heSo: 1050 },
    ],
    lyDoDong: "Đã đủ bốn báo giá; xưởng khuôn cần chốt vật tư trước ngày 30/10",
    lyDoMo: "Đóng thầu, mở giá để chấm theo tổng chi phí",
    lyDoDeXuat: "Tổng giá thấp nhất, cam kết giao trong 10 ngày",
    kiem: { muTruocMo: true, tuDuyetMo: true, j3: true, khongXem: "nv", tuDuyetTraoThau: true },
  },
  {
    ma: "SX-02",
    toChuc: "SX",
    ten: "Vật tư tiêu hao xưởng gia công — nhà cung cấp sửa giá trước hạn",
    minhHoa: [
      "nhà cung cấp sửa giá hai lần trước hạn: mỗi lần một phiên bản mới có biên nhận riêng (v1→v3); mở thầu chỉ giải mã bản CUỐI — hai bản cũ vẫn niêm phong, bảng so sánh không có giá cũ nào",
      "giám đốc xin mở thầu rồi tự duyệt ⇒ bị chặn; phó giám đốc duyệt",
      "trưởng phòng đề xuất, phó giám đốc duyệt trao thầu",
    ],
    dungO: "AWARD_APPROVED",
    goi: {
      tieuDe: "Vật tư tiêu hao xưởng gia công tháng 11",
      hang: [
        { hang: "DAU_TL", soLuong: "6.0000" },
        { hang: "MANH_DAO", soLuong: "30.0000" },
        { hang: "DA_MAI", soLuong: "400.0000" },
        { hang: "KHI_AR", soLuong: "50.0000" },
        { hang: "MO_CHIU_NHIET", soLuong: "37.4500" },
      ],
      nganSach: "150000000.00",
      hanNopPhut: 2 * 24 * 60,
    },
    vai: {
      tao: "nv",
      duyetGoi: ["pp"],
      mo: "pp",
      moi: "nv",
      dong: "pp",
      xinMo: "gd",
      duyetMo: ["pgd"],
      dieuPhoi: "gd",
      cham: "cv",
      deXuat: "tp",
      duyetTraoThau: "pgd",
      xuatBangChung: "pgd",
    },
    moi: [{ ncc: "S2" }, { ncc: "S5" }, { ncc: "S6" }],
    baoGia: [
      { ncc: "S2", heSo: 1000 },
      { ncc: "S5", heSo: 1060, suaLai: [1010, 960] },
      { ncc: "S6", heSo: 985 },
    ],
    lyDoDong: "Ba nhà cung cấp đã nộp; tồn kho dầu thuỷ lực chỉ còn đủ hai tuần",
    lyDoMo: "Mở giá để chọn nhà cung cấp tiêu hao tháng 11",
    lyDoDeXuat: "Giá cuối thấp nhất sau khi nhà cung cấp điều chỉnh",
    kiem: { tuDuyetMo: true, muTruocMo: true },
  },
  {
    ma: "SX-03",
    toChuc: "SX",
    ten: "Gói lớn trên ngưỡng — phê duyệt kép và một vòng BAFO",
    minhHoa: [
      "gói vượt ngưỡng 500 triệu: HAI chữ ký của hai người khác người tạo; người tạo tự duyệt ⇒ 422 (D2)",
      "mở thầu cần hai giám đốc",
      "vòng BAFO: danh sách mời SUY từ thứ hạng; người ngoài top-2 nộp ⇒ 422",
      "giá vòng hai niêm phong lại và chỉ mở qua cổng bốn vế lần hai",
      "người tạo gói đề xuất trao thầu ⇒ 422 (J3)",
      "phó giám đốc (GIỮ quyền duyệt trao thầu) đề xuất rồi tự duyệt ⇒ 422 (J3 vế 1); giám đốc duyệt",
    ],
    dungO: "AWARD_APPROVED",
    goi: {
      tieuDe: "Thép tấm, thép tròn và sơn cho dự án khuôn dập ô tô KD-27",
      hang: [
        { hang: "THEP_TAM", soLuong: "60.0000" },
        { hang: "THEP_TRON", soLuong: "100.0000" },
        { hang: "SON_EPOXY", soLuong: "40.0000" },
        { hang: "DAY_HAN", soLuong: "418.7500" },
      ],
      nganSach: "1050000000.00",
      hanNopPhut: 5 * 24 * 60,
    },
    vai: {
      tao: "tp",
      duyetGoi: ["pp", "cv"],
      mo: "tp",
      moi: "tp",
      dong: "tp",
      xinMo: "tp",
      duyetMo: ["gd", "pgd"],
      dieuPhoi: "tp",
      cham: "cv",
      moBafo: "tp",
      deXuat: "pgd",
      duyetTraoThau: "gd",
      xuatBangChung: "gd",
    },
    moi: [{ ncc: "S1" }, { ncc: "S2" }, { ncc: "S3" }, { ncc: "S4" }, { ncc: "S5" }],
    baoGia: [
      { ncc: "S1", heSo: 985 },
      { ncc: "S2", heSo: 1030 },
      { ncc: "S3", heSo: 995 },
      { ncc: "S4", heSo: 1045 },
      { ncc: "S5", heSo: 1075 },
    ],
    lyDoDong: "Năm nhà cung cấp đã nộp; hội đồng họp chấm ngày 28/10",
    lyDoMo: "Mở giá vòng một để xếp hạng và mời BAFO",
    bafo: { heSoTheoHang: [965, 950] },
    lyDoDeXuat: "Giá BAFO thấp nhất, đạt yêu cầu kỹ thuật và tiến độ",
    kiem: { tuDuyetGoi: true, j3: true, tuDuyetTraoThau: true },
  },
  {
    ma: "SX-04",
    toChuc: "SX",
    ten: "Gói đang mở — hai nhà cung cấp còn lại nộp trực tiếp khi trình diễn",
    minhHoa: [
      "gói ĐANG MỞ, hạn nộp còn ba ngày: hai báo giá đã niêm phong, số báo giá vẫn bị giấu",
      "hai lời mời chưa dùng để lại cho người trình diễn mở trên trình duyệt và nộp trực tiếp",
    ],
    dungO: "OPEN",
    goi: {
      tieuDe: "Vòng bi và bu lông bảo trì dây chuyền dập",
      hang: [
        { hang: "VONG_BI", soLuong: "800.0000" },
        { hang: "BU_LONG", soLuong: "3000.0000" },
        { hang: "MO_CHIU_NHIET", soLuong: "12.3500" },
      ],
      nganSach: "60000000.00",
      hanNopPhut: 3 * 24 * 60,
    },
    vai: { tao: "nv", duyetGoi: ["cv"], mo: "tp", moi: "nv" },
    moi: [{ ncc: "S1" }, { ncc: "S3" }, { ncc: "S4" }, { ncc: "S6" }],
    baoGia: [
      { ncc: "S1", heSo: 1010 },
      { ncc: "S3", heSo: 975 },
    ],
    kiem: { muTruocMo: true },
  },
  {
    ma: "SX-05",
    toChuc: "SX",
    ten: "Gói bị huỷ vì nhu cầu thay đổi",
    minhHoa: [
      "gói đã mở, đã có một báo giá, rồi bị huỷ có lý do",
      "sau khi huỷ, trang nộp thầu không còn khoá công khai nào của gói",
      "nhà cung cấp đã nộp, giữ khoá cũ, niêm phong bản sửa giá hợp lệ rồi nộp ⇒ bị từ chối vì trạng thái gói",
    ],
    dungO: "CANCELLED",
    goi: {
      tieuDe: "Khí Argon và dây hàn cho line hàn robot mới",
      hang: [
        { hang: "KHI_AR", soLuong: "80.0000" },
        { hang: "DAY_HAN", soLuong: "55.2500" },
      ],
      nganSach: "55000000.00",
      hanNopPhut: 2 * 24 * 60,
    },
    vai: { tao: "nv", duyetGoi: ["pp"], mo: "tp", moi: "nv", huyGoi: "tp" },
    moi: [{ ncc: "S6" }, { ncc: "S2" }],
    baoGia: [{ ncc: "S6", heSo: 990 }],
    lyDoHuyGoi: "Khách hàng hoãn đơn hàng robot hàn; dời mua sắm sang quý I năm sau",
    kiem: { nopSauHuy: "S6" },
  },
  {
    ma: "SX-06",
    toChuc: "SX",
    ten: "Hạn nộp thật — nộp trễ bị từ chối, đóng đúng hạn",
    cham: true,
    minhHoa: [
      "hạn nộp 62 phút: bộ giả lập ĐỢI hạn thật trôi qua rồi mới đóng — không đóng sớm",
      "nhà cung cấp nộp báo giá niêm phong hợp lệ sau hạn ⇒ 422, và lần từ chối để lại ĐÚNG một hàng sổ `BID_DEADLINE_DENIED` (kiểm theo hành động)",
    ],
    dungO: "AWARD_APPROVED",
    goi: {
      tieuDe: "Đá mài và sơn lót cho xưởng hoàn thiện",
      hang: [
        { hang: "DA_MAI", soLuong: "600.0000" },
        { hang: "SON_EPOXY", soLuong: "10.0000" },
        { hang: "MO_CHIU_NHIET", soLuong: "8.6500" },
      ],
      nganSach: "55000000.00",
      hanNopPhut: 62,
    },
    vai: {
      tao: "nv",
      duyetGoi: ["cv"],
      mo: "tp",
      moi: "nv",
      dong: "tp",
      xinMo: "tp",
      duyetMo: ["gd"],
      dieuPhoi: "tp",
      cham: "cv",
      deXuat: "pp",
      duyetTraoThau: "ktt",
      xuatBangChung: "ktt",
    },
    moi: [{ ncc: "S2" }, { ncc: "S4" }, { ncc: "S5" }],
    baoGia: [
      { ncc: "S2", heSo: 1005 },
      { ncc: "S4", heSo: 980 },
      { ncc: "S5", heSo: 940, treHan: true },
    ],
    lyDoDong: "Đã quá hạn nộp",
    lyDoMo: "Mở giá sau hạn nộp",
    lyDoDeXuat: "Giá thấp nhất trong các báo giá nộp đúng hạn",
    kiem: {},
  },
  {
    ma: "XD-01",
    toChuc: "XD",
    ten: "Xi măng và thép cho nhà xưởng KCN — gia hạn, huỷ trao thầu, trao lại",
    minhHoa: [
      "gói 2,3 tỷ vượt ngưỡng 2 tỷ: hai chữ ký duyệt gói, hai giám đốc duyệt mở thầu",
      "gia hạn hạn nộp có lý do: mỗi nhà cung cấp được mời nhận một thông báo hạn mới",
      "trao thầu cho hạng 1 bị kế toán trưởng HUỶ có lý do ⇒ gói về EVALUATING ⇒ trao lại cho hạng 2",
    ],
    dungO: "AWARD_APPROVED",
    goi: {
      tieuDe: "Xi măng và thép cho nhà xưởng KCN Phúc Điền — hạng mục móng",
      hang: [
        { hang: "XI_MANG", soLuong: "400.0000" },
        { hang: "THEP_D20", soLuong: "80.4500" },
        { hang: "THEP_CUON", soLuong: "30.2750" },
      ],
      nganSach: "2350000000.00",
      hanNopPhut: 4 * 24 * 60,
    },
    vai: {
      tao: "nv",
      duyetGoi: ["pp", "cv"],
      mo: "tp",
      moi: "nv",
      giaHan: "tp",
      dong: "tp",
      xinMo: "tp",
      duyetMo: ["gd", "pgd"],
      dieuPhoi: "tp",
      cham: "pp",
      deXuat: "pp",
      huyTraoThau: "ktt",
      deXuatLai: "cv",
      duyetTraoThau: "gd",
      xuatBangChung: "ktt",
    },
    moi: [{ ncc: "X1" }, { ncc: "X2" }, { ncc: "X3" }, { ncc: "X4" }],
    baoGia: [
      { ncc: "X1", heSo: 995 },
      { ncc: "X2", heSo: 1025, suaLai: [975] },
      { ncc: "X3", heSo: 1040, sauGiaHan: true },
      { ncc: "X4", heSo: 1010, sauGiaHan: true },
    ],
    giaHan: { themPhut: 2 * 24 * 60, lyDo: "Hai nhà cung cấp đề nghị thêm thời gian khảo sát bãi tập kết tại công trường" },
    lyDoDong: "Bốn nhà cung cấp đã nộp sau gia hạn; hội đồng chấm họp ngày 02/11",
    lyDoMo: "Mở giá gói xi măng và thép hạng mục móng",
    lyDoDeXuat: "Tổng giá thấp nhất",
    huyTraoThau: {
      lyDo: "Nhà cung cấp hạng 1 xác nhận bằng văn bản không đáp ứng tiến độ giao 400 tấn trong 3 tuần",
      hangMoi: 2,
      lyDoDeXuatLai: "Hạng 2, cam kết tiến độ giao theo từng đợt đổ bê tông",
    },
    kiem: { muTruocMo: true, tuDuyetTraoThau: true },
  },
  {
    ma: "XD-02",
    toChuc: "XD",
    ten: "Cát, đá cho trạm trộn — thu hồi lời mời gửi nhầm người",
    minhHoa: [
      "lời mời gửi nhầm cho kế toán công nợ của nhà cung cấp ⇒ thu hồi; đường link đã thu hồi không mở được",
      "mời lại đúng người phụ trách báo giá",
      "một nhà cung cấp sửa giá hai lần (ba phiên bản)",
    ],
    dungO: "AWARD_APPROVED",
    goi: {
      tieuDe: "Cát vàng và đá 1x2 cho trạm trộn công trường Phúc Điền",
      hang: [
        { hang: "CAT_VANG", soLuong: "1487.5000" },
        { hang: "DA_12", soLuong: "1216.2500" },
      ],
      nganSach: "1100000000.00",
      hanNopPhut: 3 * 24 * 60,
    },
    vai: {
      tao: "nv",
      duyetGoi: ["tp"],
      mo: "tp",
      moi: "nv",
      dong: "tp",
      xinMo: "tp",
      duyetMo: ["pgd"],
      dieuPhoi: "tp",
      cham: "cv",
      deXuat: "pp",
      duyetTraoThau: "ktt",
      xuatBangChung: "ktt",
    },
    thuHoi: { ncc: "X4", lienHeSai: "kt" },
    moi: [{ ncc: "X1" }, { ncc: "X4", lienHe: "kd" }, { ncc: "X6" }],
    baoGia: [
      { ncc: "X1", heSo: 1015 },
      { ncc: "X4", heSo: 990 },
      { ncc: "X6", heSo: 1070, suaLai: [1030, 985] },
    ],
    lyDoDong: "Ba nhà cung cấp đã nộp; trạm trộn cần cát đá từ tuần sau",
    lyDoMo: "Mở giá cát đá trạm trộn",
    lyDoDeXuat: "Giá thấp nhất, mỏ đá cách công trường 18 km",
    kiem: {},
  },
  {
    ma: "XD-03",
    toChuc: "XD",
    ten: "Bê tông M300 — chờ giám đốc thứ hai duyệt mở thầu",
    minhHoa: [
      "gói 2,5 tỷ đã đóng, yêu cầu mở thầu đã có MỘT trên HAI chữ ký giám đốc",
      "người trình diễn đăng nhập bằng Phó Tổng Giám đốc để ký chữ ký thứ hai, rồi trưởng phòng điều phối",
    ],
    dungO: "UNSEAL_PENDING",
    goi: {
      tieuDe: "Bê tông thương phẩm M300 cho sàn nhà xưởng số 2",
      hang: [{ hang: "BT_M300", soLuong: "1985.5000" }],
      nganSach: "2500000000.00",
      hanNopPhut: 3 * 24 * 60,
    },
    vai: {
      tao: "nv",
      duyetGoi: ["pp", "cv"],
      mo: "tp",
      moi: "nv",
      dong: "tp",
      xinMo: "tp",
      duyetMo: ["gd"],
    },
    moi: [{ ncc: "X3" }, { ncc: "X1" }, { ncc: "X5" }],
    baoGia: [
      { ncc: "X3", heSo: 985 },
      { ncc: "X1", heSo: 1020 },
      { ncc: "X5", heSo: 1045 },
    ],
    lyDoDong: "Ba nhà cung cấp đã nộp; lịch đổ sàn nhà xưởng số 2 đã chốt",
    lyDoMo: "Mở giá bê tông M300",
    kiem: {},
  },
  {
    ma: "XD-04",
    toChuc: "XD",
    ten: "Cốp pha và giàn giáo — đề xuất trao thầu chờ Tổng Giám đốc duyệt",
    minhHoa: [
      "gói đã chấm, trao thầu đã được ĐỀ XUẤT, chưa ai duyệt",
      "người trình diễn đăng nhập bằng Tổng Giám đốc để duyệt, rồi xuất bộ bằng chứng",
    ],
    dungO: "AWARD_PROPOSED",
    goi: {
      tieuDe: "Cốp pha phủ phim và thuê giàn giáo cho khung nhà xưởng",
      hang: [
        { hang: "COP_PHA", soLuong: "2500.0000" },
        { hang: "GIAN_GIAO", soLuong: "600.0000" },
        { hang: "DAU_CHONG_DINH", soLuong: "385.5000" },
      ],
      nganSach: "900000000.00",
      hanNopPhut: 3 * 24 * 60,
    },
    vai: {
      tao: "nv",
      duyetGoi: ["cv"],
      mo: "tp",
      moi: "nv",
      dong: "tp",
      xinMo: "tp",
      duyetMo: ["gd"],
      dieuPhoi: "tp",
      cham: "pp",
      deXuat: "pp",
    },
    moi: [{ ncc: "X5" }, { ncc: "X1" }, { ncc: "X3" }],
    baoGia: [
      { ncc: "X5", heSo: 960 },
      { ncc: "X1", heSo: 1030 },
      { ncc: "X3", heSo: 1005 },
    ],
    lyDoDong: "Ba nhà cung cấp đã nộp",
    lyDoMo: "Mở giá cốp pha và giàn giáo",
    lyDoDeXuat: "Giá thấp nhất, có sẵn kho tại Bắc Ninh",
    kiem: {},
  },
  {
    ma: "XD-05",
    toChuc: "XD",
    ten: "Ống HDPE thoát nước — chờ chữ ký duyệt gói thứ hai",
    minhHoa: [
      "gói 2,2 tỷ vượt ngưỡng: đã có MỘT trên HAI chữ ký duyệt gói",
      "người trình diễn đăng nhập bằng trưởng phòng mua hàng để ký chữ ký thứ hai, rồi mở gói",
    ],
    dungO: "PENDING_APPROVAL",
    goi: {
      tieuDe: "Ống HDPE D110 cho tuyến thoát nước mưa nội bộ KCN",
      hang: [{ hang: "ONG_HDPE", soLuong: "11950.2500" }],
      nganSach: "2200000000.00",
      hanNopPhut: 5 * 24 * 60,
    },
    vai: { tao: "nv", duyetGoi: ["pp"] },
    moi: [],
    baoGia: [],
    kiem: {},
  },
];

// ----------------------------------------------------------------------------------------------
// Giá chào: tính TRƯỚC, bằng số nguyên — bộ chạy so bảng so sánh với đúng các con số này
// ----------------------------------------------------------------------------------------------

export interface DongGia {
  readonly lineNo: number;
  readonly unitPrice: string;
  readonly amount: string;
}

export interface GiaChao {
  readonly lines: readonly DongGia[];
  readonly totalAmount: string;
}

/** Giá chào của MỘT phiên bản: mỗi dòng đơn giá thị trường × hệ số, cộng lại thành tổng. */
export function giaChao(hs: HoSoToChuc, kb: KichBan, heSo: number): GiaChao {
  const lines = kb.goi.hang.map((d, i) => {
    const hh = hangHoaTheoMa(hs, d.hang);
    const unitPrice = donGiaChao(hh.donGiaThiTruong, heSo);
    return { lineNo: i + 1, unitPrice, amount: thanhTien(d.soLuong, unitPrice) };
  });
  return { lines, totalAmount: congTien(lines.map((l) => l.amount)) };
}

/** Giá có hiệu lực (phiên bản cuối, không tính lần nộp trễ) của mỗi nhà cung cấp ở vòng một. */
export function giaVongMot(hs: HoSoToChuc, kb: KichBan): ReadonlyMap<string, string> {
  const ra = new Map<string, string>();
  for (const bg of kb.baoGia) {
    if (bg.treHan === true) continue;
    const cuoi = bg.suaLai?.at(-1) ?? bg.heSo;
    ra.set(bg.ncc, giaChao(hs, kb, cuoi).totalAmount);
  }
  return ra;
}

/** Nhà cung cấp theo thứ hạng giá tăng dần (hạng 1 trước). */
export function xepHang(gia: ReadonlyMap<string, string>): readonly string[] {
  return [...gia.entries()].sort((a, b) => soSanhTien(a[1], b[1])).map(([ncc]) => ncc);
}

export function canHaiChuKy(hs: HoSoToChuc, kb: KichBan): boolean {
  return soSanhTien(kb.goi.nganSach, hs.nguongKep) >= 0;
}

// ----------------------------------------------------------------------------------------------
// Kiểm danh mục TRƯỚC KHI CHẠY
// ----------------------------------------------------------------------------------------------

const THU_TU_DUNG: readonly DungO[] = ["PENDING_APPROVAL", "OPEN", "UNSEAL_PENDING", "AWARD_PROPOSED", "AWARD_APPROVED"];

function toi(kb: KichBan, moc: DungO): boolean {
  if (kb.dungO === "CANCELLED") return moc === "PENDING_APPROVAL" || moc === "OPEN";
  return THU_TU_DUNG.indexOf(kb.dungO) >= THU_TU_DUNG.indexOf(moc);
}

/** Mọi vi phạm của một kịch bản với chính hồ sơ của nó — rỗng nghĩa là danh mục chạy được. */
export function kiemKichBan(kb: KichBan): readonly string[] {
  const loi: string[] = [];
  const hs = hoSo(kb.toChuc);
  const vai = (ma: string | undefined, quyen: Quyen, buoc: string): string | undefined => {
    if (ma === undefined) {
      loi.push(`${kb.ma}: thiếu người cho bước "${buoc}"`);
      return undefined;
    }
    let n;
    try {
      n = nguoiTheoMa(hs, ma);
    } catch (e) {
      loi.push(`${kb.ma}: ${(e as Error).message}`);
      return undefined;
    }
    if (!coQuyen(n.vai, quyen)) loi.push(`${kb.ma}: "${ma}" (${n.vai}) không có ${quyen} cho bước "${buoc}"`);
    return ma;
  };
  const coMat = <T>(f: () => T): T | undefined => {
    try {
      return f();
    } catch (e) {
      loi.push(`${kb.ma}: ${(e as Error).message}`);
      return undefined;
    }
  };

  for (const d of kb.goi.hang) coMat(() => hangHoaTheoMa(hs, d.hang));
  if (kb.goi.hang.length === 0 && kb.dungO !== "PENDING_APPROVAL") loi.push(`${kb.ma}: gói không có hạng mục thì không mở được`);
  if (kb.goi.hanNopPhut < 62) loi.push(`${kb.ma}: hạn nộp dưới 62 phút — sàn CUA_SO_TOI_THIEU là 1 giờ tại lúc mở`);
  if (kb.cham !== true && kb.goi.hanNopPhut < 24 * 60) loi.push(`${kb.ma}: kịch bản nhanh cần hạn nộp ≥ 1 ngày để không trôi qua trong lúc chạy`);

  const hai = canHaiChuKy(hs, kb);
  const soChuKy = hai ? 2 : 1;
  const tao = vai(kb.vai.tao, "rfq.create", "tạo gói");
  const duyet = kb.vai.duyetGoi.map((m) => vai(m, "rfq.approve", "duyệt gói"));
  if (duyet.includes(tao)) loi.push(`${kb.ma}: người tạo nằm trong danh sách duyệt gói (D2)`);
  if (new Set(kb.vai.duyetGoi).size !== kb.vai.duyetGoi.length) loi.push(`${kb.ma}: một người duyệt gói hai lần`);
  if (kb.dungO === "PENDING_APPROVAL") {
    if (kb.vai.duyetGoi.length >= soChuKy) loi.push(`${kb.ma}: dừng ở PENDING_APPROVAL nhưng đủ ${soChuKy} chữ ký`);
  } else if (kb.vai.duyetGoi.length !== soChuKy) {
    loi.push(`${kb.ma}: gói cần ${soChuKy} chữ ký duyệt, danh mục khai ${kb.vai.duyetGoi.length}`);
  }
  if (kb.kiem.tuDuyetGoi === true) {
    const n = coMat(() => nguoiTheoMa(hs, kb.vai.tao));
    if (n !== undefined && !coQuyen(n.vai, "rfq.approve")) loi.push(`${kb.ma}: kiểm tự duyệt gói cần người tạo có rfq.approve, nếu không lần thử chỉ đo 403`);
  }

  if (toi(kb, "OPEN")) {
    vai(kb.vai.mo, "rfq.open", "mở gói");
    vai(kb.vai.moi, "rfq.invite", "mời");
    for (const m of kb.moi) {
      const ncc = coMat(() => nhaCungCapTheoMa(hs, m.ncc));
      if (ncc !== undefined && m.lienHe !== undefined && !ncc.lienHe.some((l) => l.ma === m.lienHe)) {
        loi.push(`${kb.ma}: ${m.ncc} không có liên hệ "${m.lienHe}"`);
      }
    }
    if (kb.thuHoi !== undefined) {
      const ncc = coMat(() => nhaCungCapTheoMa(hs, kb.thuHoi?.ncc ?? ""));
      if (ncc !== undefined && !ncc.lienHe.some((l) => l.ma === kb.thuHoi?.lienHeSai)) loi.push(`${kb.ma}: liên hệ nhầm không tồn tại`);
      if (!kb.moi.some((m) => m.ncc === kb.thuHoi?.ncc)) loi.push(`${kb.ma}: thu hồi một nhà cung cấp không được mời lại`);
    }
    const duocMoi = new Set(kb.moi.map((m) => m.ncc));
    if (duocMoi.size !== kb.moi.length) loi.push(`${kb.ma}: một nhà cung cấp được mời hai lần`);
    for (const bg of kb.baoGia) {
      if (!duocMoi.has(bg.ncc)) loi.push(`${kb.ma}: ${bg.ncc} báo giá mà không được mời`);
      if (bg.treHan === true && kb.cham !== true) loi.push(`${kb.ma}: nộp trễ chỉ có nghĩa ở chế độ chậm`);
    }
    if (kb.giaHan !== undefined) vai(kb.vai.giaHan, "rfq.open", "gia hạn");
  }
  if (kb.dungO === "CANCELLED") {
    vai(kb.vai.huyGoi, "rfq.cancel", "huỷ gói");
    if (kb.lyDoHuyGoi === undefined) loi.push(`${kb.ma}: huỷ gói cần lý do`);
    if (kb.kiem.nopSauHuy !== undefined && !kb.baoGia.some((b) => b.ncc === kb.kiem.nopSauHuy)) {
      // Người ĐÃ nộp chắc chắn đã đọc khoá công khai lúc gói còn mở; người chưa từng mở trang thì sau
      // huỷ không còn khoá nào để đọc. Lớp CHẶN lần nộp là nhánh C1 của trigger trạng thái, không phải
      // việc thu hồi khoá — `submitBid` không đối chiếu phong bì với khoá nào.
      loi.push(`${kb.ma}: nhà cung cấp thử nộp sau huỷ phải là người ĐÃ nộp — người chắc chắn đã giữ khoá công khai của gói`);
    }
  }
  if (kb.dungO === "OPEN" && kb.baoGia.length >= kb.moi.length) loi.push(`${kb.ma}: gói để mở cho trình diễn phải còn lời mời chưa nộp`);

  if (toi(kb, "UNSEAL_PENDING")) {
    const soNop = new Set(kb.baoGia.filter((b) => b.treHan !== true).map((b) => b.ncc)).size;
    if (soNop < 2) loi.push(`${kb.ma}: cần ít nhất hai báo giá đúng hạn để có bảng so sánh`);
    vai(kb.vai.dong, "rfq.open", "đóng gói");
    if (kb.cham !== true && kb.lyDoDong === undefined) loi.push(`${kb.ma}: đóng sớm cần lý do`);
    const xin = vai(kb.vai.xinMo, "rfq.unseal", "xin mở thầu");
    const duyetMo = (kb.vai.duyetMo ?? []).map((m) => vai(m, "rfq.unseal.approve", "duyệt mở thầu"));
    if (duyetMo.includes(xin)) loi.push(`${kb.ma}: người xin mở thầu nằm trong danh sách duyệt mở (D2)`);
    const canMo = kb.dungO === "UNSEAL_PENDING" ? duyetMo.length < soChuKy : duyetMo.length === soChuKy;
    if (!canMo) loi.push(`${kb.ma}: số chữ ký duyệt mở thầu không khớp ${soChuKy} (dừng ở ${kb.dungO})`);
    if (kb.kiem.tuDuyetMo === true && xin === undefined) loi.push(`${kb.ma}: kiểm tự duyệt mở thầu cần người xin mở`);
  }

  if (toi(kb, "AWARD_PROPOSED")) {
    const dieuPhoi = vai(kb.vai.dieuPhoi, "rfq.unseal", "điều phối mở thầu");
    vai(kb.vai.cham, "evaluation.perform", "chấm");
    const deXuat = vai(kb.vai.deXuat, "award.recommend", "đề xuất trao thầu");
    if (deXuat !== undefined && (deXuat === tao || deXuat === dieuPhoi)) {
      loi.push(`${kb.ma}: người đề xuất trao thầu là người tạo gói hay người điều phối (J3)`);
    }
    if (kb.lyDoDeXuat === undefined) loi.push(`${kb.ma}: đề xuất trao thầu cần lý do`);
    if (kb.kiem.j3 === true) {
      const thu = coMat(() => nguoiTheoMa(hs, kb.vai.tao));
      const thuDieuPhoi = dieuPhoi === undefined ? undefined : coMat(() => nguoiTheoMa(hs, dieuPhoi));
      const coTheThu = (thu !== undefined && coQuyen(thu.vai, "award.recommend")) || (thuDieuPhoi !== undefined && coQuyen(thuDieuPhoi.vai, "award.recommend"));
      if (!coTheThu) loi.push(`${kb.ma}: kiểm J3 cần người tạo hay người điều phối có award.recommend`);
    }
    if (kb.bafo !== undefined) {
      vai(kb.vai.moBafo, "rfq.bafo.open", "mở vòng BAFO");
      if (kb.bafo.heSoTheoHang.length !== hs.bafoTopN) loi.push(`${kb.ma}: BAFO khai ${kb.bafo.heSoTheoHang.length} hệ số, chính sách top-${hs.bafoTopN}`);
    }
    if (kb.huyTraoThau !== undefined) {
      vai(kb.vai.huyTraoThau, "po.approve", "huỷ trao thầu");
      const lai = vai(kb.vai.deXuatLai, "award.recommend", "đề xuất lại");
      if (lai !== undefined && (lai === tao || lai === dieuPhoi)) loi.push(`${kb.ma}: người đề xuất lại vi phạm J3`);
      const gia = giaVongMot(hs, kb);
      if (kb.huyTraoThau.hangMoi < 2 || kb.huyTraoThau.hangMoi > gia.size) loi.push(`${kb.ma}: hạng trao lại ngoài bảng xếp hạng`);
    }
  }

  if (toi(kb, "AWARD_APPROVED")) {
    const duyetTT = vai(kb.vai.duyetTraoThau, "po.approve", "duyệt trao thầu");
    const deXuatCuoi = kb.huyTraoThau !== undefined ? kb.vai.deXuatLai : kb.vai.deXuat;
    if (duyetTT !== undefined && duyetTT === deXuatCuoi) loi.push(`${kb.ma}: người duyệt trao thầu là người đề xuất`);
    vai(kb.vai.xuatBangChung, "audit.read", "xuất bộ bằng chứng");
    vai(kb.vai.xuatBangChung, "bid.view", "xuất bộ bằng chứng");
    if (kb.kiem.tuDuyetTraoThau === true) coMat(() => nguoiTheoMa(hs, deXuatCuoi ?? ""));
  }
  if (kb.kiem.khongXem !== undefined) {
    const n = coMat(() => nguoiTheoMa(hs, kb.kiem.khongXem ?? ""));
    if (n !== undefined && coQuyen(n.vai, "bid.view")) loi.push(`${kb.ma}: "${kb.kiem.khongXem}" có bid.view — lần thử không đo gì`);
  }

  // Giá phải phân biệt được: bảng xếp hạng có một thứ tự DUY NHẤT thì mới so được với nó.
  const gia = giaVongMot(hs, kb);
  if (new Set(gia.values()).size !== gia.size) loi.push(`${kb.ma}: hai nhà cung cấp cùng tổng giá — thứ hạng không xác định`);
  return loi;
}

export function kiemDanhMuc(ds: readonly KichBan[] = DANH_MUC): readonly string[] {
  const loi: string[] = [];
  const ma = new Set<string>();
  for (const kb of ds) {
    if (ma.has(kb.ma)) loi.push(`mã kịch bản trùng: ${kb.ma}`);
    ma.add(kb.ma);
    loi.push(...kiemKichBan(kb));
  }
  return loi;
}
