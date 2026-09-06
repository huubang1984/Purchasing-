// ==============================================================================================
// Route KHÁCH — nhà cung cấp đã qua magic link + OTP. `ctx.client` ĐÃ gắn phiên khách, nên mọi
// câu SQL ở đây tự bị policy `AS RESTRICTIVE` của 027 khoá vào đúng một lời mời. Handler không
// có cách nào nới điều đó: nó không có pool, không có `withTenant`, không có `node:http`.
//
// S1.10.2 chỉ có MỘT route, và nó tồn tại để ĐO khung: hai phiên khách của hai nhà cung cấp trên
// cùng một RFQ gọi cùng đường này phải thấy hai lời mời khác nhau, và không phiên nào thấy phiên
// kia (`api.int.test.ts`, [INV-A5]). Các route nghiệp vụ (redeem, OTP, nộp báo giá) là S1.10.3.
// ==============================================================================================
import type { GuestRoute } from "../route-types.js";

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
];
