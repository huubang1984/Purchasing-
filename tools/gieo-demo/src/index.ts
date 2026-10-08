// ==============================================================================================
// tools/gieo-demo — GIEO MỘT VÒNG THẦU ĐỦ ĐỂ DEMO, RỒI IN RA SÁU ĐƯỜNG LINK
//
//   pnpm gieo:demo          tổ chức CHƯA bật S3 — luồng MVP1, hình dạng mà pilot chạy
//   pnpm gieo:demo --s3     [S1.174 / S3.1d] tổ chức ĐÃ BẬT S3, đủ bảng vai §7 của spec S3
//
// [ADR-044] Vì sao có công cụ này thay vì làm mọi thứ qua giao diện: tạo một RFQ đầy đủ là bảy
// màn hình (tổ chức, chính sách, người dùng, nhà cung cấp, người liên hệ, gói thầu, hạng mục,
// duyệt, mời) và **không màn nào trong số đó chạm một USP nào**. Lát cắt demo đặt giao diện đúng
// ở hai chỗ sản phẩm này khác phần còn lại của thị trường — niêm phong ở máy nhà cung cấp, và mở
// thầu hai người duyệt — còn phần dựng bối cảnh thì gieo bằng script.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO NÓ DỰNG `pg.Pool` THẲNG THAY VÌ GỌI `createPool`, VÀ VÌ SAO ĐÓ LÀ MỘT QUYẾT ĐỊNH
// ----------------------------------------------------------------------------------------------
// `createPool` đòi một `role` và gắn nó vào MỌI client (`ganVaiTroChoPool`). Công cụ này không
// dùng được vai ứng dụng: đo trên cụm thật, `app_api` **không có INSERT** trên `organizations`~~,
// `users`, `user_roles` hay `sessions`~~ — và đúng ra là không được có. **[Đo lại ngày 2026-09-27
// sau 73 migration]** Trên `users`, `user_roles` và `sessions` nó CÓ INSERT theo cột (`002`, `005`);
// chỉ `organizations` là không có quyền INSERT nào, và thế đã đủ để script phải dùng kết nối
// đặc quyền. Một script gieo tenant là
// việc của một kết nối ĐẶC QUYỀN theo định nghĩa: nó tạo ra chính cái tenant mà mọi lớp cô lập
// sau đó nói về.
//
// Nên nó dựng `pg.Pool` thẳng, và chỗ ấy được KHAI kèm lý do ở
// `tests/architecture/duong-sql-ngoai-with-tenant.test.ts` — cùng cơ chế mà
// `packages/test-support/src/postgres.ts` dùng cho pool superuser của cụm thử. Khai chứ không
// miễn: một chỗ mới dựng pool là một quyết định, và cổng bắt người viết nói ra nó.
//
// Phần CÓ tenant thì vẫn đi đúng đường sản phẩm: `withTenant` đặt GUC, còn `createInvitation`,
// `issueMagicLinkToken`, `issueRfqKeyPair`, `issueLoginToken` là hàm thật của các gói — và với `--s3`, `ducTokenKhiMoGoi`,
// `danhDauDaGui` của luồng mời S3 (S3.2b2).
//
// ----------------------------------------------------------------------------------------------
// CÔNG CỤ NÀY KHÔNG PHẢI MỘT ĐƯỜNG SẢN XUẤT, và nó tự chặn mình bằng ba điều:
//   ⑴ nó đòi một biến môi trường RIÊNG (`TRUSTPROCURE_SEED_DATABASE_URL`) chứ không mượn biến của
//      `apps/api` — một người vận hành phải CỐ Ý trỏ nó vào một cụm;
//   ⑵ nó in ra token dạng rõ ra màn hình, nên nó không bao giờ được chạy ở nơi log bị thu thập;
//   ⑶ nó không xoá gì, không sửa gì có sẵn — chỉ thêm một tổ chức mới mỗi lần chạy.
//
// Mọi câu SQL ở đây ghim đủ bốn trục của QT3 ([INV-H21]): tên bảng đủ lược đồ, tên hàm
// `pg_catalog.`, toán tử `OPERATOR(pg_catalog.…)`. Một script chạy dưới kết nối đặc quyền là chỗ
// một `search_path` độc đắt nhất, nên nó là chỗ CUỐI CÙNG đáng được miễn.
//
// Và biểu thức `now() + interval` được viết NỘI TUYẾN ở cả hai chỗ thay vì rút thành một hằng
// rồi nội suy: `tests/architecture/qt3-cu-phap.int.test.ts` PREPARE từng câu trên Postgres thật,
// và bộ đọc tĩnh của nó thay mỗi chỗ nội suy bằng một số nguyên — nên câu nó kiểm sẽ KHÁC câu
// chạy thật, và nó đỏ đúng như thế ở lượt CI thứ hai của vòng này. Một hằng dùng chung trông gọn
// hơn; một câu mà cổng đọc được ĐÚNG NHƯ NÓ CHẠY thì đáng hơn.
// ==============================================================================================

import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ReceiptSigningKeyRing, createLocalDevReceiptSigner, type ReceiptKeyPair, type ReceiptSigner } from "@trustprocure/bidding";
import { createLocalDevOrgKeyProvisioner, MasterKeyRing } from "@trustprocure/crypto-keys";
import { migrate } from "@trustprocure/db";
import { NHOM_BENCHMARK_MAU, chuanHoaSauNop, khaiBiDanhHang, khaiQuyDoiRieng, nhapDuLieuNgoai, taoHangChuan } from "@trustprocure/du-lieu-nen";
import { issueLoginToken } from "@trustprocure/identity";
import { createInvitation, danhDauDaGui, ducTokenKhiMoGoi, issueMagicLinkToken } from "@trustprocure/invitation";
import {
  addRfqItem,
  approveRfq,
  createProcurementPolicy,
  createRfq,
  kyPhienBanChinhSach,
  openRfq,
  setRfqBudget,
  submitRfqForApproval,
  taoNhomHang,
} from "@trustprocure/rfq";
import { issueRfqKeyPair } from "@trustprocure/sealed-envelope";
import { docHoSoXacMinh, xacMinhNhaCungCap } from "@trustprocure/supplier";
import { TenantError, ngheLoiKetNoiToiMuon, withTenant } from "@trustprocure/tenancy";
import { BAC_DEMO, BAFO_TOP_N_DEMO, MUC_DEMO, THAM_SO_TCO_DEMO, TRONG_SO_DEMO, TRONG_SO_TCO_DEMO } from "./chinh-sach-demo.js";
import { chayWorkerToiKhiMo, gieoBaGoiDaDieuPhoi, tuChoiKhiCoViecCuaToChucKhac, type NhaCungCapGieo } from "./goi-da-mo.js";
import { SO_NOP, chamGoiTraoThau, gieoGoiTraoThauDenDieuPhoi } from "./goi-trao-thau.js";
import { khaiKhongXungDot } from "./khai-bao.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

class GieoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GieoError";
  }
}

function bat(ten: string): string {
  const v = process.env[ten];
  if (v === undefined || v.trim() === "") throw new GieoError(`${ten}: thiếu`);
  return v.trim();
}

/** Cùng định dạng `<phiên bản>=<base64>,...` với `apps/api/src/cau-hinh.ts`. */
function docVongKhoa(): MasterKeyRing {
  const tho = bat("TRUSTPROCURE_MASTER_KEYS");
  const active = bat("TRUSTPROCURE_MASTER_KEY_ACTIVE");
  const keys: Record<string, Buffer> = {};
  for (const muc of tho.split(",")) {
    const m = muc.trim();
    if (m === "") continue;
    const dau = m.indexOf("=");
    if (dau <= 0) throw new GieoError("TRUSTPROCURE_MASTER_KEYS: mỗi mục phải có dạng <phiên bản>=<base64>");
    const byte = Buffer.from(m.slice(dau + 1).trim(), "base64");
    if (byte.length !== 32) throw new GieoError(`TRUSTPROCURE_MASTER_KEYS: phiên bản "${m.slice(0, dau)}" phải dài 32 byte`);
    keys[m.slice(0, dau).trim()] = byte;
  }
  if (!Object.hasOwn(keys, active)) throw new GieoError("TRUSTPROCURE_MASTER_KEY_ACTIVE: không có trong TRUSTPROCURE_MASTER_KEYS");
  return new MasterKeyRing(active, keys);
}

/**
 * [S1.251 / S4.4b] Bộ ký biên nhận — CÙNG hai biến, cùng định dạng `<kid>=<base64 PKCS8 DER>,...` với `apps/api/src/cau-hinh.ts`:
 * biên nhận của ba gói đã mở (`goi-da-mo.ts`) ký bằng đúng khoá `api` công bố, nên kiểm chứng được như mọi biên nhận khác.
 */
function docBoKyBienNhan(): ReceiptSigner {
  const tho = bat("TRUSTPROCURE_RECEIPT_SIGNING_KEYS");
  const active = bat("TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE");
  const keys: Record<string, ReceiptKeyPair> = {};
  for (const muc of tho.split(",")) {
    const m = muc.trim();
    if (m === "") continue;
    const dau = m.indexOf("=");
    if (dau <= 0) throw new GieoError("TRUSTPROCURE_RECEIPT_SIGNING_KEYS: mỗi mục phải có dạng <kid>=<base64 PKCS8>");
    const der = Buffer.from(m.slice(dau + 1).trim(), "base64");
    let rieng;
    try {
      rieng = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    } catch {
      throw new GieoError(`TRUSTPROCURE_RECEIPT_SIGNING_KEYS: khoá "${m.slice(0, dau).trim()}" không đọc được theo PKCS8 DER`);
    }
    const congKhai = createPublicKey(rieng).export({ format: "der", type: "spki" });
    keys[m.slice(0, dau).trim()] = { privateKey: new Uint8Array(der), publicKey: new Uint8Array(congKhai) };
  }
  if (!Object.hasOwn(keys, active)) throw new GieoError("TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: không có trong TRUSTPROCURE_RECEIPT_SIGNING_KEYS");
  return createLocalDevReceiptSigner(new ReceiptSigningKeyRing(active, keys));
}

const HANG_MUC: readonly { readonly mo: string; readonly sl: string; readonly dvt: string }[] = [
  { mo: "Thep tam SS400 day 10mm", sl: "120.0000", dvt: "tam" },
  { mo: "Thep hop ma kem 50x50", sl: "800.0000", dvt: "cay" },
  { mo: "Bu long neo M24 cap 8.8", sl: "2400.0000", dvt: "bo" },
];

/**
 * [S1.199 / S4.2b] Ba hàng chuẩn cho ba dòng của `HANG_MUC`, ghi bằng hàm gói dưới phiên người quản lý dữ liệu — đúng đường
 * màn `/du-lieu` đi. Mỗi hàng: một bí danh là NGUYÊN mô tả của dòng (để S4.3 ánh xạ được), một quy đổi riêng từ đơn vị đóng gói
 * của dòng về đơn vị gốc.
 *
 * HỆ SỐ LÀ PHÉP TÍNH TỪ KÍCH THƯỚC GHI TRONG THUỘC TÍNH, không phải số đo của một nhà máy (spec S4 §8.6 — *"tham số bịa trông như
 * số đo"*). Công thức nằm ngay dưới, để ai đọc hệ số cũng đọc được nó từ đâu ra; thép 7 850 kg/m³:
 *   · tấm 1 500 × 6 000 × 10 mm: 1,5 × 6 × 0,010 m³ × 7 850 = 706,5 kg;
 *   · hộp 50 × 50 dày 1,4 mm, cây 6 m: tiết diện theo đường trung bình 4 × (50 − 1,4) × 1,4 = 272,16 mm², × 7 850 × 6 m
 *     = 12,818… kg, làm tròn hai chữ số;
 *   · bu lông neo: một bộ là một bu lông kèm hai đai ốc và hai long đen, đơn vị gốc đếm bu lông — 1 bộ = 1 cái.
 */
const HANG_CHUAN_DEMO: readonly {
  readonly ma: string;
  readonly donViGoc: string;
  readonly ten: string;
  readonly thuocTinh: Readonly<Record<string, string>>;
  readonly thuocTinhTrongYeu: readonly string[];
  /**
   * [S1.234 / S4.3b] `null` = hàng KHÔNG có bí danh cho dòng của nó: dòng ấy không tự nối lúc nộp mà nằm ở hàng đợi `/du-lieu`
   * với gợi ý `GOI_Y` (bu lông neo — lõi bản 1 chấm 0,88 cho đúng hàng này), để demo đi được việc duyệt và hàng đợi học.
   */
  readonly biDanh: string | null;
  readonly quyDoi: { readonly tu: string; readonly heSo: string };
}[] = [
  {
    ma: "THEP-TAM-SS400-10",
    donViGoc: "kg",
    ten: "Thép tấm SS400 dày 10 mm, khổ 1500×6000",
    thuocTinh: { mac: "SS400", day_mm: "10", kho_mm: "1500x6000" },
    thuocTinhTrongYeu: ["mac", "day_mm"],
    biDanh: "Thep tam SS400 day 10mm",
    quyDoi: { tu: "tam", heSo: "706.5" },
  },
  {
    ma: "THEP-HOP-MK-50X50-1.4",
    donViGoc: "kg",
    ten: "Thép hộp mạ kẽm 50×50 dày 1,4 mm, cây 6 m",
    thuocTinh: { be_mat: "ma kem", kich_thuoc_mm: "50x50", day_mm: "1.4", dai_cay_m: "6" },
    thuocTinhTrongYeu: ["kich_thuoc_mm", "day_mm"],
    biDanh: "Thep hop ma kem 50x50",
    quyDoi: { tu: "cay", heSo: "12.82" },
  },
  {
    ma: "BU-LONG-NEO-M24-8.8",
    donViGoc: "cai",
    ten: "Bu lông neo M24 cấp bền 8.8",
    thuocTinh: { duong_kinh: "M24", cap_ben: "8.8", bo_gom: "1 bu long, 2 dai oc, 2 long den" },
    thuocTinhTrongYeu: ["duong_kinh", "cap_ben"],
    biDanh: null,
    quyDoi: { tu: "bo", heSo: "1" },
  },
];

const NHA_CUNG_CAP: readonly string[] = ["Thep Dong Anh", "Kim khi Hai Phong", "Vat tu Truong Thanh"];
/**
 * [S1.174 / S3.1d] Gói demo 9 tỷ nằm ở bậc 2 của §4.1, và bậc ấy đòi NĂM nhà cung cấp (K2 — chưa cưỡng chế ở S3.1, nhưng
 * bối cảnh demo khai đúng số mà bậc của chính nó đòi, để lúc K2 có mặt nó không gãy ở bước mời).
 * [S1.266 / S3.3c1] K2 (cưỡng chế từ S3.3c2) đếm nhà cung cấp ĐẾM ĐƯỢC chứ không đếm lời mời: `--s3` dựng cả năm bằng
 * người nhập riêng, có MST, và người tài chính thứ hai xác minh — xem `taoNccVaMoi` trong `chinh`.
 */
const NHA_CUNG_CAP_THEM_S3: readonly string[] = ["Thep Hoa Sen", "Vat lieu Phu My"];

/**
 * [S1.174 / S3.1d] `--s3`: bối cảnh theo bảng vai §7 của spec S3 — thêm HAI người FINANCE vào năm người sẵn có: F1 khai
 * phiên bản chính sách có bậc, F2 ký nó. Chủ dự án chọn ký bằng HÀM GÓI dưới `withTenant`, cùng đường mọi hàm gói khác
 * của công cụ này đi: trigger `chinh_sach_kiem_nguoi_ky` vẫn kiểm đủ luật (khác người khai, giữ `policy.manage`, bản mới
 * nhất, đã tới ngày hiệu lực). Cờ triển khai ADR-105 là cửa của ROUTE ký — đường của màn —, không phải của công cụ này.
 */
const S3 = process.argv.slice(2).includes("--s3");

async function chinh(): Promise<void> {
  const url = bat("TRUSTPROCURE_SEED_DATABASE_URL");
  const vong = docVongKhoa();
  // [S1.251 / S4.4b] Ba gói đã mở đi qua worker THẬT: worker kết nối bằng vai đăng nhập của CHÍNH nó (`app_unseal_login`), không
  // bằng URL đặc quyền của công cụ; biên nhận ký bằng khoá của `api`. Đọc cả ba TRƯỚC khi gieo gì — thiếu thì dừng sớm, không để lại
  // một tổ chức dở dang.
  const urlWorker = bat("TRUSTPROCURE_SEED_WORKER_DATABASE_URL");
  const boKy = docBoKyBienNhan();
  const gocWeb = process.env.TRUSTPROCURE_WEB_BASE?.trim() ?? "http://127.0.0.1:8090";
  const duoi = randomBytes(3).toString("hex");
  // Số điện thoại phải là SỐ: ràng buộc `supplier_contacts_phone_check` của 008 bác đuôi hex, và
  // nó bác ở lượt chạy thứ ba của script này.
  const soDienThoai = String(randomBytes(4).readUInt32BE(0) % 10000000).padStart(7, "0");

  const pool = new pg.Pool({ connectionString: url, max: 4 });
  // [S1.227 / khoản 180] Pool này đi qua `withTenant` (nửa CÓ tenant của script), nên hai tín hiệu mất-không-ai-biết mà
  // cổng `pool-nghe-du-tin-hieu` — nay quét cả `tools/` và thấy cả `new pg.Pool` — đòi phải có người nghe: ⑴ `release`
  // mang `TenantError` SESSION_STATE_LEFT (kết nối bị huỷ vì trạng thái phiên còn sót, không ném cho ai); ⑵ lỗi tới muộn
  // sau trần `maxConnectWaitMs` (ở đây không đặt trần; gắn để không phải nhớ). Chỉ TÊN và MÃ lỗi, không `message`.
  pool.on("release", (loi: unknown) => {
    if (loi instanceof TenantError && loi.code === "SESSION_STATE_LEFT") {
      console.error(`[gieo-demo] ket noi huy pool ${loi.name} ${loi.code}`);
    }
  });
  ngheLoiKetNoiToiMuon(pool, (loi: unknown) => {
    console.error(`[gieo-demo] loi ket noi toi muon pool ${loi instanceof Error ? loi.name : "loi la"}`);
  });
  try {
    await migrate(pool, MIGRATIONS_DIR);
    // [S1.251 / lượt soi T1] Trước khi gieo GÌ: worker con của ba gói đã mở nhận việc của mọi tổ chức (`goi-da-mo.ts`).
    await tuChoiKhiCoViecCuaToChucKhac(pool, null);

    const q = async <T extends Record<string, unknown>>(sql: string, tham: readonly unknown[] = []): Promise<T> => {
      const { rows } = await pool.query<T>(sql, [...tham]);
      const h = rows[0];
      if (h === undefined) throw new GieoError(`câu lệnh không trả hàng nào: ${sql.slice(0, 60)}`);
      return h;
    };

    const org = (await q<{ id: string }>(
      "INSERT INTO public.organizations (name, slug) VALUES ($1, $2) RETURNING id",
      [`Cong ty Demo ${duoi}`, `demo-${duoi}`],
    )).id;

    // BA người, không phải hai — và con số ba là do PHÉP ĐO ép ra, không do ai chọn.
    //
    // Lượt chạy thứ hai của script này gãy với đúng câu *"Nguoi tao RFQ khong duoc la mot trong
    // hai nguoi duyet (D2)"*, và lượt thứ tư gãy với `403 khong co quyen` khi một
    // PROCUREMENT_MANAGER bấm phê duyệt mở thầu: `005` cấp `rfq.unseal` cho PROCUREMENT_MANAGER
    // nhưng `rfq.unseal.approve` chỉ cho DIRECTOR. Nên bối cảnh demo phải có một người SOẠN và
    // hai người DUYỆT khác người soạn, với hai VAI khác nhau. Giữ lại lời kể này vì một bối cảnh
    // demo dựng được bằng hai người sẽ là dấu hiệu Separation of Duties đã mất răng.
    const nguoiMua: { readonly email: string; readonly id: string; readonly sessionId: string }[] = [];
    // [S1.98] NGƯỜI SOẠN THỨ HAI, và lý do nó phải có mặt là một phép đo chứ không một linh cảm.
    //
    // Lượt đi thử màn `/tao-thau` (S1.98) gãy ở đúng bước phê duyệt gói thầu: `rfq.approve` là
    // quyền của PROCUREMENT_MANAGER, gói vượt ngưỡng cần HAI phê duyệt, và người TẠO không được
    // đếm là một trong hai (D2). Bối cảnh demo có đúng MỘT người mang vai ấy, nên một gói thầu
    // tạo từ giao diện KHÔNG BAO GIỜ mở được — demo tự chặn chính bước mà `docs/PRODUCT.md` §11
    // đặt làm bước đầu tiên.
    //
    // Hai người DUYỆT mang vai DIRECTOR vẫn cần thiết và không thay được: `rfq.unseal.approve`
    // chỉ của DIRECTOR. Nên bối cảnh này có NĂM người, hai vai, hai loại phê duyệt khác nhau —
    // và sự khác nhau ấy chính là Separation of Duties chứ không phải thừa thãi.
    // [S1.199 / S4.2b] `dulieu` — người quản lý dữ liệu, một NGƯỜI MỚI chứ không phải một vai thêm cho người sẵn có (spec S4
    // §8.10): `DATA_STEWARD` không ghép được với vai nào ở đây.
    // [S1.266 / S3.3c1] `--s3`: `nhapncc` — người NHẬP hồ sơ nhà cung cấp, một người MỚI vai TECHNICAL (chỉ `evaluation.perform`):
    // K2 không đếm nhà cung cấp do người tạo gói hay một người mời dựng, và người này không giữ `rfq.invite` lẫn `rfq.approve` — không
    // thành người mời, không đổi số người ghi nhận được tín hiệu chia nhỏ. Không `--s3`: không có người ấy.
    for (const ten of ["soan", "soan2", "soan3", "duyet1", "duyet2", "dulieu", ...(S3 ? ["taichinh1", "taichinh2", "nhapncc"] : [])]) {
      const email = `${ten}.${duoi}@vidu.vn`;
      const hoTen = ten.startsWith("soan")
        ? `Nguoi soan goi thau ${ten.slice(4)}`.trim()
        : ten.startsWith("duyet")
          ? `Nguoi duyet ${ten.slice(-1)}`
          : ten === "dulieu"
            ? "Nguoi quan ly du lieu"
            : ten === "nhapncc" ? "Nguoi nhap nha cung cap" : `Nguoi tai chinh ${ten.slice(-1)}`;
      const id = (await q<{ id: string }>(
        "INSERT INTO public.users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id",
        [org, email, hoTen],
      )).id;
      const vai = ten.startsWith("soan")
        ? "PROCUREMENT_MANAGER"
        : ten.startsWith("duyet") ? "DIRECTOR" : ten === "dulieu" ? "DATA_STEWARD" : ten === "nhapncc" ? "TECHNICAL" : "FINANCE";
      await pool.query("INSERT INTO public.user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, id, vai]);
      // MỖI người một phiên riêng: mọi lần ghi có kiểm danh tính (013) đòi một phiên còn sống, và
      // `rfq_approvals_mot_phien_mot_lan` của 009 đòi một phiên KHÁC NHAU cho mỗi người duyệt.
      const sid = (await q<{ id: string }>(
        "INSERT INTO public.sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
          "VALUES ($1, $2, $3, pg_catalog.now() OPERATOR(pg_catalog.+) '2 hours'::pg_catalog.interval, pg_catalog.now()) RETURNING id",
        [org, id, randomBytes(32)],
      )).id;
      nguoiMua.push({ email, id, sessionId: sid });
    }
    const nguoiGieo = nguoiMua[0]?.id ?? "";
    const phienGieo = nguoiMua[0]?.sessionId ?? "";

    // [S1.199 / S4.2b] Ba hàng chuẩn, dưới phiên người quản lý dữ liệu — một giao dịch: trigger `du_lieu_nen_kiem_quyen_ghi`
    // phán người ghi như ở màn.
    const phienDuLieu = nguoiMua.find((n) => n.email.startsWith("dulieu."))?.sessionId;
    if (phienDuLieu === undefined) throw new GieoError("thiếu người quản lý dữ liệu");
    const hangChuanTheoMa = new Map<string, string>();
    await withTenant(pool, org, async (c) => {
      for (const h of HANG_CHUAN_DEMO) {
        const moi = await taoHangChuan(c, org, {
          ma: h.ma,
          donViGoc: h.donViGoc,
          ten: h.ten,
          thuocTinh: h.thuocTinh,
          thuocTinhTrongYeu: h.thuocTinhTrongYeu,
          actorSessionId: phienDuLieu,
        });
        hangChuanTheoMa.set(h.ma, moi.id);
        if (h.biDanh !== null) await khaiBiDanhHang(c, org, { hangChuanId: moi.id, biDanh: h.biDanh, actorSessionId: phienDuLieu });
        await khaiQuyDoiRieng(c, org, {
          hangChuanId: moi.id,
          tuDonVi: h.quyDoi.tu,
          sangDonVi: h.donViGoc,
          heSo: h.quyDoi.heSo,
          actorSessionId: phienDuLieu,
        });
      }
    });

    // [S1.272 / S4.6a] Một lô mốc giá ngoài và một lô lịch sử mua ngoài hệ thống, dán như người quản lý dữ liệu dán ở bước 7 của
    // `/du-lieu` — để demo thấy hai lô (không cột giá) và đi được việc rút. Hai lô qua đúng đường gói: lỗi theo dòng thì gieo dừng.
    // Lịch sử ngoài có một dòng tính theo TẤM — đơn vị đóng gói quy đổi riêng ở trên —, mốc ngoài theo kg.
    // [S1.276 / S4.6b] Ngày TƯƠNG ĐỐI theo lịch Việt Nam (UTC+7): `/mo-thau` đọc hai bảng trong cửa sổ 12 tháng của phiên bản ghim, nên
    // ngày viết cứng rơi khỏi cửa sổ sau vài tháng và demo lặng lẽ mất dải ngoài. Thép tấm có BA lần mua của ba nhà cung cấp — đủ sàn
    // mẫu (3 gói, 3 nhà cung cấp) để dải lịch sử ngoài hiện con số ở «Xem dải».
    const ngayLui = (n: number): string => new Date(Date.now() + 7 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);
    for (const [loai, vanBan] of [
      [
        "MOC_NGOAI",
        "ma_hang\tdon_gia\tdon_vi\ttien_te\tngay_hieu_luc\tnguon\n" +
          `THEP-TAM-SS400-10\t18500\tkg\tVND\t${ngayLui(35)}\tBang gia nha may thang truoc\n` +
          `THEP-HOP-MK-50X50-1.4\t21400\tkg\tVND\t${ngayLui(35)}\tBang gia nha may thang truoc\n`,
      ],
      [
        "LICH_SU_NGOAI",
        "ma_hang\tdon_gia\tdon_vi\ttien_te\tngay_mua\tnha_cung_cap\tnguon\n" +
          `THEP-TAM-SS400-10\t17900\tkg\tVND\t${ngayLui(320)}\tCong ty Thep Song Hong\tSo mua hang nam truoc\n` +
          `THEP-TAM-SS400-10\t12600000\ttam\tVND\t${ngayLui(305)}\tCong ty Thep Phuong Nam\tSo mua hang nam truoc\n` +
          `THEP-TAM-SS400-10\t18200\tkg\tVND\t${ngayLui(90)}\tCong ty Thep Mien Trung\tSo mua hang nam nay\n` +
          `BU-LONG-NEO-M24-8.8\t46000\tcai\tVND\t${ngayLui(305)}\tCong ty Thep Phuong Nam\tSo mua hang nam truoc\n`,
      ],
    ] as const) {
      const kq = await withTenant(pool, org, (c) => nhapDuLieuNgoai(c, org, { loai, vanBan, actorSessionId: phienDuLieu }));
      if (!kq.nhan) throw new GieoError(`lô ${loai} bị từ chối: ${kq.loi.map((l) => `dòng ${String(l.dong)} ${l.ma}`).join(", ")}`);
    }

    // [S1.174 / S3.1d] `--s3`: F1 khai phiên bản có bậc, F2 ký — hai giao dịch, hai phiên, đúng như hai người trên màn
    // `/chinh-sach`. Ngân sách phía dưới ghim chính phiên bản ấy: nó là bản hiệu lực ngay sau lần ký.
    // [S1.253 / S4.5a / L14] Phiên bản 1 khai LUÔN trọng số chấm (`gia`, hệ số 1) và BAFO top-2: lượt chấm của mọi gói gieo dưới
    // đây dùng phiên bản hiệu lực lúc gói MỞ, nên một phiên bản khai trọng số SAU lúc mở — cách người demo chấm được trước vòng
    // này — không còn áp cho gói nào đã mở.
    const chinhSach = S3
      ? await (async (): Promise<string> => {
          const f1 = nguoiMua.find((n) => n.email.startsWith("taichinh1."));
          const f2 = nguoiMua.find((n) => n.email.startsWith("taichinh2."));
          if (f1 === undefined || f2 === undefined) throw new GieoError("--s3: thiếu người tài chính");
          const cs = await withTenant(pool, org, (c) =>
            createProcurementPolicy(c, org, {
              version: 1,
              dualApprovalThreshold: MUC_DEMO.nguongKep,
              currency: "VND",
              tiers: BAC_DEMO,
              evalComponents: TRONG_SO_DEMO,
              bafoTopN: BAFO_TOP_N_DEMO,
              // [S1.256 / S4.5b] Nhóm khoá `benchmark` — MẪU của spec S4 §4.1, cùng mẫu màn `/chinh-sach` điền sẵn.
              benchmark: NHOM_BENCHMARK_MAU,
              chiaNhoCuaSoNgay: MUC_DEMO.chiaNhoCuaSoNgay,
              thamDinhHieuLucThang: MUC_DEMO.thamDinhHieuLucThang,
              actorSessionId: f1.sessionId,
            }),
          );
          const ky = await withTenant(pool, org, (c) => kyPhienBanChinhSach(c, org, { policyId: cs.id, actorSessionId: f2.sessionId }));
          if (!ky.daBat) throw new GieoError("--s3: ký xong mà tổ chức chưa bật S3");
          return cs.id;
        })()
      : (await q<{ id: string }>(
          "INSERT INTO public.org_procurement_policies (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n, " +
            "benchmark, created_by, created_by_session_id) " +
            "VALUES ($1, 1, '1000000000.00', 'VND', $2::pg_catalog.jsonb, $3::pg_catalog.int4, $4::pg_catalog.jsonb, $5, $6) RETURNING id",
          [org, JSON.stringify(TRONG_SO_DEMO), BAFO_TOP_N_DEMO, JSON.stringify(NHOM_BENCHMARK_MAU), nguoiGieo, phienGieo],
        )).id;

    // [S1.201 / S3.6a] `--s3`: F1 (FINANCE, giữ `category.manage`) dựng nhóm hàng bằng hàm gói — tổ chức đã bật không nộp duyệt
    // được gói không nhóm hàng. Không `--s3`: không nhóm hàng nào, luồng MVP1 giữ nguyên.
    const nhomHang = S3
      ? await (async (): Promise<string> => {
          const f1 = nguoiMua.find((n) => n.email.startsWith("taichinh1."));
          if (f1 === undefined) throw new GieoError("--s3: thiếu người tài chính");
          return (await withTenant(pool, org, (c) =>
            taoNhomHang(c, org, { ma: "KET-CAU", ten: "Vat tu ket cau", actorSessionId: f1.sessionId }, pool),
          )).id;
        })()
      : null;

    const rfq = (await q<{ id: string }>(
      "INSERT INTO public.rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, created_by_session_id, category_id) " +
        "VALUES ($1, $2, pg_catalog.now() OPERATOR(pg_catalog.+) '2 hours'::pg_catalog.interval, true, $3, $4, $5) RETURNING id",
      [org, `Goi thau vat tu ket cau ${duoi}`, nguoiGieo, phienGieo, nhomHang],
    )).id;
    for (const [i, hm] of HANG_MUC.entries()) {
      await pool.query(
        "INSERT INTO public.rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, created_by_session_id) " +
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [org, rfq, i + 1, hm.mo, hm.sl, hm.dvt, nguoiGieo, phienGieo],
      );
    }
    await pool.query(
      "INSERT INTO public.rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id) " +
        "VALUES ($1, $2, '9000000000.00', 'VND', $3, $4, $5)",
      [org, rfq, chinhSach, nguoiGieo, phienGieo],
    );
    // [S1.190 / S3.2c1 / K4a · K4b · K6] Nhà cung cấp, người liên hệ và lời mời. Tổ chức đã bật S3 mời ở DRAFT — TRƯỚC khi nộp
    // duyệt —, vì chữ ký duyệt gói mang băm của danh sách mời lúc ký (K4b) và gói chỉ mở khi người ký ký đúng danh sách ấy; lời mời
    // là `UNSENT`, KHÔNG token (K6). Tổ chức chưa bật giữ thứ tự MVP1: mời sau khi mở, token ngay lúc mời.
    // [S1.266 / S3.3c1] `--s3`: K2 (S3.3c2) đếm ở cạnh nộp duyệt — kể cả câu UPDATE thẳng phía dưới, vì trigger là ENABLE ALWAYS —
    // và chỉ đếm nhà cung cấp mà hồ sơ và người liên hệ KHÔNG do người tạo gói hay người mời (soan) dựng, có MST, và có xác minh còn
    // hiệu lực của người không khai phiên bản mà ngân sách ghim. Nên `nhapncc` dựng hồ sơ có MST (mỗi người một MST gốc) và người liên
    // hệ, rồi `taichinh2` — người KÝ chứ không khai phiên bản — xác minh, SAU khi có người liên hệ (băm hồ sơ phủ nó). Người mời vẫn là
    // soan. Không `--s3`: soan dựng, không MST, không xác minh — như trước (cột MST nhận NULL như khi không nêu).
    const nhapNcc = S3 ? nguoiMua.find((n) => n.email.startsWith("nhapncc.")) : undefined;
    const xacMinhNcc = S3 ? nguoiMua.find((n) => n.email.startsWith("taichinh2.")) : undefined;
    if (S3 && (nhapNcc === undefined || xacMinhNcc === undefined)) throw new GieoError("--s3: thiếu người nhập hay người xác minh nhà cung cấp");
    const nguoiDungNcc = nhapNcc ?? { id: nguoiGieo, sessionId: phienGieo };
    // [S1.275 / S3.3e2] Xác minh đi ĐƯỜNG CỦA MÀN `/nha-cung-cap` (S3.3e1, lượt soi CAO-2): đọc băm hồ sơ như màn hiện, rồi
    // `xacMinhNhaCungCap` ràng băm ấy — trigger `ncc_kiem_xac_minh` (`082`) tính lại lúc ghi, lệch thì ném. Trước vòng này công cụ
    // chèn thẳng hàng `VERIFIED`: trigger vẫn kiểm luật người, nhưng cổng quyền `supplier.qualify`, hàng sổ `SUPPLIER_VERIFIED` và
    // phép so băm-đã-xem không đi qua lượt demo nào. Gọi SAU khi hồ sơ có người liên hệ — băm hồ sơ phủ nó.
    const xacMinhQuaMan = async (c: pg.PoolClient, supplierId: string): Promise<void> => {
      if (xacMinhNcc === undefined) throw new GieoError("--s3: thiếu người xác minh nhà cung cấp");
      const bamDaXem = (await docHoSoXacMinh(c, org)).find((h) => h.supplierId === supplierId)?.bamHoSo;
      if (bamDaXem === undefined) throw new GieoError("--s3: không đọc được hồ sơ nhà cung cấp vừa dựng");
      const xm = await xacMinhNhaCungCap(c, org, { supplierId, actorSessionId: xacMinhNcc.sessionId, bamDaXem }, pool);
      if (!xm.conHieuLuc) throw new GieoError("--s3: xác minh xong mà không còn hiệu lực");
    };
    const taoNccVaMoi = async (c: pg.PoolClient): Promise<(NhaCungCapGieo & { readonly invitationId: string })[]> => {
      const daMoi: (NhaCungCapGieo & { readonly invitationId: string })[] = [];
      for (const [i, ten] of [...NHA_CUNG_CAP, ...(S3 ? NHA_CUNG_CAP_THEM_S3 : [])].entries()) {
        const ncc = (await c.query<{ id: string }>(
          "INSERT INTO public.suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [org, `${ten} ${duoi}`, S3 ? `03${soDienThoai}${String(i)}` : null, nguoiDungNcc.id, nguoiDungNcc.sessionId],
        )).rows[0]?.id ?? "";
        const lh = (await c.query<{ id: string }>(
          "INSERT INTO public.supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
          [org, ncc, `Nguoi bao gia ${i + 1}`, `ncc${i + 1}.${duoi}@vidu.vn`, `09${soDienThoai}${i}`.slice(0, 10), nguoiDungNcc.id, nguoiDungNcc.sessionId],
        )).rows[0]?.id ?? "";
        if (xacMinhNcc !== undefined) await xacMinhQuaMan(c, ncc);
        const lm = await createInvitation(c, org, {
          rfqId: rfq,
          supplierId: ncc,
          contactId: lh,
          linkChannel: "EMAIL",
          actorSessionId: phienGieo,
        }, pool);
        daMoi.push({ ten, supplierId: ncc, contactId: lh, invitationId: lm.id });
      }
      return daMoi;
    };
    const moiTruocKhiKy = S3 ? await withTenant(pool, org, taoNccVaMoi) : [];
    /** [S1.251 / S4.4b] Nhà cung cấp của gói chính — ba người đầu được mời lại ở ba gói đã mở. */
    const nhaCungCapGoiChinh: NhaCungCapGieo[] = [...moiTruocKhiKy];

    await pool.query(
      "UPDATE public.rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 " +
        "WHERE id OPERATOR(pg_catalog.=) $1",
      [rfq, nguoiGieo, phienGieo],
    );
    // [S1.234 / S4.3b] Lượt chuẩn hoá sau lần nộp — cùng hàm route nộp duyệt gọi sau commit, dưới phiên người nộp: hai dòng
    // trùng bí danh tự nối, dòng bu lông neo vào hàng đợi với gợi ý.
    const luot = await withTenant(pool, org, (c) => chuanHoaSauNop(c, org, { rfqId: rfq, actorSessionId: phienGieo }));
    if (luot === null) throw new GieoError("lượt chuẩn hoá không chạy dù tổ chức có hàng chuẩn");

    // HAI phê duyệt của HAI người KHÁC người soạn — ngân sách gieo ở trên vượt ngưỡng chính sách,
    // nên máy trạng thái ở tầng CSDL từ chối mở gói thầu khi chưa đủ. Lượt chạy đầu của script này
    // gãy đúng ở đó: *"RFQ nay can 2 phe duyet TREN NOI DUNG HIEN TAI, moi co 0 (D2)"*.
    // [S1.174 / S3.1d] `--s3`: đúng hai người §7 xếp cho bước này — P2, P3, hai PROCUREMENT_MANAGER khác người soạn. Lượt đi
    // thử T4 đo ra bản đầu của `--s3` ghi SÁU chữ ký: vòng dưới lấy mọi người trừ người soạn, kể cả hai người tài chính mới.
    // Chế độ mặc định giữ nguyên hình dạng cũ (bốn chữ ký — cả hai giám đốc, một lối tắt của câu SQL, route không cho).
    // [S1.190 / S3.2c1] `--s3`: trigger đặt băm danh sách lúc ký — danh sách năm lời mời vừa dựng ở DRAFT.
    const nguoiDuyetGoi = S3 ? nguoiMua.filter((n) => /^soan[23]\./u.test(n.email)) : nguoiMua.slice(1);
    // [S1.198 / khoản 256] Mỗi chữ ký mang lần nộp đang có — ở tổ chức đã bật, trigger `rfq_approvals_so_lan_nop` đòi nó; tổ
    // chức chưa bật nhận nó như một lời duyệt tự gửi mốc đúng.
    // [S1.283 / S3.4b · K9] `--s3`: bậc demo đòi khai báo xung đột lợi ích — hai người ký khai *không xung đột* với danh sách vừa dựng,
    // bằng hàm gói, TRƯỚC chữ ký công cụ ghi thay họ (trigger `rfq_approvals_kiem_xung_dot` chặn chữ ký của người chưa khai).
    if (S3) for (const nm of nguoiDuyetGoi) await khaiKhongXungDot(pool, org, rfq, nm);
    for (const nm of nguoiDuyetGoi) {
      await pool.query(
        "INSERT INTO public.rfq_approvals (org_id, rfq_id, approver_user_id, session_id, lan_nop_da_xem) " +
          "SELECT $1, $2, $3, $4, p.lan_nop FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) $2",
        [org, rfq, nm.id, nm.sessionId],
      );
    }

    const loiMoi: { readonly ten: string; readonly token: string }[] = [];
    await withTenant(pool, org, async (c) => {
      // Cặp khoá RFQ ra đời ở đây và khoá riêng được BỌC ngay — `issueRfqKeyPair` trả về mọi thứ
      // trừ nó (ADR-019). Script này không bao giờ cầm một khoá riêng dạng rõ.
      await issueRfqKeyPair(c, org, { rfqId: rfq, actorSessionId: phienGieo, orgKeys: createLocalDevOrgKeyProvisioner(vong) });
      await c.query(
        "UPDATE public.rfq_packages SET status = 'OPEN', opened_at = pg_catalog.now(), opened_by = $2, opened_by_session_id = $3 " +
          "WHERE id OPERATOR(pg_catalog.=) $1",
        [rfq, nguoiGieo, phienGieo],
      );

      if (S3) {
        // [S1.190 / S3.2c1 / K6] Đúng đường của route mở gói (S3.2b2, ADR-113): phiên người mở đúc MỘT token cho mỗi lời mời
        // còn sống, trong CHÍNH giao dịch mở gói. Công cụ không có bộ gửi — nó in link ra; lời mời thành `SENT` như sau một lần
        // gửi được, cũng trong giao dịch này (gói đã `OPEN` trong giao dịch, và trigger `076` chỉ đòi điều ấy).
        const links = await ducTokenKhiMoGoi(c, org, { rfqId: rfq, actorSessionId: phienGieo });
        if (links.length !== moiTruocKhiKy.length) {
          throw new GieoError(`--s3: đúc ${String(links.length)} token cho ${String(moiTruocKhiKy.length)} lời mời`);
        }
        for (const lm of moiTruocKhiKy) {
          const link = links.find((l) => l.invitationId === lm.invitationId);
          if (link === undefined) throw new GieoError(`--s3: lời mời ${lm.ten} không có token lúc mở gói`);
          if (!(await danhDauDaGui(c, org, lm.invitationId))) throw new GieoError(`--s3: lời mời ${lm.ten} không thành SENT`);
          loiMoi.push({ ten: lm.ten, token: link.token.token });
        }
        return;
      }
      for (const lm of await taoNccVaMoi(c)) {
        nhaCungCapGoiChinh.push(lm);
        const t = await issueMagicLinkToken(c, org, { invitationId: lm.invitationId, actorSessionId: phienGieo });
        loiMoi.push({ ten: lm.ten, token: t.token });
      }
    });

    // [S3.6b2 / K10a] `--s3`: tín hiệu chia nhỏ gói. Nhóm hàng RIÊNG — trong `KET-CAU`, gói 9 tỷ ở trên nhập tập và tín hiệu bắn ở cận
    // 10 tỷ thay vì 1 tỷ. Ba gói 480 / 470 / 490 triệu do người soạn tạo và nộp đúng theo thứ tự ấy, mỗi lần nộp một giao dịch: cửa sổ
    // tính NGƯỢC từ `submitted_at` của chính gói, nên chỉ gói nộp sau cùng mang tín hiệu — và chỉ `submitRfqForApproval` ghi ảnh chụp
    // lúc nộp (câu UPDATE thẳng như gói 9 tỷ thì không). Mỗi gói dưới ngưỡng kép 1 tỷ nên một chữ ký của soan2 là đủ. Hai gói đầu mở
    // bằng `openRfq`; gói thứ ba dừng ở cạnh mở — chủ dự án chốt ngày 2026-09-30: người demo tự đi đường bị chặn, ghi nhận, rồi mở.
    const chiaNho = S3
      ? await (async (): Promise<readonly { readonly giaTri: string; readonly id: string }[]> => {
          const f1 = nguoiMua.find((n) => n.email.startsWith("taichinh1."));
          const soan = nguoiMua.find((n) => n.email.startsWith("soan."));
          const soan2 = nguoiMua.find((n) => n.email.startsWith("soan2."));
          if (f1 === undefined || soan === undefined || soan2 === undefined) throw new GieoError("--s3: thiếu người cho tín hiệu chia nhỏ");
          const nhom = (await withTenant(pool, org, (c) =>
            taoNhomHang(c, org, { ma: "THEP-TAM", ten: "Thep tam cho cong trinh", actorSessionId: f1.sessionId }, pool),
          )).id;
          const han = new Date(Date.now() + 2 * 24 * 3600 * 1000);
          // [S1.270 / S3.3d / K3] Bậc từ 100 triệu xoay vòng (`xoay_vong_n` = 5): gói 9 tỷ — đã mở, một suất trong cửa sổ của soan — mời
          // cả tám nhà cung cấp của gói chính, nên một gói chia nhỏ chỉ mời lại họ là không có nhà cung cấp MỚI. Mỗi gói thêm một người
          // mới của riêng nó, dựng như tám người kia (nhapncc dựng, taichinh2 xác minh SAU khi có người liên hệ); MST và số điện thoại
          // mang đầu `04`/`08`, khác đầu `03`/`09` của gói chính.
          const nhapMoi = nhapNcc;
          if (nhapMoi === undefined || xacMinhNcc === undefined) throw new GieoError("--s3: thiếu người nhập hay người xác minh nhà cung cấp");
          const nccMoi = await withTenant(pool, org, async (c) => {
            const ra: { readonly supplierId: string; readonly contactId: string }[] = [];
            for (const i of [0, 1, 2]) {
              const ncc = (await c.query<{ id: string }>(
                "INSERT INTO public.suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
                [org, `Thep tam luan phien ${String(i + 1)} ${duoi}`, `04${soDienThoai}${String(i)}`, nhapMoi.id, nhapMoi.sessionId],
              )).rows[0]?.id ?? "";
              const lh = (await c.query<{ id: string }>(
                "INSERT INTO public.supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
                  "VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
                [org, ncc, `Nguoi bao gia luan phien ${String(i + 1)}`, `luanphien${String(i + 1)}.${duoi}@vidu.vn`, `08${soDienThoai}${String(i)}`, nhapMoi.id, nhapMoi.sessionId],
              )).rows[0]?.id ?? "";
              await xacMinhQuaMan(c, ncc);
              ra.push({ supplierId: ncc, contactId: lh });
            }
            return ra;
          });
          const goi: { readonly giaTri: string; readonly id: string }[] = [];
          for (const [i, giaTri] of ["480000000.00", "470000000.00", "490000000.00"].entries()) {
            const id = await withTenant(pool, org, async (c) => {
              const r = await createRfq(c, org, {
                title: `Thep tam cong trinh ${String(i + 1)} ${duoi}`,
                deadlineAt: han,
                createdBySessionId: soan.sessionId,
                categoryId: nhom,
              });
              await setRfqBudget(c, org, { rfqId: r.id, estimatedValue: giaTri, currency: "VND", actorSessionId: soan.sessionId });
              await addRfqItem(c, org, {
                rfqId: r.id,
                lineNo: 1,
                description: "Thep tam SS400 day 10mm",
                quantity: "40.0000",
                unit: "tam",
                actorSessionId: soan.sessionId,
              });
              // [S1.266 / S3.3c1] Bậc từ 100 triệu đòi BA nhà cung cấp đếm được (K2) — trước vòng này ba gói nộp duyệt không một lời
              // mời nào. soan mời ba người đầu của gói chính (nhapncc dựng, taichinh2 xác minh) ở DRAFT, trước lần nộp. Tín hiệu chia nhỏ
              // đọc ngân sách và nhóm hàng, không đọc lời mời; soan2 ký và nằm ngoài tập loại trừ, nên K5 cho hai lần mở dưới qua.
              // [S1.270 / S3.3d / K3] Hai người đầu của gói chính cộng người luân phiên thứ i — mới với cửa sổ của soan.
              for (const n of [...moiTruocKhiKy.slice(0, 2), ...nccMoi.slice(i, i + 1)]) {
                await createInvitation(
                  c,
                  org,
                  { rfqId: r.id, supplierId: n.supplierId, contactId: n.contactId, linkChannel: "EMAIL", actorSessionId: soan.sessionId },
                  pool,
                );
              }
              return r.id;
            });
            await withTenant(pool, org, (c) => submitRfqForApproval(c, org, { rfqId: id, actorSessionId: soan.sessionId }, pool));
            const lanNop = (await q<{ n: number }>(
              "SELECT p.lan_nop AS n FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) $1",
              [id],
            )).n;
            // [S1.283 / S3.4b · K9] soan2 khai *không xung đột* trước chữ ký công cụ ghi thay (bậc demo đòi khai).
            await khaiKhongXungDot(pool, org, id, soan2);
            await withTenant(pool, org, (c) => approveRfq(c, org, { rfqId: id, sessionId: soan2.sessionId, lanNopDaXem: lanNop }, pool));
            if (i < 2) {
              await withTenant(pool, org, (c) =>
                openRfq(c, org, { rfqId: id, actorSessionId: soan.sessionId, orgKeys: createLocalDevOrgKeyProvisioner(vong) }, pool),
              );
            }
            goi.push({ giaTri, id });
          }
          return goi;
        })()
      : [];

    // [S1.275 / S3.3e2 / K2 · K5] `--s3`: gói MỘT NGUỒN — người demo đi tay qua ngoại lệ cạnh tranh trên màn `/tao-thau`. Chủ dự án
    // chốt 2026-10-06: khuôn K10a — công cụ dựng tới cạnh bị chặn rồi dừng; đường demo đi K2 rồi K5. Gói 200 triệu ở bậc từ 100 triệu
    // (ba nhà cung cấp, ký danh sách, xoay vòng 5), nhóm hàng RIÊNG (`MOT-NGUON` — không gói anh em nào cho K10a). soan tạo và mời MỘT
    // nhà cung cấp đếm được, mới với cửa sổ K3 của soan (MST đầu `05`, điện thoại đầu `07` — khác `03`/`09` và `04`/`08` ở trên),
    // nhapncc dựng, taichinh2 xác minh. Gói ở DRAFT, chưa nộp. Người demo: soan nộp → K2 chặn; soan2 lập `SINGLE_SOURCE` (một lời mời
    // còn sống ⇒ đúng loại ấy) → soan nộp qua; soan2 ký → soan mở → K5 chặn: tác giả ngoại lệ thuộc tập loại trừ — một ngoại lệ không
    // bao giờ tự duyệt (spec S3 §4.4); soan3 ký → mở. Không `--s3`: không gói này.
    const motNguon = S3
      ? await (async (): Promise<string> => {
          const f1 = nguoiMua.find((n) => n.email.startsWith("taichinh1."));
          const soan = nguoiMua.find((n) => n.email.startsWith("soan."));
          if (f1 === undefined || soan === undefined || nhapNcc === undefined) throw new GieoError("--s3: thiếu người cho gói một nguồn");
          const nhom = (await withTenant(pool, org, (c) =>
            taoNhomHang(c, org, { ma: "MOT-NGUON", ten: "Van dieu ap mot nguon", actorSessionId: f1.sessionId }, pool),
          )).id;
          return await withTenant(pool, org, async (c) => {
            const ncc = (await c.query<{ id: string }>(
              "INSERT INTO public.suppliers (org_id, legal_name, tax_code, created_by, created_by_session_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
              [org, `Van cong nghiep Mot Nguon ${duoi}`, `05${soDienThoai}0`, nhapNcc.id, nhapNcc.sessionId],
            )).rows[0]?.id ?? "";
            const lh = (await c.query<{ id: string }>(
              "INSERT INTO public.supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
                "VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
              [org, ncc, "Nguoi bao gia mot nguon", `motnguon.${duoi}@vidu.vn`, `07${soDienThoai}0`, nhapNcc.id, nhapNcc.sessionId],
            )).rows[0]?.id ?? "";
            await xacMinhQuaMan(c, ncc);
            const r = await createRfq(c, org, {
              title: `Van dieu ap mot nguon ${duoi}`,
              deadlineAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
              createdBySessionId: soan.sessionId,
              categoryId: nhom,
            });
            await setRfqBudget(c, org, { rfqId: r.id, estimatedValue: "200000000.00", currency: "VND", actorSessionId: soan.sessionId });
            await addRfqItem(c, org, {
              rfqId: r.id,
              lineNo: 1,
              description: "Van dieu ap DN100 PN16",
              quantity: "4.0000",
              unit: "cai",
              actorSessionId: soan.sessionId,
            });
            await createInvitation(
              c,
              org,
              { rfqId: r.id, supplierId: ncc, contactId: lh, linkChannel: "EMAIL", actorSessionId: soan.sessionId },
              pool,
            );
            return r.id;
          });
        })()
      : null;

    // [S1.251 / S4.4b] Ba gói đã mở niêm phong qua đường thật (`goi-da-mo.ts`), để lịch sử giá của ba hàng chuẩn có quan sát.
    const nguoi = (dau: string): { readonly id: string; readonly sessionId: string } => {
      const n = nguoiMua.find((x) => x.email.startsWith(dau));
      if (n === undefined) throw new GieoError(`thiếu người ${dau}`);
      return n;
    };
    const buLong = hangChuanTheoMa.get("BU-LONG-NEO-M24-8.8");
    if (buLong === undefined) throw new GieoError("thiếu hàng chuẩn bu lông neo");
    const nhomDaMo = S3
      ? (await withTenant(pool, org, (c) =>
          taoNhomHang(c, org, { ma: "DA-MO", ten: "Vat tu cac goi da mo", actorSessionId: nguoi("taichinh1.").sessionId }, pool),
        )).id
      : null;
    const baDong = [
      { mo: HANG_MUC[0]!.mo, dvt: HANG_MUC[0]!.dvt, donGiaGoc: 12_500_000 },
      { mo: HANG_MUC[1]!.mo, dvt: HANG_MUC[1]!.dvt, donGiaGoc: 265_000 },
      { mo: HANG_MUC[2]!.mo, dvt: HANG_MUC[2]!.dvt, donGiaGoc: 48_000 },
    ];
    const daMo = await gieoBaGoiDaDieuPhoi({
      pool,
      org,
      duoi,
      vong,
      boKy,
      s3: S3,
      nhomHang: nhomDaMo,
      soan: nguoi("soan."),
      soan2: nguoi("soan2."),
      duyet1: nguoi("duyet1."),
      duyet2: nguoi("duyet2."),
      duLieu: nguoi("dulieu."),
      nhaCungCap: nhaCungCapGoiChinh.slice(0, 3),
      dong: baDong,
      anhXaTay: { lineNo: 3, hangChuanId: buLong },
    });
    // [S1.282 / S3.5b] `--s3`: gói TRAO THẦU — một tỷ, bậc 2, năm mời, bốn nộp (`goi-trao-thau.ts`) — đi cùng lượt worker với ba gói
    // trên, rồi MỘT lượt chấm, dừng ở EVALUATING: người demo đi tay K2b → ngoại lệ hậu kiểm → đề xuất → hai chữ ký (K7) → K5b ở `/mo-thau`.
    // Nhóm hàng RIÊNG (`TRAO-THAU`) để không gói anh em nào cho K10a; soan3 làm mọi việc của người soạn vì soan và soan2 đã là người
    // chọn của các gói khác (K3 tính cửa sổ theo người chọn) và soan2 là người chấm rồi đề xuất.
    const traoThau = S3
      ? await (async () => {
          const nhom = (await withTenant(pool, org, (c) =>
            taoNhomHang(c, org, { ma: "TRAO-THAU", ten: "Vat tu goi trao thau", actorSessionId: nguoi("taichinh1.").sessionId }, pool),
          )).id;
          return await gieoGoiTraoThauDenDieuPhoi({
            pool,
            org,
            duoi,
            vong,
            boKy,
            nhomHang: nhom,
            soan3: nguoi("soan3."),
            soan: nguoi("soan."),
            soan2: nguoi("soan2."),
            duyet1: nguoi("duyet1."),
            duyet2: nguoi("duyet2."),
            taichinh1: nguoi("taichinh1."),
            taichinh2: nguoi("taichinh2."),
            nhaCungCap: nhaCungCapGoiChinh.slice(0, 5),
            dong: baDong,
          });
        })()
      : null;
    // [S1.9101 / S4.7b2] `--s3`: gói TCO. Mọi gói trên đã mở dưới phiên bản 1 (chỉ giá) — phiên bản ghim lúc mở (ADR-141). Nay
    // taichinh1 khai phiên bản 2 (cùng bậc, cộng vận chuyển, chi phí thanh toán, chi phí trễ và tham số giả định), taichinh2 ký — không
    // phải chữ ký BẬT S3, nên `097` không chặn — rồi một gói bậc 1 (60 triệu) với số ngày giao yêu cầu 30 ngày mở dưới nó. Bốn phong bì
    // mang ô khai sao cho hạng giá KHÁC hạng TCO: người nộp thứ ba rẻ nhất theo giá (×0,98) mà đòi trả ngay, giao 45 ngày và tính phí vận
    // chuyển 1,5 triệu — hạng TCO thứ ba; người thứ nhất (×1,00, 0,5 triệu vận chuyển, đủ kỳ, đúng hạn) đứng đầu hạng TCO.
    const goiTco = S3
      ? await (async () => {
          const f1 = nguoi("taichinh1.");
          const f2 = nguoi("taichinh2.");
          const v2 = await withTenant(pool, org, (c) =>
            createProcurementPolicy(c, org, {
              version: 2,
              dualApprovalThreshold: MUC_DEMO.nguongKep,
              currency: "VND",
              tiers: BAC_DEMO,
              evalComponents: TRONG_SO_TCO_DEMO,
              bafoTopN: BAFO_TOP_N_DEMO,
              benchmark: NHOM_BENCHMARK_MAU,
              tco: THAM_SO_TCO_DEMO,
              chiaNhoCuaSoNgay: MUC_DEMO.chiaNhoCuaSoNgay,
              thamDinhHieuLucThang: MUC_DEMO.thamDinhHieuLucThang,
              actorSessionId: f1.sessionId,
            }),
          );
          await withTenant(pool, org, (c) => kyPhienBanChinhSach(c, org, { policyId: v2.id, actorSessionId: f2.sessionId }));
          const nhom = (await withTenant(pool, org, (c) =>
            taoNhomHang(c, org, { ma: "TCO", ten: "Vat tu goi TCO", actorSessionId: f1.sessionId }, pool),
          )).id;
          return await gieoGoiTraoThauDenDieuPhoi({
            pool,
            org,
            duoi,
            vong,
            boKy,
            nhomHang: nhom,
            soan3: nguoi("soan3."),
            soan: nguoi("soan."),
            soan2: nguoi("soan2."),
            duyet1: nguoi("duyet1."),
            duyet2: nguoi("duyet2."),
            taichinh1: f1,
            taichinh2: f2,
            nhaCungCap: nhaCungCapGoiChinh.slice(0, 5),
            dong: baDong,
            tco: {
              tieuDe: `Goi TCO ${duoi}`,
              nganSach: "60000000.00",
              soLuong: [3, 40, 200],
              soNgayGiao: 30,
              khai: [
                { freight: "500000", paymentDays: "60", leadTimeDays: "30" },
                { freight: "0", paymentDays: "60", leadTimeDays: "25" },
                { freight: "1500000", paymentDays: "0", leadTimeDays: "45" },
                { freight: "0", paymentDays: "90", leadTimeDays: "20" },
              ],
            },
          });
        })()
      : null;
    await chayWorkerToiKhiMo(
      pool,
      org,
      [...daMo.map((g) => g.rfqId), ...(traoThau === null ? [] : [traoThau.rfqId]), ...(goiTco === null ? [] : [goiTco.rfqId])],
      {
        databaseUrl: urlWorker,
        masterKeys: bat("TRUSTPROCURE_MASTER_KEYS"),
        masterKeyActive: bat("TRUSTPROCURE_MASTER_KEY_ACTIVE"),
      },
    );
    // Lượt chấm chỉ có sau khi worker mở xong; soan2 chấm (`evaluation.perform`) — rồi chính soan2 lập ngoại lệ và đề xuất trên màn.
    if (traoThau !== null) await chamGoiTraoThau(pool, org, traoThau.rfqId, nguoi("soan2."));
    // [S1.9101 / S4.7b2] Lượt chấm của gói TCO — dưới phiên bản 2, năm mã có nguồn; `/mo-thau` hiện hai hạng và phép tính.
    if (goiTco !== null) await chamGoiTraoThau(pool, org, goiTco.rfqId, nguoi("soan2."));

    const tokenNguoiMua: { readonly email: string; readonly token: string }[] = [];
    for (const nm of nguoiMua) {
      const kq = await withTenant(pool, org, (c) => issueLoginToken(c, org, { email: nm.email }));
      if (!kq.ok) throw new GieoError(`không phát được token đăng nhập cho ${nm.email}`);
      tokenNguoiMua.push({ email: nm.email, token: kq.token });
    }

    const ra: string[] = [];
    ra.push("");
    ra.push(S3 ? "=== ĐÃ GIEO MỘT VÒNG THẦU — TỔ CHỨC ĐÃ BẬT S3 (bảng vai §7) ===" : "=== ĐÃ GIEO MỘT VÒNG THẦU ===");
    ra.push(`tổ chức : ${org}`);
    ra.push(`gói thầu: ${rfq}   (hạn nộp sau 2 giờ, cần HAI người duyệt để mở)`);
    ra.push("");
    ra.push("NHÀ CUNG CẤP — mở trên điện thoại, mỗi link một người:");
    for (const lm of loiMoi) ra.push(`  ${lm.ten.padEnd(24)} ${gocWeb}/nop-thau#${org}:${lm.token}`);
    ra.push("");
    ra.push("NGƯỜI MUA — lần đầu vào sẽ hiện bí mật TOTP để ghi danh.");
    ra.push("  soan tạo gói thầu ở /tao-thau; soan2 + soan3 (cùng PROCUREMENT_MANAGER) phê duyệt — phê duyệt kép đòi HAI người KHÁC người tạo.");
    ra.push("  duyet1 + duyet2 (DIRECTOR) phê duyệt MỞ THẦU ở /mo-thau — hai loại phê duyệt khác nhau.");
    // [S1.266 / S3.3c1] `nhapncc` (TECHNICAL, `--s3`) không làm gì ở /mo-thau — không in link của người ấy ở đây.
    for (const nm of tokenNguoiMua.filter((n) => !n.email.startsWith("taichinh") && !n.email.startsWith("dulieu.") && !n.email.startsWith("nhapncc."))) {
      ra.push(`  ${nm.email.padEnd(24)} ${gocWeb}/mo-thau#${org}:${nm.token}`);
    }
    ra.push("");
    ra.push("QUẢN LÝ DỮ LIỆU — dulieu (DATA_STEWARD) ở /du-lieu: ba hàng chuẩn cho ba dòng của gói, mỗi hàng một quy đổi riêng từ");
    ra.push("  tấm / cây / bộ về đơn vị gốc — hệ số tính từ kích thước, không phải số đo. Hai hàng có bí danh là nguyên mô tả dòng:");
    ra.push(`  lúc nộp, ${String(luot.tuDong)} dòng tự nối; ${String(luot.goiY + luot.canDuyet)} dòng (bu lông neo) chờ ở bước 6 «Hàng đợi ánh xạ».`);
    ra.push("  Người mua khác mở /du-lieu chỉ xem được, và màn nói vì sao.");
    for (const nm of tokenNguoiMua.filter((n) => n.email.startsWith("dulieu."))) {
      ra.push(`  ${nm.email.padEnd(24)} ${gocWeb}/du-lieu#${org}:${nm.token}`);
    }
    if (S3) {
      ra.push("");
      ra.push("TÀI CHÍNH — taichinh1 đã khai, taichinh2 đã ký phiên bản 1 (bốn bậc mặc định §4.1, ngưỡng kép 1 tỷ): S3 ĐÃ BẬT.");
      // [S1.9101 / S4.7b2] Phiên bản 2 — TCO — là phiên bản hiệu lực sau lần gieo: gói mới tạo ở /tao-thau phải khai số ngày giao.
      ra.push("  Rồi phiên bản 2 (cùng bậc, cộng vận chuyển, chi phí thanh toán, chi phí trễ — tham số giả định) — bản hiệu lực: gói mới");
      ra.push("  tạo ở /tao-thau phải khai số ngày giao yêu cầu trước khi nộp duyệt. «Goi TCO» đã chấm dưới nó: /mo-thau hiện hai hạng.");
      ra.push("  Màn /chinh-sach đọc trọn ma trận và số người tối thiểu mỗi bậc. Ký một phiên bản MỚI ở màn ấy cần `api` chạy");
      ra.push("  với TRUSTPROCURE_S3_CHO_KY_CHINH_SACH=bat (ADR-105) — cờ ấy mặc định tắt, và không mở trên máy chủ thật.");
      for (const nm of tokenNguoiMua.filter((n) => n.email.startsWith("taichinh"))) {
        ra.push(`  ${nm.email.padEnd(24)} ${gocWeb}/chinh-sach#${org}:${nm.token}`);
      }
      // [S1.266 / S3.3c1] Nhà cung cấp đếm được của K2 — người dựng và người xác minh, nói ra cho người demo.
      ra.push("  Năm nhà cung cấp của gói chính: nhapncc (TECHNICAL, không mời, không duyệt) nhập hồ sơ có MST và người liên hệ, taichinh2");
      ra.push("  xác minh — K2 đếm đủ năm cho bậc 1 tỷ; ba người đầu được mời lại ở các gói nhỏ bên dưới.");
    }
    ra.push("");
    ra.push("LỊCH SỬ GIÁ (S4.4b) — ba gói đã mở niêm phong qua đường thật (niêm phong, nộp, đóng, mở thầu, worker giải mã), ba nhà");
    ra.push("  cung cấp mỗi gói, mỗi gói ba dòng nối với ba hàng chuẩn ở trên. Lịch sử chưa có màn riêng: người giữ bid.view đọc qua API");
    ra.push("  GET /items/<hàng chuẩn>/price-history; người quản lý dữ liệu không giữ bid.view nên bị từ chối (L3).");
    for (const g of daMo) ra.push(`  ${g.tieuDe.padEnd(24)} ${g.rfqId}`);
    for (const [ma, id] of hangChuanTheoMa) ra.push(`  ${ma.padEnd(24)} ${id}`);
    // [S1.260 / S4.5c1] Benchmark ở màn /mo-thau (spec S4 §4.6): ba gói trên là lịch sử của gói chính — đúng sàn 3 gói × 3 nhà cung
    // cấp của mẫu `NHOM_BENCHMARK_MAU` mà phiên bản 1 khai.
    ra.push("");
    ra.push("BENCHMARK (S4.5c1) — phiên bản 1 khai mẫu benchmark (12 tháng, sàn 3 gói / 3 nhà cung cấp, lệch 5% / 10%). Ba gói trên là");
    ra.push("  lịch sử nội bộ: khi gói chính được mở niêm phong, người giữ bid.view mở /mo-thau, bước 4, bấm «Đọc benchmark» — lần đọc");
    ra.push("  đầu tính và lưu nhãn từng dòng, «Xem dải» tính Q1/trung vị/Q3 của một dòng. Dòng bu lông neo còn ở hàng đợi ánh xạ nên ra");
    ra.push("  «không đo được» tới khi người quản lý dữ liệu duyệt nó TRƯỚC lần đọc đầu (bản lưu tính một lần cho mỗi lần mở thầu).");
    if (chiaNho.length > 0) {
      ra.push("");
      ra.push("TÍN HIỆU CHIA NHỎ (K10a) — nhóm hàng THEP-TAM: soan tạo và nộp ba gói 480 / 470 / 490 triệu trong cửa sổ 30 ngày, mỗi gói");
      ra.push("  dưới cận 1 tỷ mà tổng 1,44 tỷ chạm cận ấy. Hai gói đầu đã mở. Gói thứ ba soan2 đã duyệt nhưng CHƯA mở được: soan đọc gói");
      ra.push("  ở /tao-thau, bấm «Mở gói» thì bị chặn, và màn nói soan không tự ghi nhận được. soan3 đọc gói, ghi nhận tín hiệu kèm lý do;");
      ra.push("  rồi soan mở gói. Đăng nhập bằng link của người ấy ở trên, rồi mở /tao-thau — trang hỏi «Tiếp tục với phiên này».");
      for (const g of chiaNho) ra.push(`  ${`gói ${g.giaTri.slice(0, 3)} triệu`.padEnd(24)} ${g.id}`);
    }
    if (motNguon !== null) {
      ra.push("");
      ra.push("NGOẠI LỆ CẠNH TRANH (K2 + K5) — gói van điều áp 200 triệu, nhóm hàng MOT-NGUON, còn soạn thảo: soan đã mời MỘT nhà cung");
      ra.push("  cấp đếm được (nhapncc dựng, taichinh2 xác minh) mà bậc từ 100 triệu đòi ba. Ở /tao-thau, dán mã gói vào bước 2, bấm «Đọc»:");
      ra.push("  ⑴ soan bấm «Nộp duyệt» — bị chặn (K2), màn trỏ khối «Ngoại lệ cạnh tranh» ở bước 5;");
      ra.push("  ⑵ soan2 lập «Một nguồn duy nhất» kèm mã lý do và giải trình; ⑶ soan nộp duyệt — qua; soan2 «Phê duyệt»;");
      ra.push("  ⑷ soan bấm «Mở gói» — bị chặn (K5): người lập ngoại lệ không ký độc lập được cho chính gói ấy;");
      ra.push("  ⑸ soan3 «Phê duyệt», soan «Mở gói» — link mời đi tới nhà cung cấp (hộp thư dev).");
      ra.push("  Mỗi lần đổi người: đăng nhập bằng link của người ấy ở trên, rồi mở /tao-thau.");
      ra.push(`  ${"gói một nguồn".padEnd(24)} ${motNguon}`);
    }
    if (traoThau !== null) {
      ra.push("");
      ra.push("TRAO THẦU THEO BẬC (K7 + K2b + K5b, S3.5) — gói một tỷ, nhóm hàng TRAO-THAU, bậc 2: năm nhà cung cấp, HAI chữ ký của FINANCE/DIRECTOR.");
      ra.push(`  soan3 tạo, mời năm, nộp, mở, điều phối mở thầu; ${String(SO_NOP)} nhà cung cấp nộp (giá quanh 0,93 tỷ); worker đã mở; soan2 đã chấm — gói ở EVALUATING.`);
      ra.push("  Ở /mo-thau: dán mã gói vào bước 2, «Đọc»; bước 5 «Đọc bảng xếp hạng», «Chọn» ở hạng 1, gõ lý do; bước 7:");
      ra.push("  ⑴ soan2 «Đề xuất trao thầu» — bị chặn (K2b): bốn nhóm có báo giá hợp lệ, bậc đòi năm; màn trỏ khối «Ngoại lệ hậu kiểm»;");
      ra.push("  ⑵ soan2 «Xem ngoại lệ», lập «Cạnh tranh thực tế thấp» kèm mã lý do và giải trình; ⑶ soan2 đề xuất — qua; bảng nói «có 0 / cần 2»;");
      ra.push("  ⑷ duyet1 «Phê duyệt» hai lần (lần đầu chỉ hiện đề xuất) — đã ký, «có 1 / cần 2», đề xuất vẫn PROPOSED;");
      ra.push("  ⑸ duyet2 «Phê duyệt» — APPROVED. Thử sai: taichinh1 ký ⇒ từ chối có tên (K7, người khai phiên bản chính sách); taichinh2 (đã xác minh");
      ra.push("  nhà cung cấp thắng) ký được nhưng không đếm là độc lập — gói có ngoại lệ nên một trong hai chữ ký phải của người ngoài tập (K5b).");
      ra.push("  K9: công cụ đã khai «không xung đột» thay sáu người trên ở gói này (`khai-bao.ts`) — ai khác ký, chấm hay đề xuất thì tự khai ở khối");
      ra.push("  «Khai báo xung đột lợi ích» của /mo-thau (S3.4b) trước.");
      ra.push("  Mỗi lần đổi người: đăng nhập bằng link của người ấy ở trên (hai người tài chính dùng link /mo-thau dưới đây), rồi mở /mo-thau.");
      for (const nm of tokenNguoiMua.filter((n) => n.email.startsWith("taichinh"))) {
        ra.push(`  ${nm.email.padEnd(24)} ${gocWeb}/mo-thau#${org}:${nm.token}`);
      }
      ra.push(`  ${"gói trao thầu".padEnd(24)} ${traoThau.rfqId}`);
    }
    ra.push("");
    ra.push(`mã gói thầu để dán vào bước 2 của màn người mua: ${rfq}`);
    ra.push("");
    ra.push("Người SOẠN tạo yêu cầu mở thầu; HAI người DUYỆT phê duyệt. Người yêu cầu KHÔNG tự duyệt được.");
    if (S3) {
      // [S1.283 / S3.4b · K9] Bậc demo đòi khai báo xung đột lợi ích trước mọi bước quyết.
      ra.push("");
      ra.push("XUNG ĐỘT LỢI ÍCH (K9) — bậc demo đòi khai báo: trước «Phê duyệt», «Ghi nhận tín hiệu» (/tao-thau), «Chấm thầu»,");
      ra.push("  «Đề xuất», «Phê duyệt» hay «Huỷ trao thầu» (/mo-thau), mỗi người khai «không xung đột» ở khối «Khai báo xung đột lợi ích»");
      ra.push("  của gói — bấm trước thì máy chủ chặn (K9) và màn chỉ khối ấy. Công cụ đã khai thay đúng những chữ ký nó ghi thay: soan2,");
      ra.push("  soan3 ở gói chính; soan2 ở ba gói tín hiệu và ba gói đã mở. Danh sách mời đổi thì lời khai lỗi thời — khai lại.");
    }
    ra.push("Mã OTP của nhà cung cấp đi tới hộp thư dev (TRUSTPROCURE_DEV_MAILBOX_DIR của apps/api).");
    // `console.error` là dòng ra DUY NHẤT dự án cho phép (eslint `no-console`), và ở một công cụ
    // dev thì stderr cũng đúng chỗ: nó không lẫn vào thứ ai đó đem đi pipe.
    console.error(ra.join("\n"));
  } finally {
    await pool.end().catch(() => undefined);
  }
}

chinh().catch((e: unknown) => {
  console.error(`[gieo-demo] ${e instanceof Error ? `${e.name}: ${e.message}` : "loi khong ro"}`);
  process.exitCode = 1;
});
