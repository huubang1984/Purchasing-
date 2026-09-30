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

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createLocalDevOrgKeyProvisioner, MasterKeyRing } from "@trustprocure/crypto-keys";
import { migrate } from "@trustprocure/db";
import { khaiBiDanhHang, khaiQuyDoiRieng, taoHangChuan } from "@trustprocure/du-lieu-nen";
import { issueLoginToken } from "@trustprocure/identity";
import { createInvitation, danhDauDaGui, ducTokenKhiMoGoi, issueMagicLinkToken } from "@trustprocure/invitation";
import { createProcurementPolicy, kyPhienBanChinhSach, taoNhomHang } from "@trustprocure/rfq";
import { issueRfqKeyPair } from "@trustprocure/sealed-envelope";
import { withTenant } from "@trustprocure/tenancy";
import { BAC_DEMO, MUC_DEMO } from "./chinh-sach-demo.js";

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
  readonly biDanh: string;
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
    biDanh: "Bu long neo M24 cap 8.8",
    quyDoi: { tu: "bo", heSo: "1" },
  },
];

const NHA_CUNG_CAP: readonly string[] = ["Thep Dong Anh", "Kim khi Hai Phong", "Vat tu Truong Thanh"];
/**
 * [S1.174 / S3.1d] Gói demo 9 tỷ nằm ở bậc 2 của §4.1, và bậc ấy đòi NĂM nhà cung cấp (K2 — chưa cưỡng chế ở S3.1, nhưng
 * bối cảnh demo khai đúng số mà bậc của chính nó đòi, để lúc K2 có mặt nó không gãy ở bước mời).
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
  const gocWeb = process.env.TRUSTPROCURE_WEB_BASE?.trim() ?? "http://127.0.0.1:8090";
  const duoi = randomBytes(3).toString("hex");
  // Số điện thoại phải là SỐ: ràng buộc `supplier_contacts_phone_check` của 008 bác đuôi hex, và
  // nó bác ở lượt chạy thứ ba của script này.
  const soDienThoai = String(randomBytes(4).readUInt32BE(0) % 10000000).padStart(7, "0");

  const pool = new pg.Pool({ connectionString: url, max: 4 });
  try {
    await migrate(pool, MIGRATIONS_DIR);

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
    for (const ten of ["soan", "soan2", "soan3", "duyet1", "duyet2", "dulieu", ...(S3 ? ["taichinh1", "taichinh2"] : [])]) {
      const email = `${ten}.${duoi}@vidu.vn`;
      const hoTen = ten.startsWith("soan")
        ? `Nguoi soan goi thau ${ten.slice(4)}`.trim()
        : ten.startsWith("duyet")
          ? `Nguoi duyet ${ten.slice(-1)}`
          : ten === "dulieu" ? "Nguoi quan ly du lieu" : `Nguoi tai chinh ${ten.slice(-1)}`;
      const id = (await q<{ id: string }>(
        "INSERT INTO public.users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id",
        [org, email, hoTen],
      )).id;
      const vai = ten.startsWith("soan")
        ? "PROCUREMENT_MANAGER"
        : ten.startsWith("duyet") ? "DIRECTOR" : ten === "dulieu" ? "DATA_STEWARD" : "FINANCE";
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
        await khaiBiDanhHang(c, org, { hangChuanId: moi.id, biDanh: h.biDanh, actorSessionId: phienDuLieu });
        await khaiQuyDoiRieng(c, org, {
          hangChuanId: moi.id,
          tuDonVi: h.quyDoi.tu,
          sangDonVi: h.donViGoc,
          heSo: h.quyDoi.heSo,
          actorSessionId: phienDuLieu,
        });
      }
    });

    // [S1.174 / S3.1d] `--s3`: F1 khai phiên bản có bậc, F2 ký — hai giao dịch, hai phiên, đúng như hai người trên màn
    // `/chinh-sach`. Ngân sách phía dưới ghim chính phiên bản ấy: nó là bản hiệu lực ngay sau lần ký.
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
          "INSERT INTO public.org_procurement_policies (org_id, version, dual_approval_threshold, currency, created_by, created_by_session_id) " +
            "VALUES ($1, 1, '1000000000.00', 'VND', $2, $3) RETURNING id",
          [org, nguoiGieo, phienGieo],
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
    const taoNccVaMoi = async (c: pg.PoolClient): Promise<{ readonly ten: string; readonly invitationId: string }[]> => {
      const daMoi: { readonly ten: string; readonly invitationId: string }[] = [];
      for (const [i, ten] of [...NHA_CUNG_CAP, ...(S3 ? NHA_CUNG_CAP_THEM_S3 : [])].entries()) {
        const ncc = (await c.query<{ id: string }>(
          "INSERT INTO public.suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
          [org, `${ten} ${duoi}`, nguoiGieo, phienGieo],
        )).rows[0]?.id ?? "";
        const lh = (await c.query<{ id: string }>(
          "INSERT INTO public.supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
          [org, ncc, `Nguoi bao gia ${i + 1}`, `ncc${i + 1}.${duoi}@vidu.vn`, `09${soDienThoai}${i}`.slice(0, 10), nguoiGieo, phienGieo],
        )).rows[0]?.id ?? "";
        const lm = await createInvitation(c, org, {
          rfqId: rfq,
          supplierId: ncc,
          contactId: lh,
          linkChannel: "EMAIL",
          actorSessionId: phienGieo,
        }, pool);
        daMoi.push({ ten, invitationId: lm.id });
      }
      return daMoi;
    };
    const moiTruocKhiKy = S3 ? await withTenant(pool, org, taoNccVaMoi) : [];

    await pool.query(
      "UPDATE public.rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 " +
        "WHERE id OPERATOR(pg_catalog.=) $1",
      [rfq, nguoiGieo, phienGieo],
    );

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
        const t = await issueMagicLinkToken(c, org, { invitationId: lm.invitationId, actorSessionId: phienGieo });
        loiMoi.push({ ten: lm.ten, token: t.token });
      }
    });

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
    for (const nm of tokenNguoiMua.filter((n) => !n.email.startsWith("taichinh") && !n.email.startsWith("dulieu."))) {
      ra.push(`  ${nm.email.padEnd(24)} ${gocWeb}/mo-thau#${org}:${nm.token}`);
    }
    ra.push("");
    ra.push("QUẢN LÝ DỮ LIỆU — dulieu (DATA_STEWARD) ở /du-lieu: ba hàng chuẩn cho ba dòng của gói, mỗi hàng một bí danh là");
    ra.push("  nguyên mô tả dòng và một quy đổi riêng từ tấm / cây / bộ về đơn vị gốc — hệ số tính từ kích thước, không phải số đo.");
    ra.push("  Người mua khác mở /du-lieu chỉ xem được, và màn nói vì sao.");
    for (const nm of tokenNguoiMua.filter((n) => n.email.startsWith("dulieu."))) {
      ra.push(`  ${nm.email.padEnd(24)} ${gocWeb}/du-lieu#${org}:${nm.token}`);
    }
    if (S3) {
      ra.push("");
      ra.push("TÀI CHÍNH — taichinh1 đã khai, taichinh2 đã ký phiên bản 1 (bốn bậc mặc định §4.1, ngưỡng kép 1 tỷ): S3 ĐÃ BẬT.");
      ra.push("  Màn /chinh-sach đọc trọn ma trận và số người tối thiểu mỗi bậc. Ký một phiên bản MỚI ở màn ấy cần `api` chạy");
      ra.push("  với TRUSTPROCURE_S3_CHO_KY_CHINH_SACH=bat (ADR-105) — cờ ấy mặc định tắt, và không mở trên máy chủ thật.");
      for (const nm of tokenNguoiMua.filter((n) => n.email.startsWith("taichinh"))) {
        ra.push(`  ${nm.email.padEnd(24)} ${gocWeb}/chinh-sach#${org}:${nm.token}`);
      }
    }
    ra.push("");
    ra.push(`mã gói thầu để dán vào bước 2 của màn người mua: ${rfq}`);
    ra.push("");
    ra.push("Người SOẠN tạo yêu cầu mở thầu; HAI người DUYỆT phê duyệt. Người yêu cầu KHÔNG tự duyệt được.");
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
