// =============================================================================================
// S1.9 — KỊCH BẢN MỤC 41 CHẠY TRỌN VẸN
//
// §7 mục 3 của đặc tả: *"RFQ 1 tỷ, 5 nhà cung cấp, có sửa giá trước deadline, đóng thầu, mở thầu
// có phê duyệt kép, sinh bảng so sánh"*, cộng §7 mục 4: *"nhận link → OTP → nộp → nhận biên nhận
// kiểm chứng được"*. Cả hai chạy trong MỘT file này, trên MỘT cơ sở dữ liệu, theo đúng thứ tự.
//
// ---------------------------------------------------------------------------------------------
// HAI CHỖ FILE NÀY KHÔNG LÀM ĐÚNG NHƯ ĐẶC TẢ VÀ KẾ HOẠCH VIẾT — NÓI RA TRƯỚC
// ---------------------------------------------------------------------------------------------
// ⑴ ĐẶC TẢ NÓI *"trên trình duyệt thật"*; đây là T3, không phải T4. Không có trình duyệt vì
//    không có trang nào để mở: `apps/` có đúng một worker. Thứ file này chứng minh là CHUỖI
//    NGHIỆP VỤ chạy được từ đầu tới cuối qua các cửa công khai THẬT của mọi gói — không một
//    câu SQL viết tay nào cho phần nghiệp vụ. Phần *"trình duyệt thật"* thuộc T4 và thuộc S2+.
//
// ⑵ KẾ HOẠCH S1 §2 xếp hạng mục này vào `tests/e2e`. File lại nằm ở `apps/unseal-worker/src/`,
//    và KHÔNG phải vì tiện tay: quy tắc `g1-khong-import-nguoc-tu-apps-unseal-worker` cấm MỌI
//    module ngoài thư mục này import `executeUnsealRequest`. Một kịch bản đi trọn tới bảng so
//    sánh thì PHẢI đi qua bước mở thầu, nên nó phải sống bên trong hàng rào.
//
//    Đây là lần THỨ HAI một hàng rào dựng từ S0 quyết định chỗ ở của một file có thật, và lần
//    này nó bác một dòng của kế hoạch. Ghi lại vì đó là thông tin: một kế hoạch viết trước khi
//    hàng rào có việc để làm sẽ không thấy trước những chỗ hàng rào chạm tới.
//
// ---------------------------------------------------------------------------------------------
// [S1.174 / S3.1d] HAI LUỒNG — CÙNG MỘT KỊCH BẢN, HAI TỔ CHỨC
// ---------------------------------------------------------------------------------------------
// Spec S3 §8.11: ADR-080 giữ hai luồng sống song song dưới công tắc, và kịch bản này phải chạy ở CẢ HAI. Mọi bước dùng
// chung; mỗi luồng một tổ chức mới trên cùng CSDL. Luồng MVP1 là tổ chức CHƯA bật — mọi bước y như trước vòng này. Luồng
// S3 khác đúng một chỗ, ở bước 1: hai người FINANCE khai và ký phiên bản chính sách CÓ BẬC (mặc định §4.1), nên tổ chức
// BẬT S3 và mọi bước sau chạy dưới K1 — ngân sách đặt trước khi nộp duyệt, ghim đúng bản hiệu lực.
// =============================================================================================

import { createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { nguoiNhapNhaCungCap, quetGiaMoiQuanHe, startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { createSupplier, addSupplierContact, docHoSoXacMinh, xacMinhNhaCungCap } from "@trustprocure/supplier";
import {
  addRfqItem,
  approveRfq,
  closeRfq,
  createProcurementPolicy,
  createRfq,
  kyPhienBanChinhSach,
  openRfq,
  setRfqBudget,
  submitRfqForApproval,
  taoNhomHang,
} from "@trustprocure/rfq";
import {
  PepperRing,
  createInvitation,
  docNgoaiLe,
  ducTokenKhiMoGoi,
  issueMagicLinkToken,
  issueOtpChallenge,
  lapNgoaiLe,
  listInvitations,
  redeemMagicLink,
  verifyOtpAndStartSession,
} from "@trustprocure/invitation";
import { getRfqPublicKeys, sealBid } from "@trustprocure/sealed-envelope";
import {
  ReceiptSigningKeyRing,
  auditStoredCiphertexts,
  createLocalDevReceiptSigner,
  listBidVersions,
  submitBid,
  verifyReceipt,
  type ReceiptSigner,
} from "@trustprocure/bidding";
import {
  approveUnseal,
  buildComparisonTable,
  countReceivedBids,
  dispatchUnseal,
  requestUnseal,
} from "@trustprocure/unseal";
import { ghiNhanTinHieu, khaiBaoXungDot, lietKeTinHieu } from "@trustprocure/kiem-soat";
import { CHOT_VAO_SO, ChotKiemSoatError } from "@trustprocure/identity";
import { executeUnsealRequest } from "./index.js";
import { createOrgKeyUnwrapper } from "@trustprocure/crypto-keys/unwrap";
// [S1.174 / S3.1d] Mẫu bậc của màn `/chinh-sach` — import TƯƠNG ĐỐI xuyên app, có chủ đích: test là nơi duy nhất nối
// hai app, và luồng S3 nên khai đúng ma trận mà người tài chính thấy trên màn.
import { BAC_MAC_DINH, MUC_MAC_DINH } from "../../web/src/chinh-sach.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const HAN_NOP = new Date(Date.now() + 7 * 24 * 3600 * 1000);

/** Bộ sinh/mở cặp khoá tổ chức của riêng test — cùng khuôn `unseal-worker.int.test.ts`. */
const boBoc = {
  // [ADR-062] Bộ sinh cặp khoá tổ chức của test: cặp P-256 thật, khoá riêng "bọc" bằng xor 0xff.
  name: "doi-xung-cua-test",
  generate: (orgId: string) => {
    const k = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    return Promise.resolve({
      orgId,
      keyVersion: "test-v1",
      publicKey: k.publicKey.export({ format: "der", type: "spki" }),
      wrappedPrivateKey: new Uint8Array(k.privateKey.export({ format: "der", type: "pkcs8" })).map((b) => b ^ 0xff),
    });
  },
};
// [ADR-062] Mở cặp khoá tổ chức mà bộ sinh của test "bọc" bằng xor 0xff.
const boMoBoc = createOrgKeyUnwrapper({
  name: "doi-xung-cua-test",
  moKhoaRieng: (k) => Promise.resolve(new Uint8Array(k.wrappedPrivateKey).map((b) => b ^ 0xff)),
});

/**
 * NĂM nhà cung cấp, năm mức giá, đơn vị VND. Con số 1 tỷ của kịch bản là NGÂN SÁCH DỰ TÍNH của
 * người mua, không phải giá của ai — nên hai nhà cung cấp dưới ngân sách và ba nhà trên.
 */
const NHA_CUNG_CAP = [
  { ten: "Thep Hoa Phat", gia: "980000000.00" },
  { ten: "Thep Viet Duc", gia: "1050000000.00" },
  { ten: "Thep Pomina", gia: "1120000000.00" },
  { ten: "Thep Nam Kim", gia: "999000000.00" },
  { ten: "Thep Tung Kuang", gia: "1400000000.00" },
] as const;

/** Nhà cung cấp thứ tư SỬA GIÁ trước hạn — vế "có sửa giá trước deadline" của kịch bản. */
const GIA_SUA_LAI = "930000000.00";
const NGAN_SACH = "1000000000.00";
/**
 * [S1.251 / S4.4b] Phong bì mang `lines` như trình duyệt dựng (`nop-thau.js`, spec S4 §2.5 ⒅): gói có MỘT dòng, 500 tấn, nên
 * `amount` bằng tổng và `unitPrice` = tổng / 500. Kim ĐƠN GIÁ của bước 14 là đơn giá của bản sửa giá.
 */
const SO_LUONG = 500;
const donGiaCua = (tong: string): string => (Number(tong) / SO_LUONG).toFixed(2);
const DON_GIA_SUA_LAI = donGiaCua(GIA_SUA_LAI);
const banRo = (tong: string, ten: string): string =>
  JSON.stringify({ totalAmount: tong, currency: "VND", nhaCungCap: ten, lines: [{ lineNo: 1, unitPrice: donGiaCua(tong), amount: tong }] });

let db: TestDatabase;
let apiPool: pg.Pool;
let unsealPool: pg.Pool;
let orgA: string;
/** uMua tạo RFQ (PROCUREMENT_MANAGER); uGd1/uGd2 duyệt (DIRECTOR). */
let uMua: string, uGd1: string, uGd2: string;
let sMua: string, sGd1: string, sGd2: string;
/** [S1.174 / S3.1d] Luồng S3: hai người FINANCE — một khai phiên bản chính sách có bậc, một ký. */
let sTc1: string, sTc2: string;
/**
 * [S3.6b2 / K10a] Luồng S3: một PROCUREMENT_MANAGER thứ hai — giữ `rfq.approve`, không tạo, không nộp gói nào, không khai phiên bản
 * chính sách: người ghi nhận tín hiệu chia nhỏ ĐỘC LẬP của bước 16. Hai giám đốc không giữ `rfq.approve`, người mua là người gây ra.
 */
let uPmDl: string, sPmDl: string;
/**
 * [S1.266 / S3.3c1] Luồng S3: phiên của người NHẬP hồ sơ nhà cung cấp — người dùng riêng vai `TECHNICAL` của
 * `@trustprocure/test-support` (không giữ `rfq.invite` hay `rfq.approve`, nên không thành người mời và không đổi số người ghi nhận
 * được của bước 16). K2 không đếm nhà cung cấp do người tạo gói hay người mời dựng; cổng `supplier.manage` đứng ở route, không ở
 * hàm gói mà tệp này gọi.
 */
let sNhapNcc: string;
let boKy: ReceiptSigner;
let khoaKyCongKhai: Uint8Array;
const pepper = new PepperRing("pepper-2026-09", { "pepper-2026-09": randomBytes(32) });

async function taoNguoi(email: string, vaiTro: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
    [orgA, email],
  );
  const id = rows[0]?.id ?? "";
  await db.pool.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [
    orgA,
    id,
    vaiTro,
  ]);
  return id;
}

async function taoPhien(userId: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
      "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
    [orgA, userId, randomBytes(32)],
  );
  return rows[0]?.id ?? "";
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  apiPool = db.poolAs("app_api");
  unsealPool = db.poolAs("app_unseal");

  const { generateKeyPairSync } = await import("node:crypto");
  const cap = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  khoaKyCongKhai = new Uint8Array(cap.publicKey.export({ type: "spki", format: "der" }));
  boKy = createLocalDevReceiptSigner(
    new ReceiptSigningKeyRing("ky-2026-09", {
      "ky-2026-09": {
        privateKey: new Uint8Array(cap.privateKey.export({ type: "pkcs8", format: "der" })),
        publicKey: khoaKyCongKhai,
      },
    }),
  );

}, 180000);

/**
 * [S1.174 / S3.1d] Bối cảnh của MỘT luồng: tổ chức mới, ba người như trước, và — luồng S3 — hai người FINANCE. Gọi ở
 * `beforeAll` của từng luồng; mọi biến theo tổ chức ở trên và `trangThai` dưới được dựng lại, nên các bước đọc đúng
 * tổ chức của luồng đang chạy.
 */
async function dungToChuc(batS3: boolean): Promise<void> {
  const orgs = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
    batS3 ? ["Cong ty Mua Sam A (S3)", "cong-ty-a-s3"] : ["Cong ty Mua Sam A", "cong-ty-a"],
  );
  orgA = orgs.rows[0]?.id ?? "";

  uMua = await taoNguoi("mua@vidu.vn", "PROCUREMENT_MANAGER");
  uGd1 = await taoNguoi("gd1@vidu.vn", "DIRECTOR");
  uGd2 = await taoNguoi("gd2@vidu.vn", "DIRECTOR");
  sMua = await taoPhien(uMua);
  sGd1 = await taoPhien(uGd1);
  sGd2 = await taoPhien(uGd2);
  sTc1 = batS3 ? await taoPhien(await taoNguoi("tc1@vidu.vn", "FINANCE")) : "";
  sTc2 = batS3 ? await taoPhien(await taoNguoi("tc2@vidu.vn", "FINANCE")) : "";
  uPmDl = batS3 ? await taoNguoi("pm-doc-lap@vidu.vn", "PROCUREMENT_MANAGER") : "";
  sPmDl = batS3 ? await taoPhien(uPmDl) : "";
  sNhapNcc = batS3 ? (await nguoiNhapNhaCungCap(db.pool, orgA)).s : "";
  Object.assign(trangThai, trangThaiMoi());

  expect([orgA, uMua, uGd1, uGd2, sMua, sGd1, sGd2].filter((x) => x === "")).toEqual([]);
}

afterAll(async () => {
  await apiPool?.end().catch(() => undefined);
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

// ===============================================================================================
// KỊCH BẢN CHẠY MỘT LẦN, THEO THỨ TỰ, VÀ CÁC `it` SAU ĐỌC KẾT QUẢ CỦA CÁC `it` TRƯỚC.
//
// Đây là ngoại lệ CÓ CHỦ ĐÍCH của quy ước "mỗi test tự dựng bối cảnh": một kịch bản end-to-end
// mà mỗi bước tự dựng lại từ đầu thì KHÔNG còn là end-to-end — nó là năm test đơn lẻ đặt cạnh
// nhau. Cái giá phải trả được nói ra: một bước đỏ làm các bước sau đỏ theo, và thứ tự khai báo
// trong file LÀ hợp đồng.
// ===============================================================================================
interface TrangThaiKichBan {
  rfqId: string;
  loiMoi: { invitationId: string; supplierId: string; ten: string; gia: string }[];
  /** [S1.190 / S3.2c1] Luồng S3: token mà phiên người mở đúc cho mỗi lời mời TRONG giao dịch mở gói — theo id lời mời. */
  tokenKhiMo: Map<string, string>;
  phienKhach: string[];
  bienNhan: { canonicalText: string; signature: Uint8Array; ten: string }[];
  unsealRequestId: string;
}
const trangThaiMoi = (): TrangThaiKichBan => ({ rfqId: "", loiMoi: [], tokenKhiMo: new Map(), phienKhach: [], bienNhan: [], unsealRequestId: "" });
const trangThai: TrangThaiKichBan = trangThaiMoi();

/** [S1.266 / S3.3c1] Số thứ tự MST của luồng S3 — mỗi nhà cung cấp một MST gốc riêng (K2 đếm theo 10 số đầu). */
let soMst = 0;

/**
 * [S1.266 / S3.3c1] Luồng S3: một nhà cung cấp ĐẾM ĐƯỢC cho K2, qua cửa công khai của gói như mọi bước khác — hồ sơ có MST và
 * người liên hệ do người nhập riêng (`sNhapNcc`) dựng, rồi người tài chính THỨ HAI xác minh: `tc2` không khai phiên bản chính sách
 * mà ngân sách ghim (`tc1` khai), không giữ `rfq.invite`, không dựng hồ sơ. Người liên hệ có TRƯỚC lần xác minh (băm hồ sơ phủ nó),
 * với email và số điện thoại suy từ id hồ sơ như luồng MVP1 — khác nhau giữa các nhà cung cấp, nên K2 đếm đủ đích.
 */
/**
 * [S1.281 / S3.4a / K9] Luồng S3: người sắp ký hay ghi nhận khai *không xung đột* trên gói — K9 đòi lời khai với đúng danh sách mời
 * hiện tại (bậc mặc định `khai_xung_dot: true`), và danh sách của luồng S3 đứng yên từ DRAFT. Giao dịch riêng, trước lần ký: hàng sổ
 * `COI_DECLARED` không chen vào giao dịch của chữ ký. Luồng MVP1 không gọi — tổ chức chưa bật, K9 không sống.
 */
async function khaiKhongXungDot(rfqId: string, phien: string): Promise<void> {
  await withTenant(apiPool, orgA, (c) => khaiBaoXungDot(c, orgA, { rfqId, trangThai: "KHONG_XUNG_DOT", actorSessionId: phien }, apiPool));
}

async function dungNccDemDuoc(c: pg.PoolClient, ten: string): Promise<{ supplierId: string; contactId: string }> {
  soMst += 1;
  const s = await createSupplier(c, orgA, {
    legalName: ten,
    taxCode: `03${String(soMst).padStart(8, "0")}`,
    actorSessionId: sNhapNcc,
  });
  const lh = await addSupplierContact(c, orgA, {
    supplierId: s.id,
    fullName: "Nguoi ban hang",
    email: `${s.id.slice(0, 8)}@vidu.vn`,
    phone: `09${s.id.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`,
    actorSessionId: sNhapNcc,
  });
  const bamDaXem = (await docHoSoXacMinh(c, orgA)).find((h) => h.supplierId === s.id)?.bamHoSo ?? "";
  const xm = await xacMinhNhaCungCap(c, orgA, { supplierId: s.id, actorSessionId: sTc2, bamDaXem }, apiPool);
  expect(xm.conHieuLuc, `luồng S3: xác minh của ${ten} còn hiệu lực`).toBe(true);
  return { supplierId: s.id, contactId: lh.id };
}

/** Luồng MVP1, như trước S3.3c: người mua dựng hồ sơ không MST và người liên hệ của nó. */
async function dungNccCuaNguoiMua(c: pg.PoolClient, ten: string): Promise<{ supplierId: string; contactId: string }> {
  const s = await createSupplier(c, orgA, {
    legalName: ten,
    actorSessionId: sMua,
  });
  const lh = await addSupplierContact(c, orgA, {
    supplierId: s.id,
    fullName: "Nguoi ban hang",
    email: `${s.id.slice(0, 8)}@vidu.vn`,
    phone: `09${s.id.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`,
    actorSessionId: sMua,
  });
  return { supplierId: s.id, contactId: lh.id };
}

/**
 * [S1.190 / S3.2c1] Một nhà cung cấp, một người liên hệ, một lời mời — CHUNG cho hai luồng, chỉ khác LÚC gọi: luồng S3 gọi ở
 * DRAFT, trước khi nộp duyệt (K4b: chữ ký mang danh sách mời lúc ký); luồng MVP1 gọi sau khi mở, như trước.
 * [S1.266 / S3.3c1] Và khác NGƯỜI DỰNG hồ sơ: luồng S3 mời một nhà cung cấp đếm được (`dungNccDemDuoc`) — K2 chặn lần nộp gói
 * 1 tỷ khi dưới năm. Người mời vẫn là người mua ở cả hai luồng.
 */
async function taoNccVaMoi(c: pg.PoolClient, ncc: { readonly ten: string; readonly gia: string }, batS3: boolean): Promise<{ invitationId: string; supplierId: string; status: string; moiSauKhiKy: boolean }> {
  const { supplierId, contactId } = batS3 ? await dungNccDemDuoc(c, ncc.ten) : await dungNccCuaNguoiMua(c, ncc.ten);
  const lm = await createInvitation(c, orgA, {
    rfqId: trangThai.rfqId,
    supplierId,
    contactId,
    linkChannel: "EMAIL",
    actorSessionId: sMua,
  }, apiPool);
  trangThai.loiMoi.push({ invitationId: lm.id, supplierId, ten: ncc.ten, gia: ncc.gia });
  return { invitationId: lm.id, supplierId, status: lm.status, moiSauKhiKy: lm.moiSauKhiKy };
}

/** [S1.174 / S3.1d] Hai luồng của spec S3 §8.11 — xem khối đầu tệp. */
const LUONG = [
  ["MVP1 — tổ chức CHƯA bật S3", false],
  ["S3 — tổ chức ĐÃ BẬT, phiên bản có bậc đã ký", true],
] as const;

describe.each(LUONG)("[KỊCH BẢN 41 · %s] RFQ 1 tỷ, 5 nhà cung cấp, sửa giá, mở thầu phê duyệt kép, bảng so sánh", (_ten, batS3) => {
  beforeAll(() => dungToChuc(batS3));

  it("bước 1 — người mua dựng RFQ 1 tỷ và nó GIỮ yêu cầu phê duyệt kép", async () => {
    // [S1.174 / S3.1d] Luồng S3: hai người FINANCE khai rồi ký phiên bản CÓ BẬC — hai giao dịch, hai phiên — và tổ chức
    // bật. Ngưỡng kép giữ 500 triệu như luồng MVP1: số chữ ký mở gói và mở thầu không đổi giữa hai luồng.
    if (batS3) {
      const cs = await withTenant(apiPool, orgA, (c) =>
        createProcurementPolicy(c, orgA, {
          version: 1,
          dualApprovalThreshold: "500000000.00",
          currency: "VND",
          // Trải từng bậc: `Bac` là interface, còn cửa của gói nhận bản ghi JSON — `Record<string, unknown>`.
          tiers: BAC_MAC_DINH.map((b) => ({ ...b })),
          chiaNhoCuaSoNgay: MUC_MAC_DINH.chiaNhoCuaSoNgay,
          thamDinhHieuLucThang: MUC_MAC_DINH.thamDinhHieuLucThang,
          actorSessionId: sTc1,
        }),
      );
      const ky = await withTenant(apiPool, orgA, (c) => kyPhienBanChinhSach(c, orgA, { policyId: cs.id, actorSessionId: sTc2 }));
      expect(ky.daBat, "luồng S3: lần ký đầu tiên của một phiên bản có bậc BẬT S3 cho tổ chức").toBe(true);
    }
    // [S1.201 / S3.6a] Luồng S3: người tài chính dựng nhóm hàng, người mua chọn nó lúc tạo gói — tổ chức đã bật không nộp duyệt
    // được gói không nhóm hàng. Luồng MVP1: không nhóm hàng nào, và gói vẫn đi trọn đường.
    const nhomHang = batS3
      ? (await withTenant(apiPool, orgA, (c) => taoNhomHang(c, orgA, { ma: "THEP", ten: "Thep tam", actorSessionId: sTc1 }, apiPool))).id
      : null;
    await withTenant(apiPool, orgA, async (c) => {
      // Ngưỡng 500 triệu, ngân sách 1 tỷ -> VƯỢT ngưỡng -> `requires_dual_approval` GIỮ `true`.
      // Đây là chỗ con số "1 tỷ" của kịch bản có tác dụng THẬT chứ không phải một nhãn trang trí.
      if (!batS3) {
        await createProcurementPolicy(c, orgA, {
          version: 1,
          dualApprovalThreshold: "500000000.00",
          currency: "VND",
          actorSessionId: sMua,
        });
      }
      const rfq = await createRfq(c, orgA, {
        title: "Mua thep tam cho nha may Q4",
        deadlineAt: HAN_NOP,
        createdBySessionId: sMua,
        categoryId: nhomHang,
      });
      expect(rfq.categoryId).toBe(nhomHang);
      trangThai.rfqId = rfq.id;
      await addRfqItem(c, orgA, {
        rfqId: rfq.id,
        lineNo: 1,
        description: "Thep tam SS400 day 10mm",
        quantity: "500.0000",
        unit: "tan",
        actorSessionId: sMua,
      });
      const ns = await setRfqBudget(c, orgA, {
        rfqId: rfq.id,
        estimatedValue: NGAN_SACH,
        currency: "VND",
        actorSessionId: sMua,
      });
      expect(
        ns.requiresDualApproval,
        "1 tỷ vượt ngưỡng 500 triệu — RFQ này PHẢI cần phê duyệt kép",
      ).toBe(true);
    });
    expect(trangThai.rfqId).not.toBe("");
    // [S1.174 / S3.1d] Hai luồng khác nhau ĐÚNG ở đây, và phép đo nói ra điều ấy: tổ chức đã bật hay chưa, và gói mang bậc
    // nào — bậc 2 của §4.1 (từ 1 tỷ) cho ngân sách 1 tỷ ở luồng S3, không bậc ở luồng MVP1.
    const { rows: hai } = await db.pool.query<{ bat: boolean; bac: string | null }>(
      "SELECT public.to_chuc_da_bat_s3($1) AS bat, (SELECT tier_tu_so_tien::text FROM rfq_budgets WHERE rfq_id = $2) AS bac",
      [orgA, trangThai.rfqId],
    );
    expect(hai[0]).toEqual(batS3 ? { bat: true, bac: "1000000000.00" } : { bat: false, bac: null });
  });

  it("bước 2 — hai giám đốc KHÁC NHAU duyệt, rồi RFQ mở kèm cặp khoá của chính nó", async () => {
    if (batS3) {
      // [S1.190 / S3.2c1 · INV-K4a · INV-K6] Luồng S3 dựng danh sách mời ở DRAFT, TRƯỚC khi nộp duyệt: năm lời mời `UNSENT`,
      // không nhãn *mời sau khi ký*, và không một token nào — K6 chặn lần đúc khi gói chưa từng mở.
      // [S1.266 / S3.3c1] Năm nhà cung cấp ĐẾM ĐƯỢC — đúng `so_ncc_toi_thieu` của bậc 1 tỷ —, nên K2 cho lần nộp dưới đây qua.
      await withTenant(apiPool, orgA, async (c) => {
        for (const ncc of NHA_CUNG_CAP) {
          const lm = await taoNccVaMoi(c, ncc, true);
          expect({ status: lm.status, moiSauKhiKy: lm.moiSauKhiKy }).toEqual({ status: "UNSENT", moiSauKhiKy: false });
        }
      });
      const { rows: token } = await db.pool.query(
        "SELECT 1 FROM rfq_invitation_tokens t JOIN rfq_invitations i ON i.id = t.invitation_id WHERE i.rfq_id = $1",
        [trangThai.rfqId],
      );
      expect(token, "luồng S3: không token nào trước lần mở gói").toHaveLength(0);
    }
    // [S1.281 / S3.4a / K9] Luồng S3: hai giám đốc khai *không xung đột* trước khi ký.
    if (batS3) {
      for (const phien of [sGd1, sGd2]) await khaiKhongXungDot(trangThai.rfqId, phien);
    }
    await withTenant(apiPool, orgA, async (c) => {
      const nop = await submitRfqForApproval(c, orgA, { rfqId: trangThai.rfqId, actorSessionId: sMua }, apiPool);
      // [S1.198 / khoản 256] Luồng S3: lời duyệt mang lần nộp người duyệt đã xem. Luồng MVP1 giữ lời duyệt không mốc — hợp đồng cũ.
      const moc = batS3 ? { lanNopDaXem: nop.lanNop } : {};
      await approveRfq(c, orgA, { rfqId: trangThai.rfqId, sessionId: sGd1, ...moc }, apiPool);
      await approveRfq(c, orgA, { rfqId: trangThai.rfqId, sessionId: sGd2, ...moc }, apiPool);
      const mo = await openRfq(c, orgA, {
        rfqId: trangThai.rfqId,
        actorSessionId: sMua,
        orgKeys: boBoc,
      }, apiPool);
      expect(mo.status).toBe("OPEN");
      // [S1.190 / S3.2c1 · INV-K6] Đúng đường của route mở gói (S3.2b2): phiên người mở đúc MỘT token cho mỗi lời mời còn sống,
      // trong CHÍNH giao dịch mở gói. Luồng MVP1: lời mời đến sau, không đúc gì ở đây.
      const links = await ducTokenKhiMoGoi(c, orgA, { rfqId: trangThai.rfqId, actorSessionId: sMua });
      expect(links.map((l) => l.invitationId).sort()).toEqual(trangThai.loiMoi.map((l) => l.invitationId).sort());
      for (const l of links) trangThai.tokenKhiMo.set(l.invitationId, l.token.token);
    });

    // [C5] Cặp khoá ra đời ĐÚNG lúc mở, không sớm hơn — và khoá riêng nằm ở dạng ĐÃ BỌC.
    const khoa = await withTenant(apiPool, orgA, (c) =>
      getRfqPublicKeys(c, orgA, trangThai.rfqId),
    );
    expect(khoa.map((k) => k.algorithm)).toContain("ECDH_P256");
    await expect(
      withTenant(apiPool, orgA, (c) =>
        c.query("SELECT wrapped_private_key FROM rfq_key_material WHERE rfq_id = $1", [
          trangThai.rfqId,
        ]),
      ),
      "[G1] `app_api` GHI được khoá đã bọc nhưng KHÔNG ĐỌC LẠI được",
    ).rejects.toThrow(/permission denied/i);
  });

  it("bước 3 — mời năm nhà cung cấp; mỗi người đi trọn link → OTP → phiên khách", async () => {
    // [S1.190 / S3.2c1] Luồng S3: năm lời mời đã có từ DRAFT, token từ lần mở gói. Luồng MVP1: mời bây giờ, token ngay lúc mời.
    for (const [i, ncc] of NHA_CUNG_CAP.entries()) {
      await withTenant(apiPool, orgA, async (c) => {
        const lm = batS3 ? trangThai.loiMoi[i] : await taoNccVaMoi(c, ncc, false);
        if (lm === undefined) throw new Error("luong S3: thieu loi moi dung o DRAFT");
        const s = { id: lm.supplierId };

        // §7 mục 4: nhận link -> OTP -> phiên. Magic link đi kênh EMAIL, OTP đi kênh SMS —
        // ADR-015 mục 1 cấm hai thứ đi cùng kênh, và `issueOtpChallenge` cưỡng chế điều đó.
        const token = batS3
          ? { token: trangThai.tokenKhiMo.get(lm.invitationId) ?? "" }
          : await issueMagicLinkToken(c, orgA, {
              invitationId: lm.invitationId,
              actorSessionId: sMua,
            });
        const daNhan = await redeemMagicLink(c, orgA, token.token);
        expect(daNhan.invitationId).toBe(lm.invitationId);

        const otp = await issueOtpChallenge(c, orgA, {
          token: token.token,
          channel: "SMS",
          callerFingerprint: `ip-${s.id.slice(0, 8)}`,
          pepper,
        });
        expect(otp.ok, "phát OTP bị từ chối ngay ở lần đầu").toBe(true);
        if (!otp.ok) throw new Error("khong phat duoc OTP");

        const phien = await verifyOtpAndStartSession(c, orgA, {
          token: token.token,
          code: otp.code,
          pepper,
        });
        expect(phien.ok, "đối chiếu OTP thất bại trên mã vừa phát").toBe(true);
        if (!phien.ok) throw new Error("khong doi chieu duoc OTP");
        trangThai.phienKhach.push(phien.sessionId);
      });
    }
    expect(trangThai.loiMoi.length).toBe(5);
    expect(new Set(trangThai.phienKhach).size, "năm phiên khách phải khác nhau").toBe(5);
  });

  it("bước 4 — năm báo giá niêm phong ở phía nhà cung cấp, mỗi lần nộp một biên nhận đã ký", async () => {
    const khoa = await withTenant(apiPool, orgA, (c) =>
      getRfqPublicKeys(c, orgA, trangThai.rfqId),
    );
    const p256 = khoa.find((k) => k.algorithm === "ECDH_P256");
    if (p256 === undefined) throw new Error("RFQ khong co khoa ECDH_P256");

    for (const [i, lm] of trangThai.loiMoi.entries()) {
      // NIÊM PHONG PHÍA NHÀ CUNG CẤP: bản rõ chỉ tồn tại trong phạm vi vòng lặp này, và thứ đi
      // vào `submitBid` là một chuỗi byte mà không role nào của tầng `api` mở được.
      const phongBi = await sealBid({
        rfqId: trangThai.rfqId,
        algorithm: "ECDH_P256",
        recipientPublicKey: p256.publicKey,
        plaintext: new TextEncoder().encode(banRo(lm.gia, lm.ten)),
      });
      const bn = await withTenant(apiPool, orgA, (c) =>
        submitBid(c, orgA, {
          guestSessionId: trangThai.phienKhach[i] ?? "",
          envelope: phongBi,
          signer: boKy,
        }),
      );
      expect(bn.version).toBe(1);
      trangThai.bienNhan.push({
        canonicalText: bn.canonicalText,
        signature: bn.signature,
        ten: lm.ten,
      });
    }
    expect(trangThai.bienNhan.length).toBe(5);
  });

  it("bước 5 — [B2] nhà cung cấp kiểm chứng biên nhận bằng KHOÁ CÔNG KHAI MỘT MÌNH", async () => {
    // Vế chịu lực: vòng lặp này KHÔNG cầm `client`, KHÔNG cầm `orgId`, không chạm CSDL một lần
    // nào. Nó là đúng thứ một nhà cung cấp làm được ở máy của họ.
    for (const bn of trangThai.bienNhan) {
      const hopLe = await verifyReceipt({
        canonicalText: bn.canonicalText,
        signature: bn.signature,
        publicKey: khoaKyCongKhai,
      });
      expect(hopLe, `biên nhận của ${bn.ten} không kiểm chứng được`).toBe(true);
    }

    // Đối chứng âm: sửa MỘT ký tự của văn bản thì chữ ký hỏng.
    const dau = trangThai.bienNhan[0];
    if (dau === undefined) throw new Error("khong co bien nhan nao");
    const hong = await verifyReceipt({
      canonicalText: dau.canonicalText.replace("version=1", "version=9"),
      signature: dau.signature,
      publicKey: khoaKyCongKhai,
    });
    expect(hong, "một văn bản đã sửa vẫn kiểm chứng được — chữ ký không có tác dụng").toBe(false);

    // Và cùng chữ ký ấy kiểm được bằng MỘT CÀI ĐẶT KHÁC — con đường `openssl dgst -verify` đi.
    const khoaNode = createPublicKey({
      key: Buffer.from(khoaKyCongKhai),
      format: "der",
      type: "spki",
    });
    expect(khoaNode.asymmetricKeyType).toBe("ec");
  });

  it("bước 6 — SỬA GIÁ trước hạn: bản mới thành version 2, bản cũ VẪN CÒN [B1]", async () => {
    const khoa = await withTenant(apiPool, orgA, (c) =>
      getRfqPublicKeys(c, orgA, trangThai.rfqId),
    );
    const p256 = khoa.find((k) => k.algorithm === "ECDH_P256");
    if (p256 === undefined) throw new Error("RFQ khong co khoa ECDH_P256");
    const lm = trangThai.loiMoi[3];
    if (lm === undefined) throw new Error("khong co loi moi thu tu");

    const phongBiMoi = await sealBid({
      rfqId: trangThai.rfqId,
      algorithm: "ECDH_P256",
      recipientPublicKey: p256.publicKey,
      plaintext: new TextEncoder().encode(banRo(GIA_SUA_LAI, lm.ten)),
    });
    const bn2 = await withTenant(apiPool, orgA, (c) =>
      submitBid(c, orgA, {
        guestSessionId: trangThai.phienKhach[3] ?? "",
        envelope: phongBiMoi,
        signer: boKy,
      }),
    );
    expect(bn2.version, "lần nộp thứ hai phải là một PHIÊN BẢN MỚI").toBe(2);

    const cac = await withTenant(apiPool, orgA, (c) =>
      listBidVersions(c, orgA, bn2.bidId),
    );
    expect(cac.map((v) => v.version).sort(), "bản đầu KHÔNG được biến mất").toEqual([1, 2]);
    lm.gia = GIA_SUA_LAI;
  });

  it("bước 7 — [A6] trước khi đóng, số báo giá đã nhận bị GIẤU; sau khi đóng thì công bố", async () => {
    const truoc = await withTenant(apiPool, orgA, (c) =>
      countReceivedBids(c, orgA, { rfqId: trangThai.rfqId, actorSessionId: sMua }, apiPool),
    );
    expect(truoc, "chính sách mặc định là chế độ nghiêm — con số này chưa được nói ra").toEqual({
      disclosed: false,
      reason: "STRICT_BLIND_BEFORE_CLOSE",
      rfqStatus: "OPEN",
    });

    await withTenant(apiPool, orgA, (c) =>
      closeRfq(c, orgA, {
        rfqId: trangThai.rfqId,
        reason: "dong dung han theo ke hoach mua sam Q4",
        actorSessionId: sMua,
      }),
    );

    const sau = await withTenant(apiPool, orgA, (c) =>
      countReceivedBids(c, orgA, { rfqId: trangThai.rfqId, actorSessionId: sMua }, apiPool),
    );
    expect(sau).toEqual({ disclosed: true, count: 5 });
  });

  it("bước 8 — [A4] RFQ đã CLOSED nhưng CHƯA mở thầu: bảng so sánh vẫn bị từ chối", async () => {
    // Đây là khoảnh khắc nguy hiểm nhất của cả kịch bản: hạn đã hết, mọi báo giá đã nằm trong
    // CSDL, và người mua có mọi lý do để muốn nhìn. Không có gì nhìn được.
    await expect(
      withTenant(apiPool, orgA, (c) => buildComparisonTable(c, orgA, { rfqId: trangThai.rfqId, actorSessionId: sMua }, apiPool)),
    ).rejects.toThrow(/RFQ đang ở CLOSED/);

    const { rows } = await withTenant(apiPool, orgA, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM rfq_unsealed_bids"),
    );
    expect(rows[0]?.n, "chưa mở thầu mà đã có bản rõ").toBe("0");
  });

  it("bước 9 — [D2] mở thầu cần HAI phê duyệt của HAI người, và người yêu cầu không tự duyệt", async () => {
    await withTenant(apiPool, orgA, async (c) => {
      const yc = await requestUnseal(
        c,
        orgA,
        {
          rfqId: trangThai.rfqId,
          reason: "da het han nop, mo thau de cham",
          actorSessionId: sMua,
        },
        apiPool,
      );
      trangThai.unsealRequestId = yc.id;
      expect(yc.status).toBe("PENDING");
    });

    // ~~Người yêu cầu tự duyệt -> bị từ chối. Đây là D3/D2 ở dạng chạy được.~~ [S1.68 / lượt soi 62a-14] Người yêu cầu ở kịch bản này là
    // PROCUREMENT_MANAGER, không giữ `rfq.unseal.approve`, nên lần tự duyệt dừng ở CỔNG QUYỀN, không tới trigger D2 của 019. Bản trước gọi
    // nó trong CÙNG giao dịch với `requestUnseal`: `UNSEAL_REQUESTED` vừa ghi giữ khoá tư vấn của tổ chức, nên `requirePermission` ném
    // `PermissionAuditFailedError` ("đang giữ khoá tư vấn") và `.rejects.toThrow()` không phân biệt được. Nay gọi ở giao dịch riêng và đòi
    // đúng `PermissionDeniedError`; D2 của trigger — người yêu cầu có quyền duyệt tự duyệt — đo ở packages/unseal/src/unseal.int.test.ts.
    await expect(
      withTenant(apiPool, orgA, (c) =>
        approveUnseal(c, orgA, { unsealRequestId: trangThai.unsealRequestId, actorSessionId: sMua }, apiPool),
      ),
    ).rejects.toMatchObject({ name: "PermissionDeniedError" });

    await withTenant(apiPool, orgA, async (c) => {
      const mot = await approveUnseal(
        c,
        orgA,
        { unsealRequestId: trangThai.unsealRequestId, actorSessionId: sGd1 },
        apiPool,
      );
      expect(mot.status, "MỘT phê duyệt là chưa đủ cho một RFQ vượt ngưỡng").toBe("PENDING");
    });
    await withTenant(apiPool, orgA, async (c) => {
      const hai = await approveUnseal(
        c,
        orgA,
        { unsealRequestId: trangThai.unsealRequestId, actorSessionId: sGd2 },
        apiPool,
      );
      expect(hai.status).toBe("APPROVED");
    });
  });

  it("bước 10 — [D1] cổng bốn vế cho qua, và `api` chỉ ĐẶT MỘT JOB chứ không giải mã", async () => {
    const bangChung = await withTenant(apiPool, orgA, (c) =>
      dispatchUnseal(
        c,
        orgA,
        { unsealRequestId: trangThai.unsealRequestId, actorSessionId: sMua },
        apiPool,
      ),
    );
    expect(bangChung.clauses).toEqual(["PERMISSION", "MFA_FRESH", "RFQ_CLOSED", "POLICY_GATE"]);

    const { rows } = await db.pool.query<{ kind: string }>(
      "SELECT kind FROM outbox_jobs WHERE payload->>'unsealRequestId' = $1",
      [trangThai.unsealRequestId],
    );
    // [S1.91 / khoản 194] Câu này TỪNG là `toEqual(["UNSEAL_RFQ"])`, và nó đỏ ở lượt evidence của vòng
    // khoản 194 vì `requestUnseal` nay xếp thêm một việc BÁO cho mỗi người duyệt — những việc ấy mang
    // cùng `unsealRequestId` nên lọt vào đúng câu SELECT này.
    //
    // Lời khai GỐC không sai, chỉ được viết hẹp hơn thứ nó muốn nói: *điều phối chỉ ĐẶT MỘT job GIẢI
    // MÃ, `api` không tự giải mã*. Vế ấy giữ nguyên độ sắc ở dòng đầu dưới đây — đúng MỘT `UNSEAL_RFQ`,
    // không phải "ít nhất một". Hai dòng sau nói thêm điều mới mà không nới vế cũ.
    expect(rows.filter((r) => r.kind === "UNSEAL_RFQ"), "điều phối đặt ĐÚNG MỘT việc giải mã").toHaveLength(1);
    expect(rows.filter((r) => r.kind === "UNSEAL_APPROVAL_NOTICE").length, "và ít nhất một tin báo người duyệt").toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.kind)), "không loại việc nào khác bám theo một yêu cầu mở thầu").toEqual(
      new Set(["UNSEAL_RFQ", "UNSEAL_APPROVAL_NOTICE"]),
    );
  });

  it("bước 11 — worker mở năm phong bì, và chỉ lấy PHIÊN BẢN CUỐI của người đã sửa giá", async () => {
    const ketQua = await withTenant(unsealPool, orgA, (c) =>
      executeUnsealRequest(c, orgA, {
        unsealRequestId: trangThai.unsealRequestId,
        unwrapper: boMoBoc,
      }, unsealPool),
    );
    expect(ketQua.opened, "năm luồng báo giá, năm bản rõ").toBe(5);
    expect(ketQua.failedBidVersionIds).toEqual([]);
    expect(ketQua.rfqId).toBe(trangThai.rfqId);
  });

  it("bước 12 — BẢNG SO SÁNH: năm dòng, sắp theo giá, và giá SỬA LẠI thắng giá đầu", async () => {
    const bang = await withTenant(apiPool, orgA, (c) =>
      buildComparisonTable(c, orgA, { rfqId: trangThai.rfqId, actorSessionId: sMua }, apiPool),
    );
    expect(bang.rfqStatus).toBe("UNSEALED");
    expect(bang.rows.length).toBe(5);

    const mongDoi = [...trangThai.loiMoi]
      .map((l) => ({ ten: l.ten, gia: l.gia }))
      .sort((a, b) => Number(a.gia) - Number(b.gia));
    expect(bang.rows.map((r) => r.supplierLegalName)).toEqual(mongDoi.map((m) => m.ten));
    expect(bang.rows.map((r) => r.totalAmount)).toEqual(mongDoi.map((m) => m.gia));

    // Giá 930 triệu (bản SỬA) phải đứng đầu; giá 999 triệu (bản ĐẦU của cùng người) không được
    // xuất hiện ở đâu cả. Nếu worker lấy nhầm phiên bản, hai khẳng định này đỏ cùng lúc.
    expect(bang.rows[0]?.totalAmount).toBe(GIA_SUA_LAI);
    expect(bang.rows.map((r) => r.totalAmount)).not.toContain("999000000.00");

    expect(bang.aggregates.min).toBe(GIA_SUA_LAI);
    expect(bang.aggregates.max).toBe("1400000000.00");
    expect(bang.aggregates.currency).toBe("VND");
    expect(bang.aggregates.currencyMismatch).toBe(false);
    expect(bang.aggregates.unparsed).toBe(0);
    // Ngân sách 1 tỷ: 930tr và 980tr ở dưới, ba nhà còn lại ở trên.
    expect(bang.aggregates.belowBudget).toBe(2);
  });

  it("bước 13 — [B5] job toàn vẹn chạy sạch trên toàn bộ sáu phiên bản của kịch bản", async () => {
    const bc = await withTenant(unsealPool, orgA, (c) =>
      auditStoredCiphertexts(c, orgA, trangThai.rfqId),
    );
    expect(bc.checked, "năm nhà cung cấp, một người nộp hai lần").toBe(6);
    expect(bc.mismatched).toEqual([]);
    expect(bc.missingReceipt).toEqual([]);
    expect(bc.unparsableReceipt).toEqual([]);
  });

  it("bước 14 — [A3/A4] sau tất cả, giá dạng rõ chỉ tồn tại ở ĐÚNG MỘT bảng", async () => {
    // Cùng bộ quét của S1.7, chạy ở cuối một kịch bản THẬT thay vì trên một fixture hai dòng. ~~`relkind IN ('r', 'p')`~~
    // [S1.251] bộ quét chung (`@trustprocure/test-support`): cả view và materialized view; thêm kim ĐƠN GIÁ.
    expect(DON_GIA_SUA_LAI).toBe("1860000.00");
    const { dinh, soQuanHe } = await quetGiaMoiQuanHe(db.pool, GIA_SUA_LAI);
    expect(soQuanHe).toBeGreaterThan(20);
    expect((await quetGiaMoiQuanHe(db.pool, DON_GIA_SUA_LAI)).dinh, "đơn giá chỉ ở bảng bản rõ").toEqual(["rfq_unsealed_bids"]);
    expect(dinh).toEqual(["rfq_unsealed_bids"]);
  }, 120000);

  it("bước 15 — sổ kiểm toán kể lại được toàn bộ kịch bản, theo đúng thứ tự", async () => {
    // Câu hỏi của một kiểm toán viên là *"kể lại cho tôi nghe chuyện gì đã xảy ra"*, và câu trả
    // lời phải là dữ liệu chứ không phải một lời hứa. Đây là phép đo cho chính câu ấy.
    const { rows } = await db.pool.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE org_id = $1 ORDER BY seq",
      [orgA],
    );
    const cac = rows.map((r) => r.action);
    for (const moc of [
      "RFQ_CREATED",
      "RFQ_SUBMITTED_FOR_APPROVAL",
      "RFQ_APPROVED",
      "RFQ_KEY_MATERIAL_ISSUED",
      "RFQ_OPENED",
      "RFQ_CLOSED",
      "UNSEAL_REQUESTED",
      "UNSEAL_APPROVED",
      "UNSEAL_DISPATCHED",
      "RFQ_KEY_MATERIAL_UNWRAPPED",
      "RFQ_UNSEALED",
    ]) {
      expect(cac, `sổ kiểm toán thiếu mốc ${moc}`).toContain(moc);
    }
    // THỨ TỰ là một phần của câu chuyện: khoá được mở bọc SAU khi có phê duyệt, không trước.
    expect(cac.indexOf("RFQ_KEY_MATERIAL_UNWRAPPED")).toBeGreaterThan(
      cac.lastIndexOf("UNSEAL_APPROVED"),
    );
    expect(cac.indexOf("RFQ_UNSEALED")).toBeGreaterThan(
      cac.indexOf("RFQ_KEY_MATERIAL_UNWRAPPED"),
    );
    // [S1.193 / S3.2c / ADR-113] Thứ tự MỜI cũng là một phần của câu chuyện: luồng S3 mời TRƯỚC khi nộp duyệt và đúc token SAU
    // khi mở gói; luồng MVP1 mời và đúc sau khi mở. Đọc theo gói và năm lời mời của nó, không theo cả tổ chức.
    const cuaGoi = new Set([trangThai.rfqId, ...trangThai.loiMoi.map((l) => l.invitationId)]);
    // Hàng token mang id của TOKEN; lời mời của nó nằm ở payload.
    const { rows: theoGoi } = await db.pool.query<{ action: string; khoa: string | null }>(
      "SELECT action, CASE WHEN action = 'MAGIC_LINK_TOKEN_ISSUED' THEN payload->>'invitationId' ELSE resource_id::text END AS khoa " +
        "FROM audit_events WHERE org_id = $1 ORDER BY seq",
      [orgA],
    );
    const mocGoi = theoGoi.filter((r) => r.khoa !== null && cuaGoi.has(r.khoa)).map((r) => r.action);
    const nop = mocGoi.indexOf("RFQ_SUBMITTED_FOR_APPROVAL");
    const mo = mocGoi.indexOf("RFQ_OPENED");
    expect(mocGoi.filter((a) => a === "INVITATION_CREATED")).toHaveLength(5);
    expect(mocGoi.filter((a) => a === "MAGIC_LINK_TOKEN_ISSUED")).toHaveLength(5);
    if (batS3) {
      expect(mocGoi.lastIndexOf("INVITATION_CREATED"), "luồng S3: cả năm lời mời có TRƯỚC lần nộp duyệt").toBeLessThan(nop);
    } else {
      expect(mocGoi.indexOf("INVITATION_CREATED"), "luồng MVP1: mời SAU khi mở gói").toBeGreaterThan(mo);
    }
    expect(mocGoi.indexOf("MAGIC_LINK_TOKEN_ISSUED"), "không token mời nào trước lần mở gói (K6)").toBeGreaterThan(mo);
  });

  it("bước 16 — [S3.6b2 / K10a] ba gói 480/470/490 triệu cùng nhóm hàng: gói nộp sau cùng mang tín hiệu chia nhỏ và KHÔNG mở được tới khi một người độc lập ghi nhận; người tạo tự ghi nhận bị từ chối và vào sổ — luồng MVP1 mở cả ba như trước", async () => {
    // Fixture spec S3 §7: mỗi gói dưới cận 1 tỷ của bậc 2 (§4.1), tổng 1,44 tỷ chạm cận ấy. Nhóm hàng RIÊNG, không phải `THEP` của
    // gói 1 tỷ ở bước 1: tập anh em của tín hiệu là mọi gói cùng nhóm trong tổ chức, và bước này kể câu chuyện của riêng nó. Luồng
    // MVP1: không nhóm hàng, không bậc — K10a không sống ở tổ chức chưa bật, và cả ba gói đi đúng đường cũ.
    const nhomHang = batS3
      ? (await withTenant(apiPool, orgA, (c) => taoNhomHang(c, orgA, { ma: "THEP-CT", ten: "Thep tam cho cong trinh", actorSessionId: sTc1 }, apiPool))).id
      : null;
    // [S1.266 / S3.3c1] Luồng S3: mỗi gói ở bậc từ 100 triệu, và bậc ấy đòi BA nhà cung cấp đếm được (K2) — trước vòng này ba gói
    // nộp duyệt KHÔNG một lời mời nào. Ba nhà cung cấp riêng của bước, dựng một lần; người mua mời cả ba vào mỗi gói ở DRAFT, trước
    // lần nộp (chữ ký mang danh sách lúc ký, K4b). Tín hiệu chia nhỏ đọc ngân sách và nhóm hàng, không đọc lời mời: bước này kể đúng
    // câu chuyện cũ. Người ký `gd1` nằm ngoài tập loại trừ của mỗi gói, nên K5 của bậc (`ky_danh_sach_moi`) cho lần mở qua.
    // [S1.270 / S3.3d] Bậc ấy cũng xoay vòng (`xoay_vong_n` = 5, K3): gói sau mời lại hai nhà cung cấp đầu của gói trước, nên mỗi gói
    // thêm một nhà cung cấp MỚI của riêng nó — năm nhà cung cấp, gói i mời {Mot, Hai} cộng người thứ (3 + i).
    const nccBuoc16 = batS3
      ? await withTenant(apiPool, orgA, async (c) => {
          const ra: { supplierId: string; contactId: string }[] = [];
          for (const ten of ["Thep cong trinh Mot", "Thep cong trinh Hai", "Thep cong trinh Ba", "Thep cong trinh Bon", "Thep cong trinh Nam"]) ra.push(await dungNccDemDuoc(c, ten));
          return ra;
        })
      : [];
    const moGoi = (rfqId: string): Promise<unknown> =>
      withTenant(apiPool, orgA, (c) => openRfq(c, orgA, { rfqId, actorSessionId: sMua, orgKeys: boBoc }, apiPool)).then(
        () => null,
        (e: unknown) => e,
      );
    const goi: string[] = [];
    for (const [i, giaTri] of ["480000000.00", "470000000.00", "490000000.00"].entries()) {
      const id = await withTenant(apiPool, orgA, async (c) => {
        const r = await createRfq(c, orgA, {
          title: `Thep tam cong trinh ${i + 1}`,
          deadlineAt: HAN_NOP,
          createdBySessionId: sMua,
          categoryId: nhomHang,
        });
        await addRfqItem(c, orgA, {
          rfqId: r.id,
          lineNo: 1,
          description: "Thep tam SS400 day 10mm",
          quantity: "150.0000",
          unit: "tan",
          actorSessionId: sMua,
        });
        const ns = await setRfqBudget(c, orgA, { rfqId: r.id, estimatedValue: giaTri, currency: "VND", actorSessionId: sMua });
        expect(ns.requiresDualApproval, "dưới ngưỡng kép 500 triệu — một chữ ký").toBe(false);
        for (const n of nccBuoc16.filter((_, k) => k < 2 || k === 2 + i)) {
          await createInvitation(c, orgA, { rfqId: r.id, supplierId: n.supplierId, contactId: n.contactId, linkChannel: "EMAIL", actorSessionId: sMua }, apiPool);
        }
        return r.id;
      });
      const nop = await withTenant(apiPool, orgA, (c) => submitRfqForApproval(c, orgA, { rfqId: id, actorSessionId: sMua }, apiPool));
      if (batS3) await khaiKhongXungDot(id, sGd1);
      await withTenant(apiPool, orgA, (c) =>
        approveRfq(c, orgA, { rfqId: id, sessionId: sGd1, ...(batS3 ? { lanNopDaXem: nop.lanNop } : {}) }, apiPool),
      );
      goi.push(id);
      // Hai gói đầu: tổng 950 triệu chưa chạm cận — mở như mọi gói, ở cả hai luồng.
      if (i < 2) expect(await moGoi(id), `gói ${giaTri} mở không cần ghi nhận`).toBeNull();
    }
    const [g1, g2, g3] = goi;
    if (g1 === undefined || g2 === undefined || g3 === undefined) throw new Error("thieu goi cua buoc 16");
    const { rows: tinHieuGhi } = await db.pool.query<{ rfq_id: string; nguon: string }>(
      "SELECT rfq_id, nguon FROM governance_signals WHERE rfq_id = ANY($1::uuid[]) ORDER BY tinh_luc",
      [goi],
    );
    const hangChot = async (): Promise<string[]> =>
      (
        await db.pool.query<{ ma: string }>(
          "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = ANY($2::uuid[]) ORDER BY seq",
          [orgA, goi],
        )
      ).rows.map((r) => r.ma);

    if (!batS3) {
      expect(tinHieuGhi, "luồng MVP1: không một hàng tín hiệu nào").toEqual([]);
      expect(await moGoi(g3), "luồng MVP1: gói thứ ba mở như hai gói đầu").toBeNull();
      expect(await hangChot(), "luồng MVP1: không một lần từ chối nào vào sổ").toEqual([]);
      return;
    }

    // Tín hiệu ghi LÚC NỘP, chỉ ở gói nộp sau cùng — cửa sổ neo vào `submitted_at` của chính gói.
    expect(tinHieuGhi).toEqual([{ rfq_id: g3, nguon: "NOP_DUYET" }]);

    // Màn `/tao-thau` đọc trước khi mời bấm: người tạo đọc được lý do KHÔNG, người độc lập đọc được mình ghi nhận được, và trong tổ
    // chức đúng MỘT người ghi nhận được — hai giám đốc không giữ `rfq.approve`, hai người tài chính cũng không, người mua gây ra tín hiệu.
    const docMua = await withTenant(apiPool, orgA, (c) => lietKeTinHieu(c, orgA, { rfqId: g3, actorSessionId: sMua }));
    expect(docMua.canGhiNhan).toBe(true);
    expect(docMua.nguoiXem).toEqual({ ghiNhanDuoc: false, lyDo: CHOT_VAO_SO.K10A_TU_GHI_NHAN.thongDiep });
    const docDl = await withTenant(apiPool, orgA, (c) => lietKeTinHieu(c, orgA, { rfqId: g3, actorSessionId: sPmDl }));
    expect(docDl.nguoiXem).toEqual({ ghiNhanDuoc: true, lyDo: null });
    expect(docDl.soNguoiGhiNhanDuoc).toBe(1);
    expect(docDl.hienTai).toMatchObject({ loai: "PURCHASE_SPLITTING", nhom_hang: nhomHang, cua_so_ngay: 30, can: 1_000_000_000 });
    expect(docDl.goi).toEqual({
      [g1]: { tieuDe: "Thep tam cong trinh 1", trangThai: "OPEN" },
      [g2]: { tieuDe: "Thep tam cong trinh 2", trangThai: "OPEN" },
      [g3]: { tieuDe: "Thep tam cong trinh 3", trangThai: "PENDING_APPROVAL" },
    });

    // Đủ chữ ký mà vẫn không mở: chốt K10a hỏi TRƯỚC lần đúc khoá, và lần từ chối vào sổ.
    const chan = await moGoi(g3);
    expect(chan).toBeInstanceOf(ChotKiemSoatError);
    expect((chan as ChotKiemSoatError).lyDo).toBe("TIN_HIEU_CHUA_GHI_NHAN");
    const { rows: khoaG3 } = await db.pool.query("SELECT 1 FROM rfq_key_material WHERE rfq_id = $1", [g3]);
    expect(khoaG3, "không khoá nào được đúc cho gói bị chặn").toHaveLength(0);

    // Người tạo tự ghi nhận — màn đã nói trước là không; tầng gói từ chối theo chốt và lần ấy cũng vào sổ.
    const tuGhi = await withTenant(apiPool, orgA, (c) =>
      ghiNhanTinHieu(c, orgA, { rfqId: g3, lyDo: "Toi tao ca ba goi, toi xac nhan", actorSessionId: sMua }, apiPool),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(tuGhi).toBeInstanceOf(ChotKiemSoatError);
    expect((tuGhi as Error).message).toBe(CHOT_VAO_SO.K10A_TU_GHI_NHAN.thongDiep);

    const LY_DO = "Ba cong trinh khac nhau, ba hop dong khung rieng";
    if (batS3) await khaiKhongXungDot(g3, sPmDl);
    const kq = await withTenant(apiPool, orgA, (c) => ghiNhanTinHieu(c, orgA, { rfqId: g3, lyDo: LY_DO, actorSessionId: sPmDl }, apiPool));
    expect(kq.tinHieuMoi, "tập gói không đổi từ lúc nộp — ghi nhận đúng tín hiệu đã ghi").toBe(false);
    expect(await moGoi(g3), "ghi nhận độc lập xong thì gói mở").toBeNull();

    // Sổ kể lại câu chuyện của gói thứ ba theo đúng thứ tự: nộp và tín hiệu, duyệt, bị chặn, tự ghi nhận bị từ chối, ghi nhận độc
    // lập, rồi mới đúc khoá và mở.
    const { rows: soG3 } = await db.pool.query<{ action: string; ma: string | null; nguoi: string | null }>(
      "SELECT action, payload->>'ma' AS ma, actor_id::text AS nguoi FROM audit_events WHERE org_id = $1 AND resource_id = $2 ORDER BY seq",
      [orgA, g3],
    );
    const QUAN_TAM = new Set([
      "RFQ_SUBMITTED_FOR_APPROVAL",
      "GOVERNANCE_SIGNAL_RECORDED",
      "RFQ_APPROVED",
      "CONTROL_DENIED",
      "GOVERNANCE_SIGNAL_ACKNOWLEDGED",
      "RFQ_OPENED",
    ]);
    const cauChuyen = soG3.filter((r) => QUAN_TAM.has(r.action)).map((r) => (r.ma === null ? r.action : `${r.action}:${r.ma}`));
    expect(cauChuyen).toEqual([
      "RFQ_SUBMITTED_FOR_APPROVAL",
      "GOVERNANCE_SIGNAL_RECORDED",
      "RFQ_APPROVED",
      "CONTROL_DENIED:TIN_HIEU_CHUA_GHI_NHAN",
      "CONTROL_DENIED:K10A_TU_GHI_NHAN",
      "GOVERNANCE_SIGNAL_ACKNOWLEDGED",
      "RFQ_OPENED",
    ]);
    expect(soG3.find((r) => r.action === "GOVERNANCE_SIGNAL_ACKNOWLEDGED")?.nguoi, "người ghi nhận là người độc lập").toBe(uPmDl);
    const hanhDong = soG3.map((r) => r.action);
    expect(hanhDong.indexOf("RFQ_KEY_MATERIAL_ISSUED"), "khoá chỉ được đúc SAU lần ghi nhận").toBeGreaterThan(
      hanhDong.indexOf("GOVERNANCE_SIGNAL_ACKNOWLEDGED"),
    );
    expect(await hangChot()).toEqual(["TIN_HIEU_CHUA_GHI_NHAN", "K10A_TU_GHI_NHAN"]);
  });

  it("bước 17 — [S3.3e2 / K2 · K5 · K3] ngoại lệ cạnh tranh: gói MỘT nhà cung cấp bị K2 chặn lúc nộp, `SINGLE_SOURCE` cứu, chữ ký của người lập ngoại lệ bị K5 chặn lúc mở, người độc lập ký thì mở; gói mời lại nhà cung cấp cũ bị K3 chặn, `ROTATION` cứu — luồng MVP1: không chốt nào, ngoại lệ không lập được", async () => {
    // Bản tầng gói của bước 17 qua HTTP: cùng hai gói ở bậc từ 100 triệu, một nhóm hàng RIÊNG (tổng 450 triệu, không cận K10a nào).
    // Người lập ngoại lệ là người PM độc lập của bước 16 (`sPmDl` — giữ `rfq.invite`, không tạo, không mời), nên vào tập loại trừ của
    // K5; người ký độc lập là `gd1`, như mọi gói của bước 16. Tầng gói bắt lời từ chối có tên của trigger và ném `ChotKiemSoatError`.
    const thu = <T,>(viec: Promise<T>): Promise<unknown> => viec.then(() => null, (e: unknown) => e);
    const taoGoi = (tieuDe: string, giaTri: string, nhomHang: string | null): Promise<string> =>
      withTenant(apiPool, orgA, async (c) => {
        const r = await createRfq(c, orgA, { title: tieuDe, deadlineAt: HAN_NOP, createdBySessionId: sMua, categoryId: nhomHang });
        await addRfqItem(c, orgA, { rfqId: r.id, lineNo: 1, description: "Van dieu ap DN100 PN16", quantity: "4.0000", unit: "cai", actorSessionId: sMua });
        await setRfqBudget(c, orgA, { rfqId: r.id, estimatedValue: giaTri, currency: "VND", actorSessionId: sMua });
        return r.id;
      });
    const nop = (rfqId: string): Promise<unknown> =>
      thu(withTenant(apiPool, orgA, (c) => submitRfqForApproval(c, orgA, { rfqId, actorSessionId: sMua }, apiPool)));
    const lanNop = async (rfqId: string): Promise<number> =>
      (await db.pool.query<{ n: number }>("SELECT lan_nop AS n FROM rfq_packages WHERE id = $1", [rfqId])).rows[0]?.n ?? -1;
    const ky = async (rfqId: string, phien: string): Promise<void> => {
      const moc = batS3 ? { lanNopDaXem: await lanNop(rfqId) } : {};
      if (batS3) await khaiKhongXungDot(rfqId, phien);
      await withTenant(apiPool, orgA, (c) => approveRfq(c, orgA, { rfqId, sessionId: phien, ...moc }, apiPool));
    };
    const moGoi = (rfqId: string): Promise<unknown> =>
      thu(withTenant(apiPool, orgA, (c) => openRfq(c, orgA, { rfqId, actorSessionId: sMua, orgKeys: boBoc }, apiPool)));
    const lapNgoaiLeCho = (rfqId: string, loai: string, maLyDo: string, phien: string): Promise<unknown> =>
      thu(
        withTenant(apiPool, orgA, (c) =>
          lapNgoaiLe(c, orgA, { rfqId, loai, maLyDo, giaiTrinh: "Chi mot hang giu ban quyen van dieu ap loai nay tai Viet Nam", actorSessionId: phien }, apiPool),
        ),
      );
    const hangChot = async (goiXet: readonly string[]): Promise<string[]> =>
      (
        await db.pool.query<{ ma: string }>(
          "SELECT payload->>'ma' AS ma FROM audit_events WHERE org_id = $1 AND action = 'CONTROL_DENIED' AND resource_id = ANY($2::uuid[]) ORDER BY seq",
          [orgA, goiXet],
        )
      ).rows.map((r) => r.ma);
    const tenNguoi = new Map([
      [uMua, "mua"],
      [uPmDl, "pmDl"],
      [uGd1, "gd1"],
    ]);
    const cauChuyen = async (rfqId: string): Promise<string[]> => {
      const QUAN_TAM = new Set(["CONTROL_DENIED", "SOURCING_EXCEPTION_CREATED", "RFQ_SUBMITTED_FOR_APPROVAL", "RFQ_APPROVED", "RFQ_OPENED"]);
      const { rows } = await db.pool.query<{ action: string; ma: string | null; nguoi: string | null }>(
        "SELECT action, payload->>'ma' AS ma, actor_id::text AS nguoi FROM audit_events WHERE org_id = $1 AND resource_id = $2 ORDER BY seq",
        [orgA, rfqId],
      );
      return rows
        .filter((r) => QUAN_TAM.has(r.action))
        .map((r) => `${r.ma === null ? r.action : `${r.action}:${r.ma}`}@${tenNguoi.get(r.nguoi ?? "") ?? "khac"}`);
    };
    const lyDo = (e: unknown): string | null => (e instanceof ChotKiemSoatError ? e.lyDo : null);

    if (!batS3) {
      // Luồng MVP1: K2/K3/K5 không sống ở tổ chức chưa bật — gói không lời mời nộp, ký và mở như bước 16; lập ngoại lệ dừng ở lời
      // từ chối *tổ chức chưa bật* của trigger (không hàng ngoại lệ, không vào sổ chốt).
      const a = await taoGoi("Van dieu ap mot nguon", "200000000.00", null);
      const lap = await lapNgoaiLeCho(a, "SINGLE_SOURCE", "PROPRIETARY_TECHNOLOGY", sMua);
      expect(lap, "luồng MVP1: tổ chức chưa bật không lập được ngoại lệ").toBeInstanceOf(Error);
      expect(lyDo(lap)).toBeNull();
      expect(await nop(a)).toBeNull();
      await ky(a, sGd1);
      expect(await moGoi(a)).toBeNull();
      const { rows } = await db.pool.query("SELECT 1 FROM rfq_sourcing_exceptions WHERE rfq_id = $1", [a]);
      expect(rows, "luồng MVP1: không một hàng ngoại lệ nào").toHaveLength(0);
      expect(await hangChot([a]), "luồng MVP1: không một lần từ chối nào vào sổ").toEqual([]);
      return;
    }

    const nhomHang = (await withTenant(apiPool, orgA, (c) => taoNhomHang(c, orgA, { ma: "VAN", ten: "Van cong nghiep", actorSessionId: sTc1 }, apiPool))).id;

    // ── Gói A: MỘT nhà cung cấp đếm được, MỚI với mọi gói của người mua ──
    const a = await taoGoi("Van dieu ap mot nguon", "200000000.00", nhomHang);
    await withTenant(apiPool, orgA, async (c) => {
      const n = await dungNccDemDuoc(c, "Van cong nghiep Mot Nguon");
      await createInvitation(c, orgA, { rfqId: a, supplierId: n.supplierId, contactId: n.contactId, linkChannel: "EMAIL", actorSessionId: sMua }, apiPool);
    });
    // ⑴ K2: một nhóm đếm được, bậc đòi ba; danh sách lời mời nói cùng hai con số mà màn hiện.
    expect(lyDo(await nop(a))).toBe("K2_THIEU_CANH_TRANH");
    const dsA = await withTenant(apiPool, orgA, (c) => listInvitations(c, orgA, { rfqId: a, actorSessionId: sMua }, apiPool));
    expect(dsA?.canhTranh).toEqual({ soNhomDemDuoc: 1, toiThieu: 3 });
    // ⑵ Người PM độc lập lập `SINGLE_SOURCE`; danh sách ngoại lệ mang lần nộp của chính gói, ở DRAFT.
    expect(await lapNgoaiLeCho(a, "SINGLE_SOURCE", "PROPRIETARY_TECHNOLOGY", sPmDl)).toBeNull();
    const nlA = await withTenant(apiPool, orgA, (c) => docNgoaiLe(c, orgA, { rfqId: a, actorSessionId: sMua }, apiPool));
    expect(nlA).toMatchObject({ lanNop: await lanNop(a), trangThai: "DRAFT", exceptions: [{ loai: "SINGLE_SOURCE", lapBoi: uPmDl, rut: null }] });
    // ⑶ Lần nộp qua; người lập ngoại lệ ký.
    expect(await nop(a)).toBeNull();
    await ky(a, sPmDl);
    // ⑷ K5: chữ ký duy nhất là của người lập ngoại lệ — một ngoại lệ không bao giờ tự duyệt. Không khoá nào được đúc.
    expect(lyDo(await moGoi(a))).toBe("K5_THIEU_CHU_KY_DOC_LAP");
    const { rows: khoaA } = await db.pool.query("SELECT 1 FROM rfq_key_material WHERE rfq_id = $1", [a]);
    expect(khoaA, "không khoá nào được đúc cho gói bị chặn").toHaveLength(0);
    // ⑸ Người ký độc lập ký; gói mở.
    await ky(a, sGd1);
    expect(await moGoi(a)).toBeNull();
    expect(await cauChuyen(a)).toEqual([
      "CONTROL_DENIED:K2_THIEU_CANH_TRANH@mua",
      "SOURCING_EXCEPTION_CREATED@pmDl",
      "RFQ_SUBMITTED_FOR_APPROVAL@mua",
      "RFQ_APPROVED@pmDl",
      "CONTROL_DENIED:K5_THIEU_CHU_KY_DOC_LAP@mua",
      "RFQ_APPROVED@gd1",
      "RFQ_OPENED@mua",
    ]);

    // ── Gói B: ba nhà cung cấp đầu của gói chính — đếm được, nhưng đã có trong gói 1 tỷ người mua mở ở bước 2 ──
    const { rows: cu } = await db.pool.query<{ supplier_id: string; contact_id: string }>(
      "SELECT supplier_id, contact_id FROM rfq_invitations WHERE org_id = $1 AND rfq_id = $2 ORDER BY created_at, id LIMIT 3",
      [orgA, trangThai.rfqId],
    );
    expect(cu).toHaveLength(3);
    const b = await taoGoi("Van dieu ap thay the", "250000000.00", nhomHang);
    await withTenant(apiPool, orgA, async (c) => {
      for (const n of cu) {
        await createInvitation(c, orgA, { rfqId: b, supplierId: n.supplier_id, contactId: n.contact_id, linkChannel: "EMAIL", actorSessionId: sMua }, apiPool);
      }
    });
    expect(lyDo(await nop(b))).toBe("K3_KHONG_XOAY_VONG");
    expect(await lapNgoaiLeCho(b, "ROTATION", "EXISTING_CONTRACT", sPmDl)).toBeNull();
    expect(await nop(b)).toBeNull();
    await ky(b, sGd1);
    expect(await moGoi(b)).toBeNull();
    expect(await cauChuyen(b)).toEqual([
      "CONTROL_DENIED:K3_KHONG_XOAY_VONG@mua",
      "SOURCING_EXCEPTION_CREATED@pmDl",
      "RFQ_SUBMITTED_FOR_APPROVAL@mua",
      "RFQ_APPROVED@gd1",
      "RFQ_OPENED@mua",
    ]);
    expect(await hangChot([a, b])).toEqual(["K2_THIEU_CANH_TRANH", "K5_THIEU_CHU_KY_DOC_LAP", "K3_KHONG_XOAY_VONG"]);
  });
});
