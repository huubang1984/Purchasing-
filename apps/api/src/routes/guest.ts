// ==============================================================================================
// Route KHÁCH — nhà cung cấp đã qua magic link + OTP. `ctx.client` ĐÃ gắn phiên khách, nên mọi
// câu SQL ở đây tự bị policy `AS RESTRICTIVE` của 027/028 khoá vào đúng một lời mời. Handler không
// có cách nào nới điều đó: nó không có pool, không có `withTenant`, không có `node:http`.
//
//   GET  /guest/session                       phiên đang cầm là gì (route đo khung của S1.10.2)
//   GET  /guest/rfq                           gói thầu được mời: hạng mục + khoá CÔNG KHAI, KHÔNG ngân sách;
//                                             [khoản 196] kèm `gioMayChu` — đồng hồ CSDL, nguồn phán xử hạn
//   POST /guest/bids   {envelope: base64}     nộp một phong bì; nhận biên nhận đã ký (B1/B2);
//                                             [khoản 196] quá hạn ⇒ 422 kèm `gioPhanXu` + `hanNop`, có hàng sổ
//   GET  /guest/bids                          các phiên bản đã nộp của CHÍNH MÌNH — không phong bì
//   GET  /guest/bids/:bidVersionId/receipt    biên nhận, để kiểm chứng độc lập bằng khoá công khai
// ==============================================================================================
import { NopQuaHanError, getBidReceipt, listBidVersions, submitBid } from "@trustprocure/bidding";
import { docVongBafoKhach } from "@trustprocure/danh-gia";
import { getRfq, listRfqItems } from "@trustprocure/rfq";
import { getRfqPublicKeys } from "@trustprocure/sealed-envelope";
import { HttpError } from "../http.js";
import type { GuestRoute } from "../route-types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function b64(u8: Uint8Array): string {
  return Buffer.from(u8).toString("base64");
}

export const ROUTES_GUEST: readonly GuestRoute[] = [
  {
    method: "GET",
    path: "/guest/session",
    audience: "GUEST",
    mutates: false,
    handler: async (ctx) => {
      // Không lọc theo `g.id = ctx.guestSessionId` một cách CỐ Ý: nếu policy của 027 không còn
      // răng, câu này trả về MỌI phiên của tổ chức và test [INV-A5] đỏ. Một `WHERE` ở đây sẽ che
      // mất đúng lỗi mà route này sinh ra để phơi.
      const { rows } = await ctx.client.query<{
        id: string;
        invitation_id: string;
        rfq_id: string;
        verified_channel: string;
      }>(
        "SELECT g.id, g.invitation_id, i.rfq_id, g.verified_channel " +
          "  FROM public.guest_sessions g " +
          "  JOIN public.rfq_invitations i ON i.id OPERATOR(pg_catalog.=) g.invitation_id " +
          " ORDER BY g.created_at",
      );
      return {
        status: 200,
        body: {
          sessions: rows.map((r) => ({
            guestSessionId: r.id,
            invitationId: r.invitation_id,
            rfqId: r.rfq_id,
            verifiedChannel: r.verified_channel,
          })),
        },
      };
    },
  },
  {
    method: "GET",
    path: "/guest/rfq",
    audience: "GUEST",
    mutates: false,
    handler: async (ctx) => {
      const rfq = await getRfq(ctx.client, ctx.orgId, ctx.rfqId);
      if (rfq === null) throw new HttpError(404, "khong co goi thau");
      const items = await listRfqItems(ctx.client, ctx.orgId, ctx.rfqId);
      const khoa = await getRfqPublicKeys(ctx.client, ctx.orgId, ctx.rfqId);
      const vongBafo = await docVongBafoKhach(ctx.client, ctx.orgId, ctx.rfqId);
      // [khoản 196 / ADR-072 phần 3] Giờ MÁY CHỦ — đồng hồ của CSDL, tức đúng nguồn mà C1 phán xử hạn
      // nộp — ở dạng chính tắc của biên nhận. `clock_timestamp()` chứ không `now()`: trang nộp thầu
      // đo độ lệch bằng điểm giữa khứ hồi, nên nó cần giờ LÚC CÂU CHẠY, không giờ lúc giao dịch mở.
      // Trang đếm ngược theo độ lệch ấy — không theo đồng hồ máy người dùng trần.
      const { rows: gio } = await ctx.client.query<{ gio: string }>(
        "SELECT public.bid_dau_thoi_gian_chinh_tac(pg_catalog.clock_timestamp()) AS gio",
      );
      // Danh sách trường là DANH SÁCH TRẮNG, không phải `...rfq`: `createdBy` là một người mua,
      // `requiresDualApproval` là nội bộ, và ngân sách thì KHÔNG CÓ Ở ĐÂY — `rfq_budgets` đóng với
      // phiên khách (027) và handler này cũng không hỏi. Test đo cả hai vế.
      //
      // [S1.109 / S2.5 / khoản 227⑶] `bafoRound` là `null` ngoài vòng BAFO, và khi có vòng nó
      // mang ĐÚNG hai trường. Vì sao nó phải có mặt: `rfq.deadlineAt` là hạn VÒNG MỘT, và suốt
      // `BAFO_OPEN` nó đã ở QUÁ KHỨ — vế (b) của bảng cạnh cấm deadline lùi và vế (c) chỉ cho đổi
      // ở `DRAFT`/`OPEN`, nên nó không cập nhật được; chính vì thế `059` tách hạn BAFO sang bảng
      // riêng. Không có trường này, màn nộp thầu chỉ đọc được một hạn ĐÃ QUA trong khi nhà cung
      // cấp vẫn nộp được. `topN` và `openedBy` KHÔNG ra khỏi đây — `docVongBafoKhach` trả đúng
      // hai trường, và policy `rfq_bafo_rounds_khach` (`060`) canh HÀNG ở một tầng khác.
      return {
        status: 200,
        body: {
          rfq: { id: rfq.id, title: rfq.title, status: rfq.status, deadlineAt: rfq.deadlineAt },
          gioMayChu: gio[0]?.gio ?? null,
          bafoRound: vongBafo,
          items: items.map((i) => ({
            lineNo: i.lineNo,
            description: i.description,
            quantity: i.quantity,
            unit: i.unit,
          })),
          publicKeys: khoa
            .filter((k) => k.revokedAt === null)
            .map((k) => ({ algorithm: k.algorithm, publicKey: b64(k.publicKey), keyVersion: k.keyVersion })),
        },
      };
    },
  },
  {
    method: "POST",
    path: "/guest/bids",
    audience: "GUEST",
    mutates: true,
    handler: async (ctx) => {
      const v = (ctx.req.body as Record<string, unknown> | null | undefined)?.envelope;
      if (typeof v !== "string" || v === "" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(v)) {
        throw new HttpError(422, 'trường "envelope" phải là base64');
      }
      const envelope = new Uint8Array(Buffer.from(v, "base64"));
      // `submitBid` KHÔNG nhận bidId/invitationId/rfqId — cả ba dẫn xuất từ phiên (ADR-016). Thứ
      // duy nhất client gửi là phong bì, và api không đọc được bên trong nó (A2).
      let bn;
      try {
        bn = await submitBid(ctx.client, ctx.orgId, {
          guestSessionId: ctx.guestSessionId,
          envelope,
          signer: ctx.services.receiptSigner,
        });
      } catch (loi) {
        // [khoản 196 / ADR-072 phần 2] Lần chặn VÌ HẠN đi đường TRẢ VỀ, không ném: giao dịch còn lành
        // và đang mang hàng sổ `BID_DEADLINE_DENIED` (xem `NopQuaHanError`), nên bộ điều phối COMMIT nó.
        // Ném ở đây thì giao dịch rollback và hàng sổ đi theo — đúng thứ khoản 196 đo được là thiếu.
        // Hai dấu thời gian là thứ người bị chặn đối chiếu với đồng hồ của mình; không mang gì khác.
        if (loi instanceof NopQuaHanError) {
          return { status: 422, body: { error: loi.message, gioPhanXu: loi.gioCsdl, hanNop: loi.hanNop } };
        }
        throw loi;
      }
      return {
        status: 201,
        body: {
          receipt: {
            bidVersionId: bn.bidVersionId,
            bidId: bn.bidId,
            rfqId: bn.rfqId,
            version: bn.version,
            submittedAt: bn.submittedAt,
            canonicalText: bn.canonicalText,
            signature: b64(bn.signature),
          },
        },
      };
    },
  },
  {
    method: "GET",
    path: "/guest/bids",
    audience: "GUEST",
    mutates: false,
    handler: async (ctx) => {
      // Policy `vendor_bids_khach` (027) đã lọc theo lời mời của phiên; câu này cố ý không có WHERE
      // vì cùng lý do với `/guest/session`.
      const { rows } = await ctx.client.query<{ id: string }>(
        "SELECT id FROM public.vendor_bids ORDER BY created_at",
      );
      const bids = [];
      for (const r of rows) {
        const versions = await listBidVersions(ctx.client, ctx.orgId, r.id);
        bids.push({
          bidId: r.id,
          versions: versions.map((x) => ({ bidVersionId: x.id, version: x.version, submittedAt: x.submittedAt })),
        });
      }
      return { status: 200, body: { bids } };
    },
  },
  {
    method: "GET",
    path: "/guest/bids/:bidVersionId/receipt",
    audience: "GUEST",
    mutates: false,
    handler: async (ctx) => {
      const id = ctx.req.params.bidVersionId ?? "";
      if (!UUID_RE.test(id)) throw new HttpError(404, "khong co bien nhan");
      const bn = await getBidReceipt(ctx.client, ctx.orgId, id);
      // Biên nhận của người khác và biên nhận không tồn tại là CÙNG một 404: policy `bid_receipts_khach`
      // lọc trước khi hàm nhìn thấy, nên hàm không phân biệt được — và đó là điều mong muốn.
      if (bn === null) throw new HttpError(404, "khong co bien nhan");
      return { status: 200, body: { canonicalText: bn.canonicalText, signature: b64(bn.signature) } };
    },
  },
];
