import type pg from "pg";

interface HangGan {
  khop: boolean | null;
  dang_gan: string | null;
}

/**
 * [vòng fix 1 — IM3/M5] Khẳng định rằng PHIÊN hiện tại đang gắn đúng tổ chức mà người gọi định
 * kiểm/xuất. Ném nếu không.
 *
 * Vì sao đây là một khác biệt SINH TỬ chứ không phải một tiện nghi. Hai công cụ kiểm toán của
 * gói này đọc `audit_events` DƯỚI RLS, mà RLS lọc theo GUC `app.org_id` chứ không theo tham số
 * `orgId`. Nên trước bản vá này, cả hai TRẢ LỜI "KHÔNG CÓ VẤN ĐỀ" ở chỗ phải trả lời "KHÔNG
 * KIỂM ĐƯỢC". Đã đo, cả hai reviewer độc lập:
 *     số hàng THẬT của tổ chức P = 5
 *     verifyAuditChain(client gắn tenant Q, orgP) -> {"ok":true,"checked":0,"problems":[]}
 *     verifyAuditChain(client gắn tenant P, orgP) -> {"ok":false,"checked":5,...}
 *     GUC = 00000000-0000-0000-0000-000000000000, orgB -> {"ok":true,"checked":0}
 *     policy cắt đuôi (USING ... AND seq <= 3) trên sổ 6 hàng -> {"ok":true,"checked":3}
 * `exportChainHead` cùng lỗ, và ở đó hậu quả nặng hơn theo HAI chiều:
 *   (a) job xuất neo chạy sai tenant lặng lẽ KHÔNG XUẤT GÌ — và F-3 (cửa sổ giữa hai lần xuất
 *       neo) khi đó MỞ VÔ HẠN mà không ai biết;
 *   (b) [M5] dưới một policy CẮT ĐUÔI, nó xuất HEAD {"seq":3} trên một sổ 6 hàng — tức RỬA MỘT
 *       LẦN CẮT ĐUÔI THÀNH GỐC TIN CẬY nếu nơi cất neo GHI ĐÈ thay vì NỐI THÊM.
 *
 * Một round trip, câu lệnh ĐẦU TIÊN của cả hai hàm. Cố ý đặt trong SQL chứ không so sánh ở
 * tầng ứng dụng: `app_current_org_id()` là CHÍNH cái hàm mà mọi policy RLS gọi, nên phép so
 * này đo đúng thứ RLS sẽ dùng — không phải một biến song song có thể trôi khỏi nó.
 *
 * `IS NOT DISTINCT FROM` chứ không `=`: khi GUC chưa được đặt, `app_current_org_id()` trả NULL
 * và `NULL = $1` cho ra NULL, tức một `if (!khop)` ngây thơ vẫn ném — nhưng thông báo sẽ mất
 * thông tin "phiên chưa gắn tổ chức nào". Vế `dang_gan` giữ lại thông tin đó.
 */
export async function assertTenantBound(
  client: pg.PoolClient,
  orgId: string,
  tenHam: string,
): Promise<void> {
  const { rows } = await client.query<HangGan>(
    `SELECT public.app_current_org_id() IS NOT DISTINCT FROM $1::uuid AS khop,
            public.app_current_org_id()::text AS dang_gan`,
    [orgId],
  );

  const hang = rows[0];
  if (hang?.khop === true) return;

  throw new Error(
    `${tenHam}: phiên đang gắn tổ chức ${hang?.dang_gan ?? "(chưa gắn — app.org_id trống)"} ` +
      `nhưng được yêu cầu làm việc với ${orgId}. Mọi truy vấn sau đây sẽ chạy dưới RLS của tổ ` +
      "chức ĐANG GẮN, nên kết quả sẽ là 'không thấy gì' chứ không phải 'không có vấn đề'. " +
      "Gọi lại bên trong withTenant() của đúng tổ chức.",
  );
}
