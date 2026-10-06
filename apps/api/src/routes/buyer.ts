// ==============================================================================================
// Route NGƯỜI MUA — phiên nội bộ đã qua MFA. `ctx.client` đã gắn tổ chức; với route `mutates:
// true`, bộ điều phối đã gọi `requirePermission` TRƯỚC khi vào đây, nên handler không kiểm quyền
// và cũng KHÔNG ĐƯỢC kiểm — một cổng thứ hai ở đây là hai nơi để lệch nhau. (Vài hàm gói tự gọi
// `requirePermission` lần nữa với CÙNG mã — khoản nợ 31/33 — đó là lớp của gói, không của route.)
//
// [S1.10.5] Toàn bộ vòng đời phía người mua của kịch bản mục 41: chính sách → nhà cung cấp → RFQ →
// hạng mục → ngân sách → nộp duyệt → duyệt ×2 → mở → mời → gia hạn/đóng/huỷ → yêu cầu mở thầu →
// duyệt ×2 → điều phối → bảng so sánh. Mọi route ghi khai `permission` (kiểu ép, lớp canh
// `routes.test.ts` đọc cấu trúc, và `buyer.int.test.ts` QUÉT từng route ghi bằng một phiên không
// có quyền nào — 403 cho tất cả, mỗi lần một bản ghi PERMISSION_DENIED).
//
// Danh tính ở MỌI lời gọi gói là `ctx.actor.sessionId` — dẫn xuất từ cookie (ADR-016). Thân yêu
// cầu chỉ mang dữ liệu nghiệp vụ; không trường nào trong thân là một lời khai "tôi là ai".
// ==============================================================================================
import {
  deXuatTraoThau,
  docBangXepHang,
  docTraoThau,
  docVongBafo,
  dongVongBafo,
  duyetTraoThau,
  huyTraoThau,
  moVongBafo,
  rutDeXuatTraoThau,
  taoLuotDanhGia,
  type LuotDanhGia,
  xuatBoBangChung,
} from "@trustprocure/danh-gia";
import { chuanHoaGoi, coHangChuanDangDung } from "@trustprocure/du-lieu-nen";
import { PERMISSIONS, approveMfaReset, cancelMfaReset, listUserIdsWithPermission, requestMfaReset } from "@trustprocure/identity";
import { ghiNhanTinHieu, lietKeTinHieu } from "@trustprocure/kiem-soat";
import {
  clearOtpLockout,
  createInvitation,
  danhDauDaGui,
  docNgoaiLe,
  ducTokenKhiMoGoi,
  issueMagicLinkToken,
  lapNgoaiLe,
  listInvitations,
  reissueInvitationLink,
  revokeInvitation,
  revokeMagicLinkToken,
  rutNgoaiLe,
  CHANNELS,
  CUA_SO_LINK_MOI_GIAY,
  type Channel,
} from "@trustprocure/invitation";
import {
  addRfqItem,
  approveRfq,
  cancelRfq,
  closeRfq,
  createProcurementPolicy,
  createRfq,
  datNhomHangChoGoi,
  doiTrangThaiNhomHang,
  extendRfqDeadline,
  getActiveProcurementPolicy,
  getRfq,
  getRfqBudget,
  kyPhienBanChinhSach,
  lietKeNhomHang,
  lietKePhienBanChinhSach,
  listRfqItems,
  openRfq,
  returnRfqToDraft,
  setRfqBudget,
  submitRfqForApproval,
  taoNhomHang,
  type Currency,
  type ThanhPhanTrongSoVao,
} from "@trustprocure/rfq";
import {
  addSupplierContact,
  createSupplier,
  docHoSoXacMinh,
  docXacMinhNhaCungCap,
  getSupplier,
  listSupplierContacts,
  listSuppliers,
  thuHoiXacMinhNhaCungCap,
  xacMinhNhaCungCap,
} from "@trustprocure/supplier";
import {
  UnsealError,
  approveUnseal,
  buildComparisonTable,
  cancelUnseal,
  countReceivedBids,
  dispatchUnseal,
  getOpenUnsealForRfq,
  getUnsealRequest,
  requestUnseal,
} from "@trustprocure/unseal";
import { HttpError, type ApiRequest, type ApiResponse } from "../http.js";
import type { BuyerReadRoute, BuyerWriteRoute } from "../route-types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// ----------------------------------------------------------------------------------------------
// Đọc thân — 422 khi thiếu/sai kiểu. Không nội suy GIÁ TRỊ vào thông điệp (chỉ tên trường).
// ----------------------------------------------------------------------------------------------
function truong(body: unknown, ten: string): unknown {
  return (body as Record<string, unknown> | null | undefined)?.[ten];
}
function chuoiBatBuoc(body: unknown, ten: string): string {
  const v = truong(body, ten);
  if (typeof v !== "string" || v.trim() === "") throw new HttpError(422, `thiếu trường "${ten}"`);
  return v;
}
/** [review H2-8] Định danh trong THÂN phải đúng dạng UUID trước khi chạm CSDL — sai dạng là 422, không phải 22P02 → 500. */
function uuidBody(body: unknown, ten: string): string {
  const v = chuoiBatBuoc(body, ten);
  if (!UUID_RE.test(v)) throw new HttpError(422, `trường "${ten}" phải là UUID`);
  return v;
}
/** [S1.201 / S3.6a] Định danh TUỲ CHỌN trong thân — vắng hay `null` là không có; có mặt thì phải đúng dạng UUID. */
function uuidTuyChon(body: unknown, ten: string): string | null {
  const v = truong(body, ten);
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(422, `trường "${ten}" phải là UUID`);
  return v;
}
function booleanBatBuoc(body: unknown, ten: string): boolean {
  const v = truong(body, ten);
  if (typeof v !== "boolean") throw new HttpError(422, `trường "${ten}" phải là boolean`);
  return v;
}
function chuoiTuyChon(body: unknown, ten: string): string | null {
  const v = truong(body, ten);
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new HttpError(422, `trường "${ten}" phải là chuỗi`);
  return v;
}
function soNguyen(body: unknown, ten: string): number {
  const v = truong(body, ten);
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(422, `trường "${ten}" phải là số nguyên`);
  return v;
}
/**
 * [S1.107 / lượt soi ngang 77 — CAO ②] `evalComponents` của thân `POST /policy`: KHÔNG bắt buộc,
 * và khi vắng thì chính sách ấy không chấm thầu được — đúng trạng thái của MỌI tổ chức cho tới
 * vòng này, vì `056` cấp GRANT từ S1.102 và `057` cưỡng chế hình dạng từ S1.105 nhưng không một
 * dòng mã sản xuất nào ghi hai cột ấy, nên route chấm thầu của S1.106 luôn trả 422 ngoài cụm test.
 *
 * Bộ đọc này chỉ kiểm hình dạng NGOÀI — mảng của object. Ba trường chuỗi do `packages/rfq` kiểm,
 * còn `don_vi` thuộc {TIEN, DIEM}, *ít nhất một TIEN* và khuôn của `he_so` do `CHECK` của `057`
 * phán xử. Ba lớp, mỗi lớp một việc, và không lớp nào chép lại luật của lớp kia.
 */
function mangTrongSo(body: unknown, ten: string): readonly ThanhPhanTrongSoVao[] | undefined {
  return mangObjectTuyChon(body, ten) as readonly ThanhPhanTrongSoVao[] | undefined;
}
/**
 * Mảng các object, TUỲ CHỌN — hình dạng NGOÀI và chỉ hình dạng ngoài. [S1.169] Chung cho `evalComponents` và `tiers`
 * (bậc giá trị, S3.1c): luật bên trong của cả hai là của CSDL (`057`, `069`).
 */
function mangObjectTuyChon(body: unknown, ten: string): readonly Readonly<Record<string, unknown>>[] | undefined {
  const v = truong(body, ten);
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new HttpError(422, `trường "${ten}" phải là mảng`);
  for (const t of v) {
    if (typeof t !== "object" || t === null || Array.isArray(t)) {
      throw new HttpError(422, `trường "${ten}" phải là mảng các object`);
    }
  }
  return v as readonly Readonly<Record<string, unknown>>[];
}

/** [S1.256 / S4.5b] Object các chuỗi, TUỲ CHỌN — nhóm khoá `benchmark`; tập khoá và biên là của CSDL. */
function objectChuoiTuyChon(body: unknown, ten: string): Readonly<Record<string, string>> | undefined {
  const v = truong(body, ten);
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(422, `trường "${ten}" phải là object`);
  for (const x of Object.values(v as Record<string, unknown>)) {
    if (typeof x !== "string") throw new HttpError(422, `mọi giá trị của trường "${ten}" phải là chuỗi`);
  }
  return v as Readonly<Record<string, string>>;
}

/** Số nguyên TUỲ CHỌN — `undefined` khi vắng, để `packages/rfq` phán xử cặp với `evalComponents`. */
function soNguyenTuyChon(body: unknown, ten: string): number | undefined {
  const v = truong(body, ten);
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(422, `trường "${ten}" phải là số nguyên`);
  return v;
}
function ngayTuyChon(body: unknown, ten: string): Date | null {
  const v = truong(body, ten);
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new HttpError(422, `trường "${ten}" phải là chuỗi ISO 8601`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(422, `trường "${ten}" không phải ngày hợp lệ`);
  return d;
}
function ngayBatBuoc(body: unknown, ten: string): Date {
  const d = ngayTuyChon(body, ten);
  if (d === null) throw new HttpError(422, `thiếu trường "${ten}"`);
  return d;
}
function tienTe(body: unknown): Currency {
  const v = chuoiBatBuoc(body, "currency");
  if (v !== "VND" && v !== "USD") throw new HttpError(422, 'trường "currency" phải là VND hoặc USD');
  return v;
}
function kenhTuyChon(body: unknown): Channel | undefined {
  const v = chuoiTuyChon(body, "linkChannel");
  if (v === null) return undefined;
  if (!(CHANNELS as readonly string[]).includes(v)) throw new HttpError(422, 'trường "linkChannel" không hợp lệ');
  return v as Channel;
}
/** Tham số đường dẫn UUID; sai hình dạng ⇒ 404 (không phải 422: đường ấy không tồn tại). */
function uuidParam(req: ApiRequest, ten: string): string {
  const v = req.params[ten] ?? "";
  if (!UUID_RE.test(v)) throw new HttpError(404, "khong co duong nay");
  return v;
}
const rfqIdParam = (req: ApiRequest): string => uuidParam(req, "rfqId");
const unsealIdParam = (req: ApiRequest): string => uuidParam(req, "unsealRequestId");
const invitationIdParam = (req: ApiRequest): string => uuidParam(req, "invitationId");
const supplierIdParam = (req: ApiRequest): string => uuidParam(req, "supplierId");
const exceptionIdParam = (req: ApiRequest): string => uuidParam(req, "exceptionId");
const userIdParam = (req: ApiRequest): string => uuidParam(req, "userId");
const mfaResetIdParam = (req: ApiRequest): string => uuidParam(req, "requestId");
const awardIdParam = (req: ApiRequest): string => uuidParam(req, "awardId");
const policyIdParam = (req: ApiRequest): string => uuidParam(req, "policyId");
const categoryIdParam = (req: ApiRequest): string => uuidParam(req, "categoryId");

// ----------------------------------------------------------------------------------------------
// ĐỌC
// ----------------------------------------------------------------------------------------------
const doc: readonly BuyerReadRoute[] = [
  {
    method: "GET",
    path: "/me",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] phiên của chính người gọi; không chạm một bảng nào
    agent: true,
    handler: (ctx) =>
      Promise.resolve({
        status: 200,
        // [khoản 141 / ADR-039 — lượt soi đối kháng Đ-2] `kind` đi ra đây, và đó là đường DUY NHẤT
        // để một máy khách tự kiểm được nó đang cầm loại chứng chỉ nào. Không mở oracle mới: route
        // này đã trả `sessionId` của CHÍNH phiên đang gọi, nên nó không nói thêm gì về phiên của
        // người khác. `apps/mcp` gọi đúng đường này một lần lúc khởi động và NÉM nếu không phải
        // `AGENT_READONLY` — nếu thiếu, bốn lớp của vòng này chỉ là kỷ luật vận hành.
        body: { userId: ctx.actor.id, sessionId: ctx.actor.sessionId, orgId: ctx.orgId, kind: ctx.actor.kind },
      }),
  },
  {
    method: "GET",
    path: "/suppliers",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] sổ nhà cung cấp — dữ liệu nghiệp vụ, không giá
    agent: true,
    handler: async (ctx) => ({ status: 200, body: { suppliers: await listSuppliers(ctx.client, ctx.orgId) } }),
  },
  {
    method: "GET",
    path: "/suppliers/:supplierId",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] một nhà cung cấp; liên hệ KHÔNG nằm trong thân này
    agent: true,
    handler: async (ctx) => {
      const s = await getSupplier(ctx.client, ctx.orgId, supplierIdParam(ctx.req));
      if (s === null) throw new HttpError(404, "khong co nha cung cap");
      return { status: 200, body: { supplier: s } };
    },
  },
  {
    method: "GET",
    path: "/suppliers/:supplierId/contacts",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] tên, email, điện thoại của người ở công ty khác — ADR-038 rút khỏi bề mặt agent
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: { contacts: await listSupplierContacts(ctx.client, ctx.orgId, supplierIdParam(ctx.req)) },
    }),
  },
  {
    method: "GET",
    path: "/suppliers/:supplierId/verification",
    audience: "BUYER",
    mutates: false,
    // [S1.196 / S3.3a / K8a] Trạng thái xác minh nội bộ — hàng mới nhất cộng `ncc_xac_minh_con_hieu_luc`. KHÔNG cho agent:
    // bề mặt mới, không công cụ đọc nào của agent cần nó; mở sau là một quyết định có tên (khuôn `/policy/versions`).
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: { verification: await docXacMinhNhaCungCap(ctx.client, ctx.orgId, supplierIdParam(ctx.req)) },
    }),
  },
  {
    method: "GET",
    // [S1.9101 / S3.3e1 — lượt soi THẤP] KHÔNG `/suppliers/verifications`: bộ định tuyến lấy route khớp đầu tiên, và
    // `/suppliers/:supplierId` (agent) khớp chuỗi ấy.
    path: "/supplier-verifications",
    audience: "BUYER",
    mutates: false,
    // [S1.9101 / S3.3e1] Hồ sơ xác minh của MỌI nhà cung cấp — trạng thái, băm hồ sơ hiện tại, mọi người liên hệ — cho màn
    // `/nha-cung-cap`. Không cổng, như hai route đọc mà nó gộp (`…/verification`, `…/contacts`); KHÔNG cho agent: người liên hệ là
    // dữ liệu của người ở công ty khác (khoản 141), trạng thái xác minh là bề mặt chưa mở cho agent.
    agent: false,
    handler: async (ctx) => ({ status: 200, body: { hoSo: await docHoSoXacMinh(ctx.client, ctx.orgId) } }),
  },
  {
    method: "GET",
    path: "/policy",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] ngưỡng phê duyệt của chính tổ chức
    agent: true,
    handler: async (ctx) => ({ status: 200, body: { policy: await getActiveProcurementPolicy(ctx.client, ctx.orgId) } }),
  },
  {
    method: "GET",
    path: "/policy/versions",
    audience: "BUYER",
    mutates: false,
    // [S1.169 / S3.1c] KHÔNG cho agent: màn `/chinh-sach` là màn của người, và lịch sử phiên bản cùng người ký là dữ liệu
    // quản trị mà không công cụ đọc nào của agent cần. Mở sau là một quyết định có tên, không phải một lần quên.
    agent: false,
    handler: async (ctx) => {
      const ds = await lietKePhienBanChinhSach(ctx.client, ctx.orgId);
      // `choKy` để màn biết nút ký có mở không — chính cửa vẫn là route ký, đọc cùng cờ ấy.
      return { status: 200, body: { phienBan: ds.phienBan, daBat: ds.daBat, choKy: ctx.choKyChinhSach } };
    },
  },
  {
    method: "GET",
    path: "/categories",
    audience: "BUYER",
    mutates: false,
    // [S1.201 / S3.6a] Danh sách nhóm hàng của tổ chức — người soạn gói chọn từ đây, người giữ `category.manage` quản lý ở
    // `/nhom-hang`. KHÔNG cho agent: nhóm hàng là khoá của tín hiệu chia nhỏ (K10), dữ liệu kiểm soát của bên mua; mở sau là
    // một quyết định có tên.
    agent: false,
    handler: async (ctx) => ({ status: 200, body: { nhomHang: await lietKeNhomHang(ctx.client, ctx.orgId) } }),
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] trạng thái RFQ; không bao giờ giá
    agent: true,
    handler: async (ctx) => {
      const r = await getRfq(ctx.client, ctx.orgId, rfqIdParam(ctx.req));
      if (r === null) throw new HttpError(404, "khong co goi thau");
      // [S1.9101 / S3.3e1 · khoản 340] Cờ HIỂN THỊ: người xem giữ `rfq.invite`, tức hai danh sách lời mời và ngoại lệ sẽ cho họ đọc.
      // `/tao-thau` chỉ tự nạp hai danh sách khi cờ bật — người không giữ quyền không sinh một 403 và một hàng `PERMISSION_DENIED` ở
      // mỗi lần đọc gói (ADR-118 F3). Không phải cổng: hai route đọc vẫn tự cổng trong thân. Đọc bằng `listUserIdsWithPermission`
      // (khuôn `kiem-soat/tin-hieu.ts`), không mở `hasPermission` ra mặt tiền; thân chỉ mang bit của CHÍNH người xem. Phiên agent luôn
      // `false`: hai route ấy không cho agent, một cờ `true` chỉ mời nó tiêu trần từ chối.
      const coQuyenMoi =
        ctx.actor.kind === "USER" &&
        (await listUserIdsWithPermission(ctx.client, ctx.orgId, PERMISSIONS.RFQ_INVITE)).includes(ctx.actor.id);
      return { status: 200, body: { rfq: r, coQuyenMoi } };
    },
  },
  // [S1.200 / khoản 258] Ngân sách ĐÚNG như chữ ký duyệt gói ràng vào (ADR-115) — người duyệt đọc được con số mình ký. Màn
  // `/tao-thau` tự đọc nó ở lần đọc gói cho người tạo gói; người khác bấm «Xem ngân sách». Cổng nằm trong gói (`getRfqBudget`, rổ
  // `HAM_DOC_CO_QUYEN`): người tạo gói cần `rfq.create`, người khác cần `rfq.approve`; `auditPool` để lần từ chối có bản ghi.
  {
    method: "GET",
    path: "/rfqs/:rfqId/budget",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] NGÂN SÁCH DỰ TÍNH — thứ neo giá nếu rò xuống bên bán; chủ dự án chốt ngày 2026-09-29: agent không đọc (ADR-118)
    agent: false,
    handler: async (ctx) => {
      const budget = await getRfqBudget(
        ctx.client,
        ctx.orgId,
        { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
        ctx.auditPool,
      );
      if (budget === null) throw new HttpError(404, "khong co goi thau");
      return { status: 200, body: { budget } };
    },
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/invitations",
    audience: "BUYER",
    mutates: false,
    // [S1.98 / khoản 125] KHÔNG khai `permission` ở đây, và sự vắng mặt ấy là CÓ Ý: `dispatch.ts`
    // chỉ gọi `requirePermission` khi `route.mutates`, nên một cờ quyền trên route ĐỌC là một lời
    // khai không có lớp. Cổng thật nằm THẲNG trong thân `listInvitations`, cùng khuôn hai đường
    // đọc có cổng đã có (`buildComparisonTable`, `countReceivedBids`), và
    // `tests/architecture/cong-quyen-route.test.ts` đọc thân hàm ấy để rổ `HAM_DOC_CO_QUYEN` là
    // một phép đo chứ không một cái nhãn.
    //
    // KHÔNG `agent: true`: danh sách ai được mời là thông tin cạnh tranh, và chứng chỉ agent chỉ
    // đọc — không có lý do để phơi nó ra một bề mặt rộng hơn người bấm nút. Kiểu `BuyerReadRoute`
    // đòi khai cờ này TƯỜNG MINH, nên đây là một quyết định được ghi chứ không một chỗ bỏ trống.
    agent: false,
    // [S1.9101 / S3.3e1] Thân mang thêm `lanNop`, `trangThai` và số nhóm của K2 — đọc cùng một câu với danh sách (lượt soi CAO-1).
    handler: async (ctx) => {
      const ds = await listInvitations(
        ctx.client,
        ctx.orgId,
        { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
        ctx.auditPool,
      );
      if (ds === null) throw new HttpError(404, "khong co goi thau");
      return { status: 200, body: ds };
    },
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/exceptions",
    audience: "BUYER",
    mutates: false,
    // [S1.265 / S3.3b · spec S3 §4.4] Ngoại lệ cạnh tranh của gói, kèm lần rút. Cùng khuôn danh sách lời mời ngay trên — ngoại lệ là
    // một phần của danh sách ấy, nằm trong cùng băm mà người duyệt ký: cổng `rfq.invite` nằm THẲNG trong thân `docNgoaiLe` (rổ
    // `HAM_DOC_CO_QUYEN`), và KHÔNG `agent: true` — lý do vì sao gói không đủ cạnh tranh là dữ liệu kiểm soát của bên mua.
    agent: false,
    // [S1.9101 / S3.3e1] Thân mang thêm `lanNop` và `trangThai`, cùng một câu với danh sách — kể cả khi gói chưa có ngoại lệ nào.
    handler: async (ctx) => {
      const ds = await docNgoaiLe(
        ctx.client,
        ctx.orgId,
        { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
        ctx.auditPool,
      );
      if (ds === null) throw new HttpError(404, "khong co goi thau");
      return { status: 200, body: ds };
    },
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/items",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] hạng mục mua — cái gì, bao nhiêu
    agent: true,
    handler: async (ctx) => ({ status: 200, body: { items: await listRfqItems(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) } }),
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/signals",
    audience: "BUYER",
    mutates: false,
    // [S1.203 / S3.6b1] Tín hiệu chia nhỏ của một gói: tín hiệu hiện tại, việc nó còn chờ ghi nhận không, các hàng đã ghi cùng
    // lần ghi nhận. Không giá nào — bằng chứng chỉ mang id gói, nhóm hàng, phiên bản chính sách, cận bậc, cửa sổ. KHÔNG cho
    // agent: tín hiệu là dữ liệu kiểm soát của bên mua, cùng lý do `/categories`; mở sau là một quyết định có tên.
    // [S3.6b2] Thêm tên và trạng thái các gói trong bằng chứng, họ tên người ghi, và người đang xem ghi nhận được không — danh
    // tính dẫn xuất từ phiên, để màn `/tao-thau` nói trước thay vì để một cú bấm sai vào sổ. Vẫn không một con số nào.
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: {
        tinHieu: await lietKeTinHieu(ctx.client, ctx.orgId, { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }),
      },
    }),
  },
  {
    method: "GET",
    path: "/unseal/:unsealRequestId",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] trạng thái một yêu cầu mở thầu
    agent: true,
    handler: async (ctx) => {
      const r = await getUnsealRequest(ctx.client, ctx.orgId, unsealIdParam(ctx.req));
      if (r === null) throw new HttpError(404, "khong co yeu cau mo thau");
      return { status: 200, body: { unsealRequest: r } };
    },
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/unseal",
    audience: "BUYER",
    mutates: false,
    // [S1.90 / khoản 190] YÊU CẦU MỞ THẦU ĐANG MỞ CỦA GÓI THẦU NÀY — `null` khi không có.
    //
    // `agent: false`, và vế ấy là quyết định chứ không phải sơ suất. Đường `/unseal/:id` ngay
    // trên là `agent: true` vì nó đòi người gọi ĐÃ BIẾT một UUID; đường này biến một id gói thầu
    // — thứ tác tử chỉ-đọc liệt kê được — thành id của một yêu cầu mở thầu, tức nó mở đúng khả
    // năng mà đường kia giữ lại. Một tác tử chỉ-đọc không có việc nào cần khả năng ấy, và ngày
    // nào có thì đổi một dòng cộng một ADR, chứ không phải đọc ngược lại từ sự im lặng hôm nay.
    //
    // KHÔNG 404 khi không có yêu cầu: "gói thầu này chưa ai xin mở" là một câu trả lời ĐÚNG, và
    // người duyệt thứ hai cần phân biệt nó với "không có gói thầu ấy" (404 thật, từ `getRfq`).
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: { unsealRequest: await getOpenUnsealForRfq(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) },
    }),
  },
  // Hai đường ĐỌC CÓ CỔNG (khoản nợ 33): gói tự gọi requirePermission(BID_VIEW). Route là GET vì
  // chúng không đổi trạng thái; cổng nằm trong gói vì mục đích duy nhất của chúng là kiểm soát
  // TIẾT LỘ (A4, A6) — và `auditPool` ở đây là để lần từ chối có bản ghi (D5).
  {
    method: "GET",
    path: "/rfqs/:rfqId/comparison",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] BẢNG SO SÁNH GIÁ — thứ toàn bộ sản phẩm sinh ra để bảo vệ
    //
    // [S1.213 / khoản 108 / ADR-125] HỢP ĐỒNG SỐ của thân trả về: `comparison.rows[].totalAmount` (CHUỖI thập phân, hay
    // `null`) và `comparison.aggregates.min/max/average` là SỐ CHUẨN — tính bằng SQL, đúng tới từng chữ số trong miền
    // `numeric(18, 2)`. `comparison.rows[].payload` là BẢN HIỂN THỊ của phong bì: một số JSON quá 15 chữ số có nghĩa trong đó đã
    // qua `double` khi `pg` phân tích `jsonb`, và qua `JSON.parse` của client thêm lần nữa — client đọc số tiền PHẢI lấy
    // `totalAmount`, không lấy `payload.totalAmount` (`apps/web/trang/mo-thau.js` làm đúng thế). Toàn văn và phép đo ở docstring
    // `buildComparisonTable` (`packages/unseal/src/comparison.ts`); ghim ở `comparison.int.test.ts` khối `[S1.213 / khoản 108]`.
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: {
        comparison: await buildComparisonTable(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/bid-count",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] số ~~hồ sơ thầu đã nhận~~ [S1.249 / khoản 299] báo giá SẼ DỰ THẦU — luồng của lời mời còn sống (khoản 271,
    // ADR-128); tên hàm `countReceivedBids` và trường `bidCount` giữ nguyên (hợp đồng API) — cùng rổ HAM_DOC_CO_QUYEN với bảng giá
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: {
        bidCount: await countReceivedBids(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  // [S1.106 / S2.4] BẢNG XẾP HẠNG của lượt chấm MỚI NHẤT — cùng rổ `HAM_DOC_CO_QUYEN` với hai
  // đường trên, và cùng lý do: cổng `bid.view` nằm THẲNG trong `docBangXepHang`.
  //
  // `null` khi gói thầu chưa được chấm lần nào, KHÔNG 404: "chưa chấm" là một câu trả lời đúng và
  // màn chấm phải phân biệt nó với "không có gói thầu ấy" — cùng khuôn `/rfqs/:rfqId/unseal`
  // (khoản 190). Một mảng rỗng thì nói dối: *"đã chấm, và không ai trong bảng"*.
  // [S1.109 / S2.5] VÒNG BAFO MỚI NHẤT của gói thầu — `null` khi chưa mở vòng nào.
  //
  // KHÔNG cùng rổ `HAM_DOC_CO_QUYEN` với ba đường trên, và vế ấy là một quyết định đo được: hàng
  // này không mang một mức giá nào. Nó mang `topN`, và với một NGƯỜI MUA con số ấy đã đọc được
  // qua `GET /policy` — cổng `bid.view` ở đây sẽ canh một thứ không phải bí mật, rồi làm người
  // đọc tưởng nó là.
  //
  // `agent: false` cùng lý do `/rfqs/:rfqId/unseal` (khoản 190): nó biến một id gói thầu thành
  // id một vòng BAFO, và một tác tử chỉ-đọc không có việc nào cần khả năng ấy.
  {
    method: "GET",
    path: "/rfqs/:rfqId/bafo",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: { bafoRound: await docVongBafo(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) },
    }),
  },
  // [S1.110 / S2.6] AWARD MỚI NHẤT của gói thầu kèm chữ ký duyệt — `null` khi chưa có đề xuất
  // nào. CÙNG rổ `HAM_DOC_CO_QUYEN` với bảng xếp hạng và bảng so sánh, và khác hẳn
  // `/rfqs/:rfqId/bafo` ngay trên: hàng vòng BAFO không nói ai là ai, còn hàng này nói **ai
  // thắng**. Cổng `bid.view` nằm THẲNG trong `docTraoThau` (khoản 33).
  //
  // `agent: false` cùng lý do `/rfqs/:rfqId/ranking`: danh tính người thắng là kết luận đắt nhất
  // mà một tác tử chỉ-đọc đọc được, và không việc nào của `apps/mcp` cần nó.
  {
    method: "GET",
    path: "/rfqs/:rfqId/award",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: {
        award: await docTraoThau(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  // [mảnh 1 / màn xuất bằng chứng] BỘ BẰNG CHỨNG ĐÁNH GIÁ (S2.7, ADR-059) dưới phiên một con
  // người — đúng hai tệp mà `pnpm bang-chung xuat` ghi, cùng byte, vì cả hai đi qua cùng một
  // hàm dựng bundle trong `@trustprocure/danh-gia`. Trả VĂN BẢN của tệp chứ không trả object:
  // nếu trình duyệt tự `JSON.stringify` lại, byte của bundle do trình duyệt quyết chứ không do
  // máy chủ.
  //
  // Cổng `audit.read` + `bid.view` nằm THẲNG trong `xuatBoBangChung` (khoản 33). `agent: false`
  // cùng lý do `/rfqs/:rfqId/ranking`: bundle mang MỌI hàng của MỌI lượt chấm, tức nhiều giá hơn
  // cả bảng xếp hạng. `null` khi gói thầu chưa chấm lần nào — cùng khuôn `GET /award`.
  {
    method: "GET",
    path: "/rfqs/:rfqId/evidence-bundle",
    audience: "BUYER",
    mutates: false,
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: {
        evidenceBundle: await xuatBoBangChung(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "GET",
    path: "/rfqs/:rfqId/ranking",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] THỨ HẠNG — cùng hạng tiết lộ với bảng so sánh, và hơn: nó mang cả `components`,
    // tức từng con số sinh ra `effective_cost`. Tác tử chỉ-đọc không có việc gì ở đây.
    agent: false,
    handler: async (ctx) => ({
      status: 200,
      body: {
        ranking: await docBangXepHang(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
];

// ----------------------------------------------------------------------------------------------
// [S1.157 / khoản 243] THÂN CỦA `POST /rfqs/:rfqId/evaluate` — DANH SÁCH TRẮNG, không mang một
// mức giá nào.
//
// `taoLuotDanhGia` trả cả `lines` — `effectiveCost`, `rank` và `components` của TỪNG báo giá, tức
// GIÁ và THỨ HẠNG. Bản trước trả nguyên kết quả ấy, nên mọi vai giữ `evaluation.perform` — năm
// trên ~~sáu~~ **[S1.241 / khoản 270]** bảy vai, trong đó REQUESTER, BUYER, TECHNICAL KHÔNG giữ `bid.view` (`005`) — đọc được giá
// và hạng của mọi nhà cung cấp ngay trong thân phản hồi của lần bấm chấm. ADR-054 khai `bid.view`
// là cổng ĐỌC duy nhất của `rfq_evaluation_lines`: đường ấy là `GET /rfqs/:rfqId/ranking`
// (`docBangXepHang`), và thân route này là một đường đọc thứ hai không đi qua cổng.
//
// VÌ SAO DỰNG TỪNG TRƯỜNG CHỨ KHÔNG BỎ `lines`: một phép bỏ (`{ ...ld, lines: undefined }`) để lọt
// mọi trường mà `LuotDanhGia` thêm về sau; một danh sách trắng thì trường mới phải được thêm TẠI
// ĐÂY, có chủ đích. Cũng KHÔNG trả số báo giá: `GET /rfqs/:rfqId/bid-count` giữ con số ấy sau cổng
// `bid.view`. Hạng và giá đọc qua `GET /ranking`, với người giữ `bid.view`.
// ----------------------------------------------------------------------------------------------
export function thanLuotCham(ld: LuotDanhGia): {
  readonly evaluationId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly currency: string;
} {
  return { evaluationId: ld.evaluationId, policyId: ld.policyId, policyVersion: ld.policyVersion, currency: ld.currency };
}

/**
 * [S1.249 / khoản 293] Câu 409 của *Gửi lại link* khi gói không nhận báo giá (`RFQ_NOT_ACCEPTING` của `reissueInvitationLink`).
 * Chủ dự án chốt 2026-09-30: GIỮ nút ở mọi trạng thái của tổ chức chưa bật (hợp đồng MVP1 «máy chủ tự từ chối», `nutLoiMoi` của
 * `apps/web/src/tao-thau.ts`), nên câu từ chối là thứ người mua ĐỌC — `/tao-thau` in nguyên văn (`loiCua`). ~~`goi thau khong nhan
 * bao gia`~~ — câu máy, không dấu, không nói khi nào gửi được. Hằng, không nội suy trạng thái hay hạn: câu nêu CẢ HAI điều kiện mà
 * `reissueInvitationLink` đòi (gói `OPEN` còn hạn nộp; vòng BAFO đang mở còn hạn của vòng) — khuôn câu 422 của huỷ mở thầu
 * (`packages/unseal/src/requests.ts`). Ba câu khác của route (404, 409 đã thu hồi, 429) giữ nguyên.
 */
const CAU_GOI_KHONG_NHAN_BAO_GIA =
  "Gói thầu này không nhận báo giá lúc này nên không gửi lại link được — chỉ gửi lại được khi gói đang mở và còn hạn nộp, " +
  "hoặc khi vòng BAFO đang mở và còn hạn.";

// ----------------------------------------------------------------------------------------------
// GHI — mỗi route một mã quyền. `resourceId` đọc từ ĐƯỜNG DẪN, không từ thân.
// ----------------------------------------------------------------------------------------------
const ghi: readonly BuyerWriteRoute[] = [
  // --------------------------------------------------------------------------------------------
  // [S1.106 / S2.4] CHẤM — cạnh `UNSEALED->EVALUATING` của `011`, và nó là route ghi DUY NHẤT mang
  // `evaluation.perform`.
  //
  // Khoản **220** nói ra giới hạn của chính cổng này: `evaluation.perform` do NĂM trên ~~SÁU~~ **[S1.219]** BẢY vai giữ
  // (chỉ `DIRECTOR` không — **[S1.219]** và `DATA_STEWARD` của `083`), nên cổng ở đây là một lớp NÔNG — nó chặn được khách và tác tử, không
  // chặn được "ai trong tổ chức". Ghi ra ở đúng chỗ người đọc mã route sẽ tìm.
  //
  // [S1.219 / khoản 220 ⒝ — chủ dự án chốt 2026-09-30] Cổng này ĐƯỢC GIỮ LÀ LỚP NÔNG, ma trận `005` KHÔNG thu hẹp. Lớp
  // thật của phân tách nhiệm vụ trên đường chấm là J3 theo HÀNH VI ĐÃ XẢY RA trên từng gói (ADR-051, trigger
  // `award_kiem_de_xuat`), không phải danh sách vai. Năm vai giữ mã này được GHIM ở
  // `packages/identity/src/ma-tran-quyen.test.ts` (ca «khoản 220»): ai đổi ma trận thì ca ấy đỏ và phải đọc lại đoạn này
  // cùng chú thích cạnh `requirePermission` trong `taoLuotDanhGia` (`packages/danh-gia/src/luot-danh-gia.ts`).
  //
  // `taoLuotDanhGia` tự gọi `requirePermission` lần nữa với CÙNG mã — khoản nợ 31/33, lớp của gói
  // chứ không của route; xem khối đầu tệp.
  // --------------------------------------------------------------------------------------------
  {
    method: "POST",
    path: "/rfqs/:rfqId/evaluate",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.EVALUATION_PERFORM,
    // [S1.107 / lượt soi ngang 77 — ②] `RFQ`: bộ điều phối ghi cặp này nguyên văn vào hàng
    // sổ `PERMISSION_DENIED`, và lúc ấy lượt đánh giá chưa tồn tại.
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    // [S1.157 / khoản 243] Thân là `thanLuotCham` — xem khối ngay trên mảng này.
    handler: async (ctx) => ({
      status: 201,
      body: {
        evaluation: thanLuotCham(
          await taoLuotDanhGia(
            ctx.client,
            ctx.orgId,
            { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
            ctx.auditPool,
          ),
        ),
      },
    }),
  },
  // --------------------------------------------------------------------------------------------
  // [S1.109 / S2.5] MỞ và ĐÓNG vòng BAFO — cạnh `EVALUATING->BAFO_OPEN` và `BAFO_OPEN->BAFO_CLOSED`
  // của `059`. Cho tới vòng này bốn cạnh BAFO tồn tại và được canh ở tầng CSDL mà KHÔNG đường sản
  // xuất nào đi qua (khoản **227**).
  //
  // Mã quyền RIÊNG `rfq.bafo.open`, chỉ `PROCUREMENT_MANAGER` (ADR-055) — KHÔNG dùng lại
  // `evaluation.perform`: mở vòng BAFO là hành động duy nhất của sản phẩm mà người bấm ĐÃ BIẾT
  // giá của mọi người, và `evaluation.perform` do NĂM trên ~~SÁU~~ **[S1.241 / khoản 270]** BẢY vai giữ (khoản 220).
  //
  // Thân KHÔNG mang `evaluationId`, và đó là vế đóng của một lỗ mà lượt soi hình dạng của vòng
  // này tìm ra: `059` cho người gọi khai lượt chấm nào cũng được, nên vòng BAFO thứ hai mời được
  // top-N của bảng xếp hạng TRƯỚC BAFO. `060` đòi lượt MỚI NHẤT ở tầng CSDL và `moVongBafo` tự
  // suy nó — hai lớp, và không lớp nào đọc một trường do người gọi khai.
  // --------------------------------------------------------------------------------------------
  {
    method: "POST",
    path: "/rfqs/:rfqId/bafo",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_BAFO_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        bafoRound: await moVongBafo(
          ctx.client,
          ctx.orgId,
          {
            rfqId: rfqIdParam(ctx.req),
            deadlineAt: ngayBatBuoc(ctx.req.body, "deadlineAt"),
            actorSessionId: ctx.actor.sessionId,
          },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/bafo/close",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_BAFO_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        bafoRound: await dongVongBafo(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  // --------------------------------------------------------------------------------------------
  // [S1.110 / S2.6] TRAO THẦU — cạnh `EVALUATING->AWARDED` và `AWARDED->EVALUATING` của `061`, và
  // hành động CUỐI của sản phẩm. Ba route, và **hai** mã quyền khác nhau ở đúng chỗ spec §7 đòi
  // hai con người: `award.recommend` để ĐỀ XUẤT, `po.approve` để DUYỆT.
  //
  // Thân KHÔNG mang `evaluationId`, cùng vế đóng mà `060` vừa dựng cho vòng BAFO: `deXuatTraoThau`
  // tự suy lượt chấm MỚI NHẤT. ~~Ở đây nó là lớp DUY NHẤT — `award_kiem_de_xuat` chỉ đòi lượt chấm
  // thuộc đúng RFQ, không đòi nó mới nhất~~ **[S1.231 / khoản 231]** từ `093` tầng CSDL cũng đòi lượt
  // mới nhất (`j5_luot_cham_khong_moi_nhat`) — hai lớp, như vòng BAFO; ca đo ở `luot-danh-gia.int`.
  //
  // HUỶ đi qua `po.approve`, KHÔNG `award.recommend`: `award.recommend` do BỐN vai giữ (kèm
  // `BUYER`), nên một cổng huỷ theo mã ấy cho `BUYER` huỷ được một award ĐÃ DUYỆT rồi đề xuất
  // người khác — phê duyệt kép bị tháo bằng cách bào mòn. ~~Cái giá: người đề xuất không tự rút lại
  // được (khoản **232**).~~ **[S1.231 / khoản 232 / ADR-133]** Route THỨ TƯ `…/award/withdraw` dưới
  // `award.recommend`: người đề xuất RÚT đề xuất CHƯA chữ ký của mình — ba vế ràng ở CSDL (`094`), không
  // một cổng quyền đọc dữ liệu nào ở đây, và cổng huỷ không đổi.
  // --------------------------------------------------------------------------------------------
  {
    method: "POST",
    path: "/rfqs/:rfqId/award",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.AWARD_RECOMMEND,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        award: await deXuatTraoThau(
          ctx.client,
          ctx.orgId,
          {
            rfqId: rfqIdParam(ctx.req),
            bidVersionId: uuidBody(ctx.req.body, "bidVersionId"),
            reason: chuoiBatBuoc(ctx.req.body, "reason"),
            actorSessionId: ctx.actor.sessionId,
          },
          ctx.auditPool,
        ),
      },
    }),
  },
  // `awardId` đi trong ĐƯỜNG DẪN, không trong thân: người duyệt ký lên đúng đề xuất họ đã đọc, và
  // một lời gọi chỉ theo `rfqId` sẽ ký lên đề xuất MỚI trong im lặng nếu đề xuất kia vừa bị huỷ và
  // dựng lại. `resourceId` vẫn là `rfqId` — hàng sổ `PERMISSION_DENIED` nói về gói thầu, và
  // `duyetTraoThau` đối chiếu hai id để hàng sổ ấy không gọi tên sai gói.
  {
    method: "POST",
    path: "/rfqs/:rfqId/award/:awardId/approve",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.PO_APPROVE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        award: await duyetTraoThau(
          ctx.client,
          ctx.orgId,
          {
            rfqId: rfqIdParam(ctx.req),
            awardId: awardIdParam(ctx.req),
            actorSessionId: ctx.actor.sessionId,
          },
          ctx.auditPool,
        ),
      },
    }),
  },
  // [S1.261 / khoản 335] ~~`/rfqs/:rfqId/award/cancel`~~ — huỷ theo GÓI: hàng mới nhất của gói, bất kể người huỷ đã đọc hàng
  // nào. Nay `awardId` đi trong ĐƯỜNG DẪN, cùng lý do với route duyệt ở trên: người huỷ huỷ đúng trao thầu họ đã đọc, và
  // `huyTraoThau` từ chối khi nó không còn là hàng mới nhất của gói (rút rồi đề xuất lại, hay vừa được duyệt).
  {
    method: "POST",
    path: "/rfqs/:rfqId/award/:awardId/cancel",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.PO_APPROVE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        award: await huyTraoThau(
          ctx.client,
          ctx.orgId,
          {
            rfqId: rfqIdParam(ctx.req),
            awardId: awardIdParam(ctx.req),
            reason: chuoiBatBuoc(ctx.req.body, "reason"),
            actorSessionId: ctx.actor.sessionId,
          },
          ctx.auditPool,
        ),
      },
    }),
  },
  // [S1.231 / khoản 232 / ADR-133] RÚT đề xuất — cổng `award.recommend`, cùng cổng với lần đề xuất. Không `awardId`: hàng
  // mới nhất là đích, và `094` từ chối nếu nó không phải `PROPOSED` của chính người gọi với 0 chữ ký.
  {
    method: "POST",
    path: "/rfqs/:rfqId/award/withdraw",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.AWARD_RECOMMEND,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        award: await rutDeXuatTraoThau(
          ctx.client,
          ctx.orgId,
          {
            rfqId: rfqIdParam(ctx.req),
            reason: chuoiBatBuoc(ctx.req.body, "reason"),
            actorSessionId: ctx.actor.sessionId,
          },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/policy",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.POLICY_MANAGE,
    resourceType: "PROCUREMENT_POLICY",
    handler: async (ctx) => {
      // [review H2-3] `version` do người gọi chọn + cột `integer` + trigger 022 "phải LỚN HƠN" + không
      // UPDATE/DELETE ⇒ một `version: 2147483647` GHIM tổ chức vào chính sách ấy vĩnh viễn. Ở tầng
      // HTTP, `version` chỉ là GIÁ TRỊ KỲ VỌNG (chống đua): phải bằng phiên bản ~~hiện hành~~ MỚI NHẤT + 1.
      // ~~Vế CSDL (trigger tự gán `max + 1`) chưa làm — sổ nợ, xem STATE.~~ [`035`, sổ nợ 45 đã đóng] trigger đòi ĐÚNG lớn nhất + 1.
      // [S1.169 / S3.1c] ~~`getActiveProcurementPolicy` + 1~~ Từ S1.156 phiên bản HIỆU LỰC có thể đi sau phiên bản MỚI NHẤT:
      // một phiên bản có bậc chưa ký không có hiệu lực (ADR-082 ⑺). Tính theo bản hiệu lực thì route đòi một số mà trigger
      // `035` từ chối, và tổ chức không tạo được phiên bản nào nữa cho tới khi bản kia được ký. Nay tính theo bản mới nhất —
      // đúng số trigger đòi — đọc qua `lietKePhienBanChinhSach`, câu không tự chọn phiên bản (S1.156).
      const version = soNguyen(ctx.req.body, "version");
      const moiNhat = (await lietKePhienBanChinhSach(ctx.client, ctx.orgId)).phienBan[0];
      const keTiep = (moiNhat?.version ?? 0) + 1;
      if (version !== keTiep) throw new HttpError(422, `trường "version" phải bằng phiên bản mới nhất + 1 (${keTiep})`);
      const policy = await createProcurementPolicy(ctx.client, ctx.orgId, {
        version,
        dualApprovalThreshold: chuoiBatBuoc(ctx.req.body, "dualApprovalThreshold"),
        currency: tienTe(ctx.req.body),
        // [S1.107 / CAO ②] Hai trường TUỲ CHỌN đi thành một BỘ — `056` đòi
        // `(eval_components IS NULL) = (bafo_top_n IS NULL)`, và `packages/rfq` ném một lỗi
        // CÓ TÊN khi chỉ một trong hai được khai, thay vì để người gọi đọc một `23514`.
        evalComponents: mangTrongSo(ctx.req.body, "evalComponents"),
        bafoTopN: soNguyenTuyChon(ctx.req.body, "bafoTopN"),
        // [S1.169 / S3.1c] Bậc giá trị và hai cột mức — cùng khuôn: cửa này kiểm hình dạng ngoài, `069` phán phần còn lại.
        tiers: mangObjectTuyChon(ctx.req.body, "tiers"),
        chiaNhoCuaSoNgay: soNguyenTuyChon(ctx.req.body, "chiaNhoCuaSoNgay"),
        thamDinhHieuLucThang: soNguyenTuyChon(ctx.req.body, "thamDinhHieuLucThang"),
        // [S1.256 / S4.5b] Nhóm khoá `benchmark` — cửa này kiểm hình dạng ngoài, `CHECK` của `103` phán phần còn lại.
        benchmark: objectChuoiTuyChon(ctx.req.body, "benchmark"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { policy } };
    },
  },
  {
    method: "POST",
    path: "/policy/:policyId/sign",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.POLICY_MANAGE,
    resourceType: "PROCUREMENT_POLICY",
    resourceId: policyIdParam,
    handler: async (ctx) => {
      // [S1.169 / S3.1c / ADR-105] Lần ký đầu tiên của một phiên bản có bậc BẬT S3 cho tổ chức, một chiều, trong khi
      // K2–K12 chưa có — bậc hiện ra mà chưa được cưỡng chế (spec §8.1). Cờ triển khai mặc định TẮT; đọc TRƯỚC mọi câu ghi.
      if (!ctx.choKyChinhSach) {
        throw new HttpError(409, "Ký phiên bản chính sách chưa mở trên máy chủ này: S3 chưa đủ chốt để bật (ADR-105)");
      }
      const chuKy = await kyPhienBanChinhSach(ctx.client, ctx.orgId, {
        policyId: policyIdParam(ctx.req),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { chuKy } };
    },
  },
  {
    method: "POST",
    path: "/categories",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.CATEGORY_MANAGE,
    resourceType: "PROCUREMENT_CATEGORY",
    handler: async (ctx) => {
      const nhomHang = await taoNhomHang(
        ctx.client,
        ctx.orgId,
        { ma: chuoiBatBuoc(ctx.req.body, "ma"), ten: chuoiBatBuoc(ctx.req.body, "ten"), actorSessionId: ctx.actor.sessionId },
        ctx.auditPool,
      );
      return { status: 201, body: { nhomHang } };
    },
  },
  {
    method: "PUT",
    path: "/categories/:categoryId/status",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.CATEGORY_MANAGE,
    resourceType: "PROCUREMENT_CATEGORY",
    resourceId: categoryIdParam,
    handler: async (ctx) => {
      // [S1.201 / S3.6a] `conDung: false` là ngừng dùng, `true` là dùng lại — một hàng đổi MỚI, không sửa hàng nào. Gói đang
      // giữ nhóm ấy không đổi; ngừng dùng chỉ chặn lần gán mới.
      const nhomHang = await doiTrangThaiNhomHang(
        ctx.client,
        ctx.orgId,
        { categoryId: categoryIdParam(ctx.req), conDung: booleanBatBuoc(ctx.req.body, "conDung"), actorSessionId: ctx.actor.sessionId },
        ctx.auditPool,
      );
      return { status: 200, body: { nhomHang } };
    },
  },
  {
    method: "POST",
    path: "/suppliers",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.SUPPLIER_MANAGE,
    resourceType: "SUPPLIER",
    handler: async (ctx) => {
      const supplier = await createSupplier(ctx.client, ctx.orgId, {
        legalName: chuoiBatBuoc(ctx.req.body, "legalName"),
        taxCode: chuoiTuyChon(ctx.req.body, "taxCode"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { supplier } };
    },
  },
  {
    method: "POST",
    path: "/suppliers/:supplierId/contacts",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.SUPPLIER_MANAGE,
    resourceType: "SUPPLIER",
    resourceId: supplierIdParam,
    handler: async (ctx) => {
      const contact = await addSupplierContact(ctx.client, ctx.orgId, {
        supplierId: supplierIdParam(ctx.req),
        fullName: chuoiBatBuoc(ctx.req.body, "fullName"),
        email: chuoiBatBuoc(ctx.req.body, "email"),
        phone: chuoiTuyChon(ctx.req.body, "phone"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { contact } };
    },
  },
  {
    method: "POST",
    path: "/suppliers/:supplierId/verify",
    audience: "BUYER",
    mutates: true,
    // [S1.196 / S3.3a / K8a · ADR-084 ⑵] Xác minh nội bộ nhà cung cấp. Cổng của bộ điều phối là `supplier.qualify`; trigger
    // `ncc_kiem_xac_minh` đòi thêm luật người, và hai nhánh ấy vào sổ `CONTROL_DENIED` (422 kèm thông điệp của bảng chốt).
    permission: PERMISSIONS.SUPPLIER_QUALIFY,
    resourceType: "SUPPLIER",
    resourceId: supplierIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        verification: await xacMinhNhaCungCap(
          ctx.client,
          ctx.orgId,
          // [S1.9101 / S3.3e1 — lượt soi CAO-2] Băm hồ sơ mà người xác minh đã thấy (`GET /supplier-verifications`); lệch ⇒ 422.
          { supplierId: supplierIdParam(ctx.req), actorSessionId: ctx.actor.sessionId, bamDaXem: chuoiBatBuoc(ctx.req.body, "bamDaXem") },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/suppliers/:supplierId/verification/revoke",
    audience: "BUYER",
    mutates: true,
    // [S1.196 / S3.3a / K8a] Thu hồi xác minh — lý do bắt buộc và vào sổ.
    permission: PERMISSIONS.SUPPLIER_QUALIFY,
    resourceType: "SUPPLIER",
    resourceId: supplierIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        verification: await thuHoiXacMinhNhaCungCap(
          ctx.client,
          ctx.orgId,
          { supplierId: supplierIdParam(ctx.req), reason: chuoiBatBuoc(ctx.req.body, "reason"), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    handler: async (ctx) => {
      const rfq = await createRfq(ctx.client, ctx.orgId, {
        title: chuoiBatBuoc(ctx.req.body, "title"),
        deadlineAt: ngayTuyChon(ctx.req.body, "deadlineAt"),
        createdBySessionId: ctx.actor.sessionId,
        // [S1.201 / S3.6a] Nhóm hàng — tuỳ chọn lúc tạo; tổ chức đã bật đòi nó trước lần nộp duyệt.
        categoryId: uuidTuyChon(ctx.req.body, "categoryId"),
      });
      return { status: 201, body: { rfq } };
    },
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/items",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const item = await addRfqItem(ctx.client, ctx.orgId, {
        rfqId: rfqIdParam(ctx.req),
        lineNo: soNguyen(ctx.req.body, "lineNo"),
        description: chuoiBatBuoc(ctx.req.body, "description"),
        quantity: chuoiBatBuoc(ctx.req.body, "quantity"),
        unit: chuoiBatBuoc(ctx.req.body, "unit"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 201, body: { item } };
    },
  },
  {
    method: "PUT",
    path: "/rfqs/:rfqId/budget",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const budget = await setRfqBudget(ctx.client, ctx.orgId, {
        rfqId: rfqIdParam(ctx.req),
        estimatedValue: chuoiBatBuoc(ctx.req.body, "estimatedValue"),
        currency: tienTe(ctx.req.body),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 200, body: { budget } };
    },
  },
  {
    method: "PUT",
    path: "/rfqs/:rfqId/category",
    audience: "BUYER",
    mutates: true,
    // [S1.201 / S3.6a] Cùng cổng với ngân sách và hạng mục: nhóm hàng là một phần của gói đang soạn, người soạn đặt nó.
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const rfq = await datNhomHangChoGoi(ctx.client, ctx.orgId, {
        rfqId: rfqIdParam(ctx.req),
        categoryId: uuidBody(ctx.req.body, "categoryId"),
        actorSessionId: ctx.actor.sessionId,
      });
      return { status: 200, body: { rfq } };
    },
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/submit",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const rfqId = rfqIdParam(ctx.req);
      const rfq = await submitRfqForApproval(ctx.client, ctx.orgId, { rfqId, actorSessionId: ctx.actor.sessionId }, ctx.auditPool);
      // [S1.234 / S4.3b / ADR-135] Lượt chuẩn hoá chạy SAU commit, giao dịch riêng, dưới phiên người nộp (spec S4 §4.4): hỏng thì
      // lần nộp vẫn đứng, người quản lý dữ liệu bấm *chuẩn hoá lại*. [lượt soi L3] Điều kiện *tổ chức có hàng chuẩn đang dùng* hỏi
      // NGAY ĐÂY, trong giao dịch của lần nộp: tổ chức MVP1 không đăng ký việc nào — không thêm kết nối, giao dịch hay dòng log. Hàng
      // cuối cùng ngừng dùng giữa lúc hỏi và lúc chạy thì lượt chạy với tập ứng viên rỗng: gợi ý `CAN_DUYET` không ứng viên, vô hại.
      if (await coHangChuanDangDung(ctx.client, ctx.orgId)) {
        ctx.afterCommitGiaoDich(async (c) => {
          await chuanHoaGoi(c, ctx.orgId, { rfqId, actorSessionId: ctx.actor.sessionId });
        });
      }
      return { status: 200, body: { rfq } };
    },
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/approve",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_APPROVE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    // [S1.198 / khoản 256] Thân `{lanNop}` TUỲ CHỌN ở route: lần nộp người duyệt đã xem (`GET /rfqs/:rfqId` trả `rfq.lanNop`).
    // Route không hỏi tổ chức đã bật chưa — trigger `rfq_approvals_so_lan_nop` đòi nó ở tổ chức đã bật (422 có tên khi vắng hay
    // lệch), còn tổ chức chưa bật giữ hợp đồng MVP1: không thân vẫn duyệt được.
    handler: async (ctx) => {
      await approveRfq(
        ctx.client,
        ctx.orgId,
        { rfqId: rfqIdParam(ctx.req), sessionId: ctx.actor.sessionId, lanNopDaXem: soNguyenTuyChon(ctx.req.body, "lanNop") },
        ctx.auditPool,
      );
      return { status: 200, body: { rfq: await getRfq(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) } };
    },
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/signals/acknowledge",
    audience: "BUYER",
    mutates: true,
    // [S1.203 / S3.6b1 · K10a] Ghi nhận tín hiệu chia nhỏ HIỆN TẠI của gói đang chờ duyệt, kèm lý do — cùng cổng với duyệt gói.
    // Hàm gói hỏi lại cùng mã, rồi luật người (không tạo, không nộp gói nào trong bằng chứng, không khai phiên bản chính sách
    // mà gói ghim) — lời từ chối vào sổ `CONTROL_DENIED`. Bằng chứng đã đổi sau lần nộp thì tín hiệu mới được lưu ở đây.
    permission: PERMISSIONS.RFQ_APPROVE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        ghiNhan: await ghiNhanTinHieu(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), lyDo: chuoiBatBuoc(ctx.req.body, "lyDo"), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/open",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    // [S1.188 / S3.2b2 / ADR-113 · K6] Tổ chức đã bật S3: lời mời dựng ở DRAFT chưa có token, nên phiên người mở đúc một token cho
    // MỖI lời mời còn sống ngay trong giao dịch mở gói, và link đi SAU commit — mỗi link một lần gửi (at-most-once). Gửi được ⇒
    // lời mời `SENT`; gửi hỏng hay quá trần ⇒ token vừa đúc bị thu hồi, lời mời ở lại `UNSENT` và còn sống — người mua gửi lại
    // bằng route của ADR-110. Gói ĐÃ mở và không lùi được, nên phản hồi vẫn `200`, kèm id các lời mời chưa gửi (chủ dự án chọn
    // ngày 2026-09-28). Tổ chức chưa bật: không đúc, không gửi gì — lời mời MVP1 có link từ lúc mời — và danh sách rỗng.
    handler: async (ctx) => {
      const rfq = await openRfq(
        ctx.client,
        ctx.orgId,
        { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId, orgKeys: ctx.services.orgKeyProvisioner },
        ctx.auditPool,
      );
      const links = await ducTokenKhiMoGoi(ctx.client, ctx.orgId, { rfqId: rfq.id, actorSessionId: ctx.actor.sessionId });
      if (links.length > 0) {
        const { orgId } = ctx;
        const phienNguoiMo = ctx.actor.sessionId;
        ctx.afterCommitLoGui({
          lanGui: links.map((l) => ({
            khoa: l.invitationId,
            gui: () =>
              ctx.services.invitationLinkSender.send({
                orgId,
                invitationId: l.invitationId,
                channel: l.channel,
                destination: l.destination,
                token: l.token.token,
              }),
            khiXong: async (client) => {
              await danhDauDaGui(client, orgId, l.invitationId);
            },
            bu: async (client) => {
              await revokeMagicLinkToken(client, orgId, {
                tokenId: l.token.tokenId,
                invitationId: l.invitationId,
                actorSessionId: phienNguoiMo,
                reason: "LINK_SEND_FAILED",
              });
            },
          })),
          phanHoi: (r, khoaHong) => ({ ...r, body: { rfq, unsentInvitationIds: khoaHong } }),
        });
      }
      return { status: 200, body: { rfq, unsentInvitationIds: [] } };
    },
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/extend",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        rfq: await extendRfqDeadline(ctx.client, ctx.orgId, {
          rfqId: rfqIdParam(ctx.req),
          newDeadlineAt: ngayBatBuoc(ctx.req.body, "newDeadlineAt"),
          reason: chuoiBatBuoc(ctx.req.body, "reason"),
          actorSessionId: ctx.actor.sessionId,
        }),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/close",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        rfq: await closeRfq(ctx.client, ctx.orgId, {
          rfqId: rfqIdParam(ctx.req),
          reason: chuoiBatBuoc(ctx.req.body, "reason"),
          actorSessionId: ctx.actor.sessionId,
        }),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/cancel",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CANCEL,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        rfq: await cancelRfq(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), reason: chuoiBatBuoc(ctx.req.body, "reason"), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/return-to-draft",
    audience: "BUYER",
    mutates: true,
    // [S1.186 / S3.2b1 / K4a · ADR-084 ⑵] Cổng của bộ điều phối là `rfq.create`; hàm gói hỏi tiếp đúng nhánh — người tạo gói
    // giữ `rfq.create`, người khác phải giữ `rfq.approve` —, và mỗi lần từ chối vào sổ. Mọi vai giữ `rfq.approve` hôm nay cũng
    // giữ `rfq.create` (test ghim), nên cổng này không chặn oan người duyệt nào. Chỉ tổ chức đã bật S3; lý do bắt buộc.
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        rfq: await returnRfqToDraft(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), reason: chuoiBatBuoc(ctx.req.body, "reason"), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  // [S1.265 / S3.3b · spec S3 §4.4 · K4a] Ngoại lệ cạnh tranh. Cổng của bộ điều phối là `rfq.invite` (ADR-084 ⑵), hàm gói hỏi lại
  // cùng mã; trigger `ngoai_le_kiem` chặn ngoài DRAFT, và lần chặn ấy vào sổ `CONTROL_DENIED` (`K4A_NGOAI_LE_SAI_TRANG_THAI`). Chỉ
  // tổ chức đã bật S3.
  {
    method: "POST",
    path: "/rfqs/:rfqId/exceptions",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_INVITE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        exception: await lapNgoaiLe(
          ctx.client,
          ctx.orgId,
          {
            rfqId: rfqIdParam(ctx.req),
            loai: chuoiBatBuoc(ctx.req.body, "loai"),
            maLyDo: chuoiBatBuoc(ctx.req.body, "maLyDo"),
            giaiTrinh: chuoiBatBuoc(ctx.req.body, "giaiTrinh"),
            actorSessionId: ctx.actor.sessionId,
          },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/exceptions/:exceptionId/withdraw",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_INVITE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        exception: await rutNgoaiLe(
          ctx.client,
          ctx.orgId,
          {
            rfqId: rfqIdParam(ctx.req),
            exceptionId: exceptionIdParam(ctx.req),
            reason: chuoiBatBuoc(ctx.req.body, "reason"),
            actorSessionId: ctx.actor.sessionId,
          },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/invitations",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_INVITE,
    resourceType: "INVITATION",
    // [review H2-9] RFQ bị mời nằm trong đường dẫn — bản ghi PERMISSION_DENIED (D5) phải mang nó.
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const supplierId = uuidBody(ctx.req.body, "supplierId");
      const contactId = uuidBody(ctx.req.body, "contactId");
      // [review H2-9 ⑵] "Người liên hệ thuộc nhà cung cấp" kiểm TRƯỚC khi tạo lời mời và phát token —
      // CSDL chỉ có FK `(org_id, contact_id)`, không ràng `contact ∈ supplier`; bản trước kiểm SAU và
      // dựa vào rollback của `withTenant` để vứt `INVITATION_CREATED` + token. Đích của link đọc từ
      // `supplier_contacts` — không từ thân yêu cầu (cùng kỷ luật với OTP, ADR-015 [C1]).
      const lienHe = (await listSupplierContacts(ctx.client, ctx.orgId, supplierId)).find((c) => c.id === contactId);
      if (lienHe === undefined) throw new HttpError(422, "nguoi lien he khong thuoc nha cung cap");
      const loi = await createInvitation(ctx.client, ctx.orgId, {
        rfqId: rfqIdParam(ctx.req),
        supplierId,
        contactId,
        linkChannel: kenhTuyChon(ctx.req.body),
        actorSessionId: ctx.actor.sessionId,
      }, ctx.auditPool);
      // [S1.188 / S3.2b2 / ADR-113 · K4a · K6] Tổ chức đã bật S3. Nhánh đọc điều TRIGGER đã quyết lúc chèn (`076`), không đọc một
      // lời khai: lời mời của tổ chức đã bật luôn chèn là `UNSENT`, và nhãn *mời sau khi ký* là `true` đúng khi gói đang `OPEN` —
      // hai trạng thái duy nhất nhận lời mời ở đó. Tổ chức chưa bật giữ `SENT` của `010` và đi nguyên hợp đồng [S1.70] bên dưới.
      if (loi.status === "UNSENT") {
        // DRAFT: dựng danh sách, không đúc token, không gửi — link đi lúc mở gói (`POST /rfqs/:rfqId/open`).
        if (!loi.moiSauKhiKy) return { status: 201, body: { invitation: loi } };
        // OPEN — mời sau khi ký: đúc và gửi ngay, SAU commit. Gửi hỏng thì KHÔNG thu hồi lời mời — K4a cấm thu hồi ở `OPEN`, và
        // thu hồi là thu hẹp một danh sách đã ký — mà thu hồi token vừa đúc, như phần bù của ADR-110; lời mời ở lại `UNSENT`, còn
        // sống, và người mua gửi lại được ngay. Lời mời đã có thật, không lùi được, nên phản hồi vẫn `201` — trạng thái trong thân
        // nói link đã đi chưa (cùng lý do với `200` của lần mở gói).
        const tMoi = await issueMagicLinkToken(ctx.client, ctx.orgId, { invitationId: loi.id, actorSessionId: ctx.actor.sessionId });
        const { orgId } = ctx;
        const phienNguoiMoi = ctx.actor.sessionId;
        const chuaGui: ApiResponse = { status: 201, body: { invitation: loi } };
        ctx.afterCommitCoBu({
          viec: () =>
            ctx.services.invitationLinkSender.send({
              orgId,
              invitationId: loi.id,
              channel: loi.linkChannel,
              destination: loi.linkChannel === "EMAIL" ? lienHe.email : (lienHe.phone ?? ""),
              token: tMoi.token,
            }),
          khiXong: async (client) => {
            await danhDauDaGui(client, orgId, loi.id);
          },
          bu: async (client) => {
            await revokeMagicLinkToken(client, orgId, { tokenId: tMoi.tokenId, invitationId: loi.id, actorSessionId: phienNguoiMoi, reason: "LINK_SEND_FAILED" });
          },
          phanHoiKhiHong: chuaGui,
          // Phần bù hỏng: token vừa đúc còn sống, có thể chưa tới nơi. Lối của người mua không đổi — gửi lại thu hồi mọi token chưa dùng.
          phanHoiKhiBuHong: chuaGui,
        });
        return { status: 201, body: { invitation: { ...loi, status: "SENT" } } };
      }
      const t = await issueMagicLinkToken(ctx.client, ctx.orgId, { invitationId: loi.id, actorSessionId: ctx.actor.sessionId });
      // Token đi tới bộ gửi TIÊM vào và KHÔNG về client.
      // [S1.70 / khoản 124] Trước khoản này bộ gửi được `await` ngay tại đây, TRONG giao dịch — hai lần `appendAuditEvent` ở trên giữ khoá tư
      // vấn ghi sổ của tổ chức tới hết giao dịch, nên lần gửi giữ khoá ấy suốt độ trễ của bộ gửi (đo, biên bản §S1.70: bộ gửi chậm 3 s ⇒
      // khoá khoảng 3,0 s; treo ⇒ 60 s). Nay gửi SAU commit: bộ gửi nhận một token đã tồn tại, không giao dịch nào đứng chờ nó. Gửi hỏng hay
      // quá trần ⇒ lời mời bị thu hồi trong giao dịch mới và phản hồi là `502` — `201` vẫn nghĩa là bộ gửi đã báo xong trong trần (lượt soi
      // 64b-21), và người mua gọi lại được ngay (024: một lời mời CÒN SỐNG cho mỗi nhà cung cấp) — TRỪ khi lần thu hồi bù cũng hỏng (phiên người mời vừa bị thu hồi, pool
      // đầy quá 5 s, mất kết nối): khi ấy lời mời còn sống mà link chưa đi, và phản hồi `500` mang `invitationId` để người mua thu hồi bằng
      // `POST /invitations/:invitationId/revoke` rồi mời lại — không route đọc nào khác trả id ấy (lượt soi 64a-1). Chủ dự án chọn hai hợp
      // đồng này ngày 2026-09-13 — ADR-020 tiểu mục [S1.70 / khoản 124].
      ctx.afterCommitCoBu({
        viec: () =>
          ctx.services.invitationLinkSender.send({
            orgId: ctx.orgId,
            invitationId: loi.id,
            channel: loi.linkChannel,
            destination: loi.linkChannel === "EMAIL" ? lienHe.email : (lienHe.phone ?? ""),
            token: t.token,
          }),
        bu: async (client) => {
          await revokeInvitation(client, ctx.orgId, { invitationId: loi.id, actorSessionId: ctx.actor.sessionId, reason: "LINK_SEND_FAILED" }, ctx.auditPool);
        },
        phanHoiKhiHong: { status: 502, body: { error: "khong gui duoc link moi, loi moi da thu hoi" } },
        phanHoiKhiBuHong: { status: 500, body: { error: "khong gui duoc link moi va chua thu hoi duoc loi moi", invitationId: loi.id } },
      });
      return { status: 201, body: { invitation: loi } };
    },
  },
  {
    method: "POST",
    path: "/invitations/:invitationId/revoke",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_INVITE,
    resourceType: "INVITATION",
    resourceId: invitationIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        revoked: await revokeInvitation(
          ctx.client,
          ctx.orgId,
          { invitationId: invitationIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/invitations/:invitationId/reissue",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_INVITE,
    resourceType: "INVITATION",
    resourceId: invitationIdParam,
    // [S1.181 / ADR-110] Gửi lại link cho CÙNG lời mời còn sống — đường quay lại của nhà cung cấp đã thoát phiên hay hết phiên
    // 4 giờ, về đúng hồ sơ báo giá của mình. Mời lại thì 409 (024), còn thu hồi rồi mời lại là một lời mời và một luồng báo giá
    // MỚI. Điều kiện và trần nằm trong `reissueInvitationLink`; đích đọc từ `supplier_contacts` như route mời (ADR-015 [C1]);
    // gửi SAU commit như route mời (khoản 124). Gửi hỏng ⇒ phần bù thu hồi ĐÚNG token vừa phát — lời mời giữ nguyên.
    handler: async (ctx) => {
      const kq = await reissueInvitationLink(ctx.client, ctx.orgId, { invitationId: invitationIdParam(ctx.req), actorSessionId: ctx.actor.sessionId });
      if (!kq.ok) {
        if (kq.reason === "NOT_FOUND") throw new HttpError(404, "khong co loi moi");
        if (kq.reason === "REVOKED") throw new HttpError(409, "loi moi da thu hoi");
        // ~~`"goi thau khong nhan bao gia"`~~ [S1.249 / khoản 293] câu người đọc nêu điều kiện gửi lại được.
        if (kq.reason === "RFQ_NOT_ACCEPTING") throw new HttpError(409, CAU_GOI_KHONG_NHAN_BAO_GIA);
        return { status: 429, body: { error: "da gui qua nhieu link cho loi moi nay" }, headers: { "retry-after": String(CUA_SO_LINK_MOI_GIAY) } };
      }
      const loi = kq.invitation;
      const lienHe = (await listSupplierContacts(ctx.client, ctx.orgId, loi.supplierId)).find((c) => c.id === loi.contactId);
      if (lienHe === undefined) throw new HttpError(409, "nguoi lien he cua loi moi khong con");
      const t = kq.token;
      ctx.afterCommitCoBu({
        viec: () =>
          ctx.services.invitationLinkSender.send({
            orgId: ctx.orgId,
            invitationId: loi.id,
            channel: loi.linkChannel,
            destination: loi.linkChannel === "EMAIL" ? lienHe.email : (lienHe.phone ?? ""),
            token: t.token,
          }),
        bu: async (client) => {
          await revokeMagicLinkToken(client, ctx.orgId, { tokenId: t.tokenId, invitationId: loi.id, actorSessionId: ctx.actor.sessionId, reason: "LINK_SEND_FAILED" });
        },
        // [S1.188 / S3.2b2 / ADR-113 · K6] Lời mời *chưa gửi* của tổ chức đã bật — lần mở gói hay lần mời ở `OPEN` gửi hỏng — thành
        // `SENT` khi lần gửi lại đi được. Lời mời MVP1 đã `SENT` từ lúc mời: không đăng ký gì, hợp đồng của route giữ nguyên.
        khiXong:
          loi.status === "UNSENT"
            ? async (client) => {
                await danhDauDaGui(client, ctx.orgId, loi.id);
              }
            : undefined,
        // [lượt soi] Thân 502 nói cả điều bên mua không tự thấy: link CŨ chưa dùng đã hết hiệu lực ở giao dịch vừa commit, và
        // lần gửi hỏng vẫn tính vào trần — nên sau lần hỏng, nhà cung cấp không còn link nào cho tới lần gửi được.
        phanHoiKhiHong: { status: 502, body: { error: "khong gui duoc link moi; link moi da thu hoi, link cu chua dung da het hieu luc" } },
        phanHoiKhiBuHong: { status: 500, body: { error: "khong gui duoc link moi va chua thu hoi duoc link moi" } },
      });
      // [lượt soi] ~~`revokedLinks`~~ — số link cũ bị thu hồi là 0 khi nhà cung cấp ĐÃ xác minh link (token tiêu thụ) và 1 khi
      // chưa: thân phản hồi ấy cho `BUYER`, vai không giữ `bid.view`, biết nhà cung cấp nào đã vào phiên trước hạn (A6 giấu cả
      // số báo giá). Con số chỉ nằm trong sổ (`INVITATION_LINK_REISSUED`), dưới quyền đọc sổ.
      return { status: 200, body: { reissued: true } };
    },
  },
  {
    method: "POST",
    path: "/invitations/:invitationId/unlock",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.INVITATION_UNLOCK,
    resourceType: "INVITATION",
    resourceId: invitationIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: await clearOtpLockout(ctx.client, ctx.orgId, { invitationId: invitationIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool),
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/unseal",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_UNSEAL,
    resourceType: "UNSEAL_REQUEST",
    // [review H2-9] RFQ được yêu cầu mở nằm trong đường dẫn — bản ghi PERMISSION_DENIED phải mang nó.
    resourceId: rfqIdParam,
    // [review lượt 2] `breakGlass: true` qua HTTP hôm nay LUÔN 422: `requestUnseal` đòi
    // `breakGlassWitnessSessionId` (phiên của người làm chứng) mà route không có cách nào truyền —
    // đường break-glass qua HTTP CHƯA ĐI ĐƯỢC, ghi ở §4 của D4, không phải một tính năng đã có.
    handler: async (ctx) => {
      const breakGlass = truong(ctx.req.body, "breakGlass");
      if (breakGlass !== undefined && typeof breakGlass !== "boolean") throw new HttpError(422, 'trường "breakGlass" phải là boolean');
      const r = await requestUnseal(
        ctx.client,
        ctx.orgId,
        {
          rfqId: rfqIdParam(ctx.req),
          reason: chuoiBatBuoc(ctx.req.body, "reason"),
          actorSessionId: ctx.actor.sessionId,
          ...(breakGlass === true ? { breakGlass: true } : {}),
        },
        ctx.auditPool,
      );
      return { status: 201, body: { unsealRequest: r } };
    },
  },
  {
    method: "POST",
    path: "/unseal/:unsealRequestId/approve",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_UNSEAL_APPROVE,
    resourceType: "UNSEAL_REQUEST",
    resourceId: unsealIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { unsealRequest: await approveUnseal(ctx.client, ctx.orgId, { unsealRequestId: unsealIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
  },
  {
    method: "POST",
    path: "/unseal/:unsealRequestId/dispatch",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_UNSEAL,
    resourceType: "UNSEAL_REQUEST",
    resourceId: unsealIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { gate: await dispatchUnseal(ctx.client, ctx.orgId, { unsealRequestId: unsealIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
  },
  {
    method: "POST",
    path: "/unseal/:unsealRequestId/cancel",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_UNSEAL,
    resourceType: "UNSEAL_REQUEST",
    resourceId: unsealIdParam,
    handler: async (ctx) => {
      try {
        return {
          status: 200,
          body: { unsealRequest: await cancelUnseal(ctx.client, ctx.orgId, { unsealRequestId: unsealIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
        };
      } catch (loi) {
        // [S1.245 / khoản 267] Lần từ chối vì TRẠNG THÁI (yêu cầu đã `EXECUTED`/`CANCELLED`) mang `ma` ở thân 422 — khuôn khoản 230:
        // `error` là câu riêng, `ma` là thứ máy khách đọc. Đường TRẢ VỀ chứ không ném vì bảng 422 chung của bộ điều phối chỉ in `error`;
        // giao dịch của route không ghi gì trước lần từ chối (hàng `UNSEAL_CANCEL_DENIED` đã ghi ở giao dịch độc lập), nên COMMIT ở đây
        // không mang theo câu ghi nào. Lỗi không mang `ma` (không tìm thấy, người không được huỷ, mất sổ) đi đường cũ.
        if (loi instanceof UnsealError && loi.ma !== null) return { status: 422, body: { error: loi.message, ma: loi.ma } };
        throw loi;
      }
    },
  },
  // --------------------------------------------------------------------------------------------
  // [sổ nợ 40 / review M-5] Đặt lại TOTP — hai người. Yêu cầu và phê duyệt cùng một mã quyền; CSDL
  // (040) cấm cùng người, cùng phiên; phê duyệt xoá hồ sơ + thu hồi phiên trong một giao dịch.
  // --------------------------------------------------------------------------------------------
  {
    method: "POST",
    path: "/users/:userId/mfa-reset",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.USER_MFA_RESET,
    resourceType: "USER",
    resourceId: userIdParam,
    handler: async (ctx) => ({
      status: 201,
      body: {
        mfaReset: await requestMfaReset(
          ctx.client,
          ctx.orgId,
          { userId: userIdParam(ctx.req), reason: chuoiBatBuoc(ctx.req.body, "reason"), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/mfa-resets/:requestId/approve",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.USER_MFA_RESET,
    resourceType: "MFA_RESET_REQUEST",
    resourceId: mfaResetIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { mfaReset: await approveMfaReset(ctx.client, ctx.orgId, { requestId: mfaResetIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
  },
  // [review H4-2] Huỷ yêu cầu đang chờ — không có route này, một yêu cầu mở nhầm sống 24 giờ và
  // chặn mọi yêu cầu mới cho người ấy suốt thời gian đó.
  {
    method: "POST",
    path: "/mfa-resets/:requestId/cancel",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.USER_MFA_RESET,
    resourceType: "MFA_RESET_REQUEST",
    resourceId: mfaResetIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: { mfaReset: await cancelMfaReset(ctx.client, ctx.orgId, { requestId: mfaResetIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
  },
];

export const ROUTES_BUYER: readonly (BuyerReadRoute | BuyerWriteRoute)[] = [...doc, ...ghi];
