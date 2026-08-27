import type pg from "pg";

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
 */
export interface ExternalAnchor {
  readonly orgId: string;
  readonly seq: number;
  readonly hashHex: string;
  readonly exportedAt: string;
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
 */
export async function recordChainAnchor(
  client: pg.PoolClient,
  orgId: string,
): Promise<ChainAnchor | null> {
  const { rows } = await client.query<{ seq: string; hash: Buffer }>(
    `INSERT INTO public.audit_chain_anchors (org_id, seq, hash)
     SELECT ae.org_id, ae.seq, ae.hash
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
 */
export async function exportChainHead(
  client: pg.PoolClient,
  orgId: string,
): Promise<ExternalAnchor | null> {
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
