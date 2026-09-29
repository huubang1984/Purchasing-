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
  taoLuotDanhGia,
  type LuotDanhGia,
  xuatBoBangChung,
} from "@trustprocure/danh-gia";
import { PERMISSIONS, approveMfaReset, cancelMfaReset, requestMfaReset } from "@trustprocure/identity";
import {
  clearOtpLockout,
  createInvitation,
  danhDauDaGuiLink,
  issueMagicLinkToken,
  listInvitations,
  phatLinkMoiKhiMoGoi,
  reissueInvitationLink,
  revokeInvitation,
  revokeMagicLinkToken,
  CHANNELS,
  CUA_SO_LINK_MOI_GIAY,
  type Channel,
  type LinkChoGui,
} from "@trustprocure/invitation";
import {
  addRfqItem,
  approveRfq,
  cancelRfq,
  closeRfq,
  createProcurementPolicy,
  createRfq,
  extendRfqDeadline,
  getActiveProcurementPolicy,
  getRfq,
  kyPhienBanChinhSach,
  lietKePhienBanChinhSach,
  listRfqItems,
  openRfq,
  returnRfqToDraft,
  setRfqBudget,
  submitRfqForApproval,
  type Currency,
  type ThanhPhanTrongSoVao,
} from "@trustprocure/rfq";
import {
  addSupplierContact,
  createSupplier,
  getSupplier,
  listSupplierContacts,
  listSuppliers,
} from "@trustprocure/supplier";
import {
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
import type { BuyerContext, BuyerReadRoute, BuyerWriteRoute, KetQuaGuiSauCommit } from "../route-types.js";

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
const userIdParam = (req: ApiRequest): string => uuidParam(req, "userId");
const mfaResetIdParam = (req: ApiRequest): string => uuidParam(req, "requestId");
const awardIdParam = (req: ApiRequest): string => uuidParam(req, "awardId");
const policyIdParam = (req: ApiRequest): string => uuidParam(req, "policyId");

// ----------------------------------------------------------------------------------------------
// [S1.9101 / S3.2b / ADR-082 ⑼] GỬI LINK MỜI SAU COMMIT — tổ chức đã bật S3
// ----------------------------------------------------------------------------------------------
/**
 * Giao các link vừa đúc cho loạt gửi sau commit của bộ điều phối (`afterCommitGuiNhieu`): mỗi link đúng một lần; gửi được ⇒ lời mời
 * `SENT` (`danhDauDaGuiLink`), hỏng hay quá trần ⇒ token VỪA ĐÚC bị thu hồi (`revokeMagicLinkToken`, `LINK_SEND_FAILED`) và lời mời ở
 * lại `UNSENT` — không thu hồi lời mời: thu hồi sẽ thu hẹp một danh sách đã ký. Chủ dự án chốt ngày 2026-09-29: *chưa gửi* luôn nghĩa
 * là không còn link sống, và phản hồi nói lời mời nào chưa gửi thay vì đổi mã trạng thái.
 *
 * Đích RỖNG — người liên hệ không có số cho kênh SMS hay ZNS — không đi tới bộ gửi: lần gửi ấy hỏng có tên, cùng đường với một lần
 * gửi hỏng. Phần ghi kết quả chạy dưới phiên của người gọi route, không qua cổng quyền lần nữa — cùng hợp đồng phần bù của khoản 124
 * (lượt soi 64a-7): nó chỉ đặt trạng thái của chính các lời mời và thu hồi chính các token mà lời gọi này vừa đúc.
 */
function guiLinkMoiSauCommit(
  ctx: BuyerContext,
  links: readonly LinkChoGui[],
  phanHoi: (ketQua: KetQuaGuiSauCommit, ghiDuoc: boolean) => ApiResponse,
): void {
  const theoLoiMoi = new Map(links.map((l) => [l.invitationId, l]));
  ctx.afterCommitGuiNhieu({
    viec: links.map((l) => ({
      khoa: l.invitationId,
      gui: () =>
        l.destination === ""
          ? Promise.reject(Object.assign(new Error("nguoi lien he khong co dich cho kenh cua loi moi"), { name: "KhongCoDichGuiLink" }))
          : ctx.services.invitationLinkSender.send({
              orgId: ctx.orgId,
              invitationId: l.invitationId,
              channel: l.channel,
              destination: l.destination,
              token: l.token,
            }),
    })),
    // [lượt soi S1.9101] Đặt `SENT` trước — chỉ cho lời mời của gói còn `OPEN`, câu không ném —, rồi thu hồi token của MỌI lời mời
    // của loạt còn `UNSENT`: lần gửi hỏng hay quá trần (`LINK_SEND_FAILED`), và lần gửi được mà gói đã rời `OPEN` (huỷ, đóng) trước
    // câu đặt `SENT` (`RFQ_LEFT_OPEN` — sổ không được nói một lần gửi thành công là hỏng). Ghi
    // xong thì *chưa gửi* nghĩa là không còn link sống. Có lời mời gửi được mà không đặt được `SENT` ⇒ `false`: phản hồi nói trạng
    // thái chưa ghi trọn.
    ghiKetQua: async (client, ketQua) => {
      const khongDatDuoc = await danhDauDaGuiLink(client, ctx.orgId, ketQua.daGui);
      const thuHoi = [
        ...ketQua.chuaGui.map((id) => [id, "LINK_SEND_FAILED"] as const),
        ...khongDatDuoc.map((id) => [id, "RFQ_LEFT_OPEN"] as const),
      ];
      for (const [id, reason] of thuHoi) {
        const l = theoLoiMoi.get(id);
        if (l === undefined) continue;
        await revokeMagicLinkToken(client, ctx.orgId, { tokenId: l.tokenId, invitationId: id, actorSessionId: ctx.actor.sessionId, reason });
      }
      return khongDatDuoc.length === 0;
    },
    phanHoi,
  });
}

/** Thân `linkMoi` của phản hồi: id lời mời đã gửi và chưa gửi; `trangThaiChuaGhi` khi lần ghi kết quả sau khi gửi hỏng. */
function thanLinkMoi(ketQua: KetQuaGuiSauCommit, ghiDuoc: boolean): Record<string, unknown> {
  return { daGui: ketQua.daGui, chuaGui: ketQua.chuaGui, ...(ghiDuoc ? {} : { trangThaiChuaGhi: true }) };
}

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
    path: "/rfqs/:rfqId",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] trạng thái RFQ; không bao giờ giá
    agent: true,
    handler: async (ctx) => {
      const r = await getRfq(ctx.client, ctx.orgId, rfqIdParam(ctx.req));
      if (r === null) throw new HttpError(404, "khong co goi thau");
      return { status: 200, body: { rfq: r } };
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
    handler: async (ctx) => ({
      status: 200,
      body: {
        invitations: await listInvitations(
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
    path: "/rfqs/:rfqId/items",
    audience: "BUYER",
    mutates: false,
    // [khoản 141] hạng mục mua — cái gì, bao nhiêu
    agent: true,
    handler: async (ctx) => ({ status: 200, body: { items: await listRfqItems(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) } }),
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
    // [khoản 141] số hồ sơ thầu đã nhận — cùng rổ HAM_DOC_CO_QUYEN với bảng giá
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
// trên sáu vai, trong đó REQUESTER, BUYER, TECHNICAL KHÔNG giữ `bid.view` (`005`) — đọc được giá
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

// ----------------------------------------------------------------------------------------------
// GHI — mỗi route một mã quyền. `resourceId` đọc từ ĐƯỜNG DẪN, không từ thân.
// ----------------------------------------------------------------------------------------------
const ghi: readonly BuyerWriteRoute[] = [
  // --------------------------------------------------------------------------------------------
  // [S1.106 / S2.4] CHẤM — cạnh `UNSEALED->EVALUATING` của `011`, và nó là route ghi DUY NHẤT mang
  // `evaluation.perform`.
  //
  // Khoản **220** nói ra giới hạn của chính cổng này: `evaluation.perform` do NĂM trên SÁU vai giữ
  // (chỉ `DIRECTOR` không), nên cổng ở đây là một lớp NÔNG — nó chặn được khách và tác tử, không
  // chặn được "ai trong tổ chức". Ghi ra ở đúng chỗ người đọc mã route sẽ tìm.
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
  // giá của mọi người, và `evaluation.perform` do NĂM trên SÁU vai giữ (khoản 220).
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
  // tự suy lượt chấm MỚI NHẤT. Ở đây nó là lớp DUY NHẤT — `award_kiem_de_xuat` chỉ đòi lượt chấm
  // thuộc đúng RFQ, không đòi nó mới nhất — nên một ca đo khoá riêng vế ấy.
  //
  // HUỶ đi qua `po.approve`, KHÔNG `award.recommend`: `award.recommend` do BỐN vai giữ (kèm
  // `BUYER`), nên một cổng huỷ theo mã ấy cho `BUYER` huỷ được một award ĐÃ DUYỆT rồi đề xuất
  // người khác — phê duyệt kép bị tháo bằng cách bào mòn. Cái giá: người đề xuất không tự rút lại
  // được (khoản **232**).
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
  {
    method: "POST",
    path: "/rfqs/:rfqId/award/cancel",
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
    method: "POST",
    path: "/rfqs/:rfqId/submit",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_CREATE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => ({
      status: 200,
      body: {
        rfq: await submitRfqForApproval(
          ctx.client,
          ctx.orgId,
          { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId },
          ctx.auditPool,
        ),
      },
    }),
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/approve",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_APPROVE,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      await approveRfq(ctx.client, ctx.orgId, { rfqId: rfqIdParam(ctx.req), sessionId: ctx.actor.sessionId }, ctx.auditPool);
      return { status: 200, body: { rfq: await getRfq(ctx.client, ctx.orgId, rfqIdParam(ctx.req)) } };
    },
  },
  {
    method: "POST",
    path: "/rfqs/:rfqId/return-to-draft",
    audience: "BUYER",
    mutates: true,
    // [S1.9101 / S3.2b / ADR-084 ⑵] Người TẠO gói (giữ `rfq.create`) hoặc người giữ `rfq.approve`. Cổng của bộ điều phối là
    // `rfq.create` vì mọi vai giữ `rfq.approve` hôm nay cũng giữ `rfq.create` — phép đo ở `packages/identity/src/ma-tran-quyen.test.ts`
    // đỏ ngày ma trận đổi điều ấy; `returnRfqToDraft` hỏi đúng mã theo người: `rfq.create` cho người tạo, `rfq.approve` cho người khác.
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
  {
    method: "POST",
    path: "/rfqs/:rfqId/open",
    audience: "BUYER",
    mutates: true,
    permission: PERMISSIONS.RFQ_OPEN,
    resourceType: "RFQ",
    resourceId: rfqIdParam,
    handler: async (ctx) => {
      const rfq = await openRfq(
        ctx.client,
        ctx.orgId,
        { rfqId: rfqIdParam(ctx.req), actorSessionId: ctx.actor.sessionId, orgKeys: ctx.services.orgKeyProvisioner },
        ctx.auditPool,
      );
      // [S1.9101 / S3.2b / ADR-082 ⑼] Tổ chức đã bật: phiên người mở đúc token cho MỌI lời mời còn sống trong CHÍNH giao dịch này —
      // sau `openRfq`, vì K6 đòi gói đã mở —, rồi link đi sau commit. Tổ chức chưa bật: `null`, link đã đi lúc mời, và thân phản hồi
      // là thân của MVP1 (spec §8.11).
      const links = await phatLinkMoiKhiMoGoi(ctx.client, ctx.orgId, { rfqId: rfq.id, actorSessionId: ctx.actor.sessionId });
      if (links === null) return { status: 200, body: { rfq } };
      if (links.length > 0) {
        guiLinkMoiSauCommit(ctx, links, (ketQua, ghiDuoc) => ({ status: 200, body: { rfq, linkMoi: thanLinkMoi(ketQua, ghiDuoc) } }));
      }
      return { status: 200, body: { rfq, linkMoi: { daGui: [], chuaGui: [] } } };
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
      const loi = await createInvitation(
        ctx.client,
        ctx.orgId,
        {
          rfqId: rfqIdParam(ctx.req),
          supplierId,
          contactId,
          linkChannel: kenhTuyChon(ctx.req.body),
          actorSessionId: ctx.actor.sessionId,
        },
        ctx.auditPool,
      );
      // [S1.9101 / S3.2b / ADR-082 ⑼] Trạng thái lúc chèn nói lời mời thuộc luồng nào — trigger `076` quyết, route không tự hỏi
      // công tắc: `UNSENT` là tổ chức đã bật. Ở DRAFT (không nhãn *mời sau khi ký*) chưa có link nào — token đúc lúc mở gói (K6).
      // Ở OPEN, link đi ngay sau commit; gửi hỏng thì lời mời ở lại `UNSENT` và phản hồi vẫn là `201` kèm danh sách chưa gửi.
      if (loi.status === "UNSENT") {
        // [lượt soi S1.9101] Kênh không có đích (SMS hay ZNS cho người liên hệ không có số) ⇒ 422, giao dịch rollback. Không chặn ở
        // đây thì lời mời vào danh sách được ký, mọi lần gửi đều hỏng, và K4a cấm thu hồi nó ở OPEN — kẹt vĩnh viễn. MVP1 giữ
        // [S1.70]: gửi hỏng ⇒ 502 và lời mời bị thu hồi.
        const dich = loi.linkChannel === "EMAIL" ? lienHe.email : (lienHe.phone ?? "");
        if (dich === "") throw new HttpError(422, "nguoi lien he khong co so dien thoai cho kenh cua loi moi");
        if (!loi.moiSauKhiKy) return { status: 201, body: { invitation: loi } };
        const tMoi = await issueMagicLinkToken(ctx.client, ctx.orgId, { invitationId: loi.id, actorSessionId: ctx.actor.sessionId });
        const link: LinkChoGui = {
          invitationId: loi.id,
          tokenId: tMoi.tokenId,
          token: tMoi.token,
          channel: loi.linkChannel,
          destination: dich,
        };
        guiLinkMoiSauCommit(ctx, [link], (ketQua, ghiDuoc) => ({
          status: 201,
          body: {
            invitation: { ...loi, status: ketQua.daGui.length > 0 && ghiDuoc ? "SENT" : "UNSENT" },
            linkMoi: thanLinkMoi(ketQua, ghiDuoc),
          },
        }));
        return { status: 201, body: { invitation: loi } };
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
          await revokeInvitation(
            client,
            ctx.orgId,
            { invitationId: loi.id, actorSessionId: ctx.actor.sessionId, reason: "LINK_SEND_FAILED" },
            ctx.auditPool,
          );
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
        if (kq.reason === "RFQ_NOT_ACCEPTING") throw new HttpError(409, "goi thau khong nhan bao gia");
        return { status: 429, body: { error: "da gui qua nhieu link cho loi moi nay" }, headers: { "retry-after": String(CUA_SO_LINK_MOI_GIAY) } };
      }
      const loi = kq.invitation;
      const lienHe = (await listSupplierContacts(ctx.client, ctx.orgId, loi.supplierId)).find((c) => c.id === loi.contactId);
      if (lienHe === undefined) throw new HttpError(409, "nguoi lien he cua loi moi khong con");
      const t = kq.token;
      // [S1.9101 / S3.2b / ADR-084 ⑵] Lời mời CHƯA GỬI của tổ chức đã bật: gửi được thì nó thành `SENT`. Hợp đồng lỗi giữ nguyên
      // ADR-110 — gửi hỏng ⇒ token vừa phát bị thu hồi, `502`; thu hồi cũng hỏng ⇒ `500`. Lời mời đã `SENT` đi đường cũ bên dưới.
      if (loi.status === "UNSENT") {
        const link: LinkChoGui = {
          invitationId: loi.id,
          tokenId: t.tokenId,
          token: t.token,
          channel: loi.linkChannel,
          destination: loi.linkChannel === "EMAIL" ? lienHe.email : (lienHe.phone ?? ""),
        };
        guiLinkMoiSauCommit(ctx, [link], (ketQua, ghiDuoc) => {
          if (ketQua.daGui.length > 0) return { status: 200, body: { reissued: true, ...(ghiDuoc ? {} : { trangThaiChuaGhi: true }) } };
          if (ghiDuoc) {
            return { status: 502, body: { error: "khong gui duoc link moi; link moi da thu hoi, link cu chua dung da het hieu luc" } };
          }
          return { status: 500, body: { error: "khong gui duoc link moi va chua thu hoi duoc link moi" } };
        });
        return { status: 200, body: { reissued: true } };
      }
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
    handler: async (ctx) => ({
      status: 200,
      body: { unsealRequest: await cancelUnseal(ctx.client, ctx.orgId, { unsealRequestId: unsealIdParam(ctx.req), actorSessionId: ctx.actor.sessionId }, ctx.auditPool) },
    }),
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
