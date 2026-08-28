import type pg from "pg";
import { assertTenantBound } from "./tenant-guard.js";

export type ActorType = "USER" | "SUPPLIER" | "SYSTEM" | "SERVICE";

export interface AuditEventInput {
  readonly actorType: ActorType;
  readonly actorId?: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly payload?: Record<string, unknown>;
  readonly requestId?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface AuditEventRecord {
  readonly id: string;
  readonly seq: number;
  readonly prevHash: Buffer;
  readonly hash: Buffer;
  /**
   * Dấu thời gian do DB đặt. CẢNH BÁO CÓ CHỦ Ý: `Date` của JS chỉ tới mili-giây, còn
   * `timestamptz` giữ micro-giây — nên giá trị này bị CẮT BỚT so với thứ đã đi vào phép băm.
   * Nó dùng để hiển thị và sắp xếp, KHÔNG BAO GIỜ dùng để tính lại băm ở tầng ứng dụng.
   */
  readonly occurredAt: Date;
}

/** Mốc neo ghi TRONG database. Xem `ExternalAnchor` cho mốc neo ngoài database. */
export interface ChainAnchor {
  readonly seq: number;
  readonly hash: Buffer;
}

/**
 * Mốc chuỗi xuất ra để giữ NGOÀI database.
 *
 * Bàn giao đo được của Task 5: `audit_events`, `audit_chain_anchors` và `schema_migrations` đều
 * nằm cùng vùng tin cậy với tác nhân — chủ sở hữu bảng không-superuser dựng lại được cả sổ lẫn
 * neo mà migrate() vẫn báo OK. Nên trong phạm vi S0, gốc tin cậy DUY NHẤT cho phát biểu "đây vẫn
 * là cái sổ cũ" là một artefact nằm ngoài database: CI hoặc quy trình vận hành xuất giá trị này
 * theo lịch và cất nó ở nơi mà role deploy của database KHÔNG ghi được (kho artefact của CI, ký
 * số, hoặc sổ của bên thứ ba).
 *
 * Kiểu này cố ý chỉ dùng JSON nguyên thuỷ (chuỗi hex, không phải Buffer) để đi qua
 * JSON.stringify/parse mà không mất mát.
 *
 * Phạm vi bảo đảm, nói đúng mức: giá trị này chứng minh "tại thời điểm xuất, chuỗi của tổ chức
 * này dài `seq` và đầu chuỗi là `hashHex`". Nó KHÔNG chứng minh những sự kiện đã bị nuốt trước
 * lúc ghi từng tồn tại.
 *
 * [vòng fix 1 — IM6] TRẠNG THÁI THẬT, viết ra thay vì để "đã làm" che đi: CƠ CHẾ đã có (kiểu
 * này + `exportChainHead` + nhánh `externalAnchors` của bộ kiểm chứng). ARTEFACT thì CHƯA CÓ —
 * không exporter, không lịch, không nơi cất, không chữ ký, không entry point; `grep` ngoài
 * packages/audit không ra gì và ci.yml không bao giờ kiểm chứng một chuỗi nào. Đó là NỢ VẬN
 * HÀNH, không phải một bảo đảm đã mua được.
 *
 * [vòng fix 1 — M5] HAI YÊU CẦU BẮT BUỘC cho nơi cất, cả hai đều đo được là load-bearing:
 *   (1) NƠI CẤT PHẢI CHỈ-GHI-THÊM, không được GHI ĐÈ. Đo dưới một policy cắt đuôi:
 *       `exportChainHead` trả HEAD {"seq":3} trên một sổ 6 hàng. Nếu nơi cất ghi đè, một lần
 *       cắt đuôi được RỬA THÀNH GỐC TIN CẬY mới. Và việc kiểm chứng phải xét MỌI neo còn giữ,
 *       không chỉ neo mới nhất — `verifyAuditChain` nhận cả MẢNG chính vì lý do này.
 *   (2) ARTEFACT HIỆN KHÔNG ĐƯỢC KÝ, nên "nằm ngoài vùng ghi của role deploy" là bảo đảm DUY
 *       NHẤT. Mất tính chất đó thì neo MẤT SẠCH giá trị, không suy giảm dần.
 *
 * [vòng fix 2 — I2] KIỂU NÀY TÁCH LÀM HAI, và đó là toàn bộ nội dung bản vá. Trước vòng này,
 * `exportChainHead` trả thẳng một `ExternalAnchor`, nên đường DỄ VIẾT NHẤT là:
 *
 *     const neo = await exportChainHead(client, org);      // đọc CHÍNH cái sổ đang kiểm
 *     verifyAuditChain(client, org, { externalAnchors: [neo] })
 *     -> {"ok":true,"checked":1,"problems":[]}
 *
 * Kết quả đó KHÔNG PHÂN BIỆT ĐƯỢC với một kết luận kiểm toán thật, trong khi nó chẳng chứng
 * minh gì: cả hai vế đọc cùng một bảng, trong cùng một phiên, cùng một vùng tin cậy. `[CR2]`
 * của vòng fix 1 mua "không xanh khi KHÔNG neo" bằng cách đánh đổi "xanh khi có BẤT KỲ neo
 * nào" — và vì `ok:true` nay LUÔN kèm một mảng neo, kết luận TRÔNG NHƯ đã được neo. Chất lượng
 * tín hiệu bị HẠ, không nâng, ở đúng ca dễ viết nhất.
 *
 * Nên `exportChainHead` nay trả `ChainHeadExport` — thứ ĐI RA kho — và `ExternalAnchor` đòi
 * thêm `source`, thứ chỉ điền được khi giá trị ĐÃ ĐI QUA kho và QUAY VỀ. Người gọi vẫn tự tay
 * đúc được một neo giả (`{ ...xuat, source: "bịa" }`) — không lớp kiểu nào chặn được điều đó,
 * và nói ngược lại là nói quá. Cái mua được là: việc đó không còn VIẾT ĐƯỢC MỘT CÁCH TÌNH CỜ,
 * nó phải viết ra thành chữ, tại chỗ, nơi review nhìn thấy.
 *
 * `source` KHÔNG được `verifyAuditChain` xác thực và KHÔNG THỂ được xác thực trong phạm vi S0
 * (artefact chưa được ký — xem (2) ở trên). Nó là một NHÃN XUẤT XỨ: nó đi vào chẩn đoán của
 * `ANCHOR_MISSING` để một kết luận kiểm toán tự nói ra gốc tin cậy mà nó dựa vào.
 */
export interface ChainHeadExport {
  readonly orgId: string;
  readonly seq: number;
  readonly hashHex: string;
  readonly exportedAt: string;
}

/**
 * Một `ChainHeadExport` đã LẤY VỀ TỪ NƠI CẤT NGOÀI DATABASE. Xem khối chú thích trên.
 *
 * `source` mô tả nơi cất đã trả giá trị này về (kho artefact của CI, sổ của bên thứ ba, ...).
 * Nó là chữ của người gọi, không phải một chứng cứ mật mã.
 */
export interface ExternalAnchor extends ChainHeadExport {
  readonly source: string;
}

interface HangGhi {
  id: string;
  seq: string;
  prev_hash: Buffer;
  hash: Buffer;
  occurred_at: Date;
}

/**
 * Ghi một sự kiện kiểm toán và nối vào chuỗi hash của tổ chức.
 *
 * Phải gọi bên trong một transaction đã gắn tenant (`withTenant`): hàm SQL `audit_append` đi qua
 * một trigger dùng khoá tư vấn PHẠM VI TRANSACTION để giữ chuỗi không phân nhánh, và RLS lấy tổ
 * chức từ GUC do `withTenant` đặt.
 *
 * `seq`, `prev_hash`, `hash` và `occurred_at` do DATABASE quyết định — bên gọi không chọn được,
 * kể cả khi bên gọi bị chiếm. Xem 004_audit_chain_functions.sql §(2)(3).
 *
 * KHÔNG BAO GIỜ đưa giá, mật khẩu, token, OTP, khoá hay bí mật TOTP vào `payload`, `action` hay
 * `userAgent`. `payload` có một CHECK ở tầng DB chặn khoá mang giá ở MỌI ĐỘ SÂU; `action` và
 * `userAgent` thì KHÔNG có chốt chặn nào — chúng là đường vòng, và lớp phòng thủ duy nhất là
 * code review.
 */
export async function appendAuditEvent(
  client: pg.PoolClient,
  orgId: string,
  input: AuditEventInput,
): Promise<AuditEventRecord> {
  const { rows } = await client.query<HangGhi>(
    "SELECT id, seq, prev_hash, hash, occurred_at " +
      "FROM public.audit_append($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [
      orgId,
      input.actorType,
      input.actorId ?? null,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      JSON.stringify(input.payload ?? {}),
      input.requestId ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
    ],
  );

  const hang = rows[0];
  if (hang === undefined) throw new Error("audit_append không trả về bản ghi nào");

  return {
    id: hang.id,
    seq: Number(hang.seq),
    prevHash: hang.prev_hash,
    hash: hang.hash,
    occurredAt: hang.occurred_at,
  };
}

/**
 * Ghi mốc neo TRONG DB cho đầu chuỗi hiện tại. Trả `null` nếu tổ chức chưa có sự kiện nào, hoặc
 * nếu đầu chuỗi đã được neo rồi (ON CONFLICT DO NOTHING).
 *
 * Mốc neo trong DB chỉ bắt được kẻ cắt đuôi mà QUÊN dọn bảng neo — nó nằm cùng vùng tin cậy với
 * sổ. Đường bảo đảm thật là `exportChainHead`.
 *
 * [vòng fix 1 — IM4] Câu INSERT CỐ Ý chỉ nêu `org_id`. 004 §(5) thu hồi INSERT trên `seq` và
 * `hash` của bảng neo và cắm một trigger BEFORE INSERT dẫn xuất hai cột đó từ đầu chuỗi, đúng
 * khuôn §(2)+(3) của `audit_events` — nên một câu nêu tên `seq`/`hash` ở đây sẽ nhận 42501.
 * Vẫn giữ dạng INSERT ... SELECT (thay vì VALUES) để trên sổ RỖNG nó chèn 0 hàng và trả `null`,
 * chứ không đẩy trigger vào nhánh RAISE.
 */
export async function recordChainAnchor(
  client: pg.PoolClient,
  orgId: string,
): Promise<ChainAnchor | null> {
  await assertTenantBound(client, orgId, "recordChainAnchor");

  const { rows } = await client.query<{ seq: string; hash: Buffer }>(
    `INSERT INTO public.audit_chain_anchors (org_id)
     SELECT ae.org_id
       FROM public.audit_events ae
      WHERE ae.org_id = $1
      ORDER BY ae.seq DESC
      LIMIT 1
     ON CONFLICT (org_id, seq) DO NOTHING
     RETURNING seq, hash`,
    [orgId],
  );

  const hang = rows[0];
  return hang === undefined ? null : { seq: Number(hang.seq), hash: hang.hash };
}

/**
 * Xuất mốc chuỗi hiện tại thành một artefact JSON để giữ NGOÀI database.
 *
 * Không ghi gì vào database — chủ ý: một artefact mà database ghi được thì không phải gốc tin
 * cậy. Trả `null` khi tổ chức chưa có sự kiện nào.
 *
 * [vòng fix 1 — IM3/M5] Hàm này đọc DƯỚI RLS, nên nó PHẢI tự kiểm tenant: một job xuất neo chạy
 * sai tenant lặng lẽ không xuất gì (và cửa sổ F-3 mở vô hạn mà không ai biết), còn dưới một
 * policy cắt đuôi nó xuất một đầu chuỗi NGẮN HƠN sự thật và rửa lần cắt đuôi đó thành gốc tin
 * cậy. Xem `assertTenantBound`.
 *
 * [vòng fix 2 — I2] Trả `ChainHeadExport`, KHÔNG phải `ExternalAnchor`, và đó là chủ ý: giá trị
 * vừa đọc ra từ CHÍNH cái sổ đang kiểm không chứng minh được gì về cái sổ đó. Muốn nó thành một
 * `ExternalAnchor` thì phải đi qua nơi cất và quay về, và người lấy nó về phải khai `source`.
 */
export async function exportChainHead(
  client: pg.PoolClient,
  orgId: string,
): Promise<ChainHeadExport | null> {
  await assertTenantBound(client, orgId, "exportChainHead");

  const { rows } = await client.query<{ seq: string; hash_hex: string }>(
    `SELECT ae.seq, pg_catalog.encode(ae.hash, 'hex') AS hash_hex
       FROM public.audit_events ae
      WHERE ae.org_id = $1
      ORDER BY ae.seq DESC
      LIMIT 1`,
    [orgId],
  );

  const hang = rows[0];
  if (hang === undefined) return null;

  return {
    orgId,
    seq: Number(hang.seq),
    hashHex: hang.hash_hex,
    exportedAt: new Date().toISOString(),
  };
}
