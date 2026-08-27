import type pg from "pg";
import type { ExternalAnchor } from "./writer.js";

export type ChainProblemKind = "HASH_MISMATCH" | "LINK_BROKEN" | "SEQ_GAP" | "ANCHOR_MISSING";

export interface ChainProblem {
  readonly seq: number;
  readonly kind: ChainProblemKind;
  readonly detail: string;
}

export interface VerificationResult {
  readonly ok: boolean;
  readonly checked: number;
  readonly problems: readonly ChainProblem[];
}

export interface VerifyOptions {
  /**
   * Mốc chuỗi đã xuất ra ngoài database (xem `exportChainHead`). Chỉ những mốc thuộc đúng tổ
   * chức đang kiểm mới được xét; mốc của tổ chức khác bị bỏ qua trong im lặng vì RLS làm cho
   * chúng không kiểm được từ phiên này.
   */
  readonly externalAnchors?: readonly ExternalAnchor[];
}

/** prev_hash của sự kiện đầu chuỗi. 32 byte 0 — khớp CHECK octet_length(prev_hash) = 32. */
const BAM_KHOI_NGUYEN = Buffer.alloc(32, 0);

interface HangChuoi {
  seq: string;
  prev_hash: Buffer;
  hash: Buffer;
  bam_lai: Buffer;
}

/**
 * Kiểm chứng chuỗi kiểm toán của một tổ chức.
 *
 * PHÁT BIỂU ĐÚNG MỨC — đọc trước khi trích dẫn kết quả của hàm này:
 *
 *   `ok === true` chứng minh: không ai SỬA (HASH_MISMATCH), CHÈN hay ĐỨT LIÊN KẾT
 *   (LINK_BROKEN), XOÁ HÀNG Ở GIỮA (SEQ_GAP) hay CẮT ĐUÔI (ANCHOR_MISSING, so với những mốc neo
 *   mà hàm này nhìn thấy được) các hàng ĐANG CÓ trong bảng.
 *
 *   `ok === true` KHÔNG chứng minh "sổ không bị giả mạo". Hai lỗ đã được ĐO ở bàn giao Task 5,
 *   cả hai nằm trong tay chủ sở hữu bảng không-superuser, cả hai cho MIGRATE OK:
 *     (a) một trigger BEFORE INSERT ... RETURN NULL có điều kiện nuốt sự kiện CÓ CHỌN LỌC trong
 *         khi seq và prev_hash vẫn liền mạch — hàm này sẽ báo HỢP LỆ trên một sổ đã bị kiểm
 *         duyệt. Lớp phòng thủ tương ứng là danh sách trắng trigger trong hardening.always.sql;
 *     (b) sổ bị dựng lại (RENAME + CREATE TABLE LIKE + DROP, hoặc SET SCHEMA, hoặc DROP hai bảng
 *         + xoá dòng 003 khỏi schema_migrations). Với một sổ RỖNG, hàm này trả ok = true,
 *         checked = 0 — và đó là câu trả lời ĐÚNG cho câu hỏi mà nó đặt ra.
 *
 * Cách duy nhất trong phạm vi S0 để đóng (b) là truyền `externalAnchors`: mốc chuỗi giữ NGOÀI
 * database. Không có nó, `audit_chain_anchors` không phải gốc tin cậy — nó nằm cùng vùng tin cậy
 * với `audit_events`.
 *
 * Băm được tính lại bằng CHÍNH hàm SQL đã dùng lúc ghi (`audit_compute_hash`), nên không có nguy
 * cơ lệch do tuần tự hoá giữa hai tầng.
 */
export async function verifyAuditChain(
  client: pg.PoolClient,
  orgId: string,
  options: VerifyOptions = {},
): Promise<VerificationResult> {
  const { rows } = await client.query<HangChuoi>(
    `SELECT ae.seq, ae.prev_hash, ae.hash,
            public.audit_compute_hash(ae.prev_hash, ae.org_id, ae.seq, ae.occurred_at,
                                      ae.actor_type, ae.actor_id, ae.action, ae.resource_type,
                                      ae.resource_id, ae.payload, ae.request_id) AS bam_lai
       FROM public.audit_events ae
      WHERE ae.org_id = $1
      ORDER BY ae.seq`,
    [orgId],
  );

  const problems: ChainProblem[] = [];
  const bamTheoSeq = new Map<number, string>();
  let seqMongDoi = 1;
  // Kiểu tường minh: `Buffer.alloc` cho ra Buffer<ArrayBuffer> còn pg trả Buffer<ArrayBufferLike>,
  // nên suy kiểu từ giá trị khởi tạo sẽ chặn phép gán ở cuối vòng lặp.
  let bamTruocMongDoi: Buffer = BAM_KHOI_NGUYEN;

  for (const hang of rows) {
    const seq = Number(hang.seq);
    bamTheoSeq.set(seq, hang.hash.toString("hex"));

    if (seq !== seqMongDoi) {
      problems.push({
        seq,
        kind: "SEQ_GAP",
        detail: `Kỳ vọng seq ${seqMongDoi} nhưng gặp ${seq} — có hàng bị xoá hoặc bị chèn.`,
      });
    }

    if (!hang.prev_hash.equals(bamTruocMongDoi)) {
      problems.push({
        seq,
        kind: "LINK_BROKEN",
        detail: "prev_hash không khớp hash của sự kiện liền trước trong bảng.",
      });
    }

    if (!hang.hash.equals(hang.bam_lai)) {
      problems.push({
        seq,
        kind: "HASH_MISMATCH",
        detail: "Nội dung sự kiện đã bị thay đổi sau khi ghi.",
      });
    }

    bamTruocMongDoi = hang.hash;
    seqMongDoi = seq + 1;
  }

  // Mốc neo TRONG DB trỏ tới một sự kiện không còn tồn tại (hoặc đã đổi băm) nghĩa là chuỗi đã
  // bị cắt đuôi. Phép so đặt trong SQL để nó chạy dưới đúng RLS của phiên đang kiểm.
  const { rows: hangNeo } = await client.query<{ seq: string }>(
    `SELECT a.seq
       FROM public.audit_chain_anchors a
      WHERE a.org_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM public.audit_events ae
           WHERE ae.org_id = a.org_id AND ae.seq = a.seq AND ae.hash = a.hash
        )
      ORDER BY a.seq`,
    [orgId],
  );

  for (const neo of hangNeo) {
    problems.push({
      seq: Number(neo.seq),
      kind: "ANCHOR_MISSING",
      detail:
        `Mốc neo trong DB tại seq ${neo.seq} không còn sự kiện tương ứng — chuỗi đã bị cắt ` +
        "đuôi hoặc hàng đó đã bị sửa.",
    });
  }

  for (const neo of options.externalAnchors ?? []) {
    if (neo.orgId !== orgId) continue;
    const bamThucTe = bamTheoSeq.get(neo.seq);
    if (bamThucTe === neo.hashHex) continue;
    problems.push({
      seq: neo.seq,
      kind: "ANCHOR_MISSING",
      detail:
        `Mốc neo NGOÀI DB (xuất lúc ${neo.exportedAt}) tại seq ${neo.seq} kỳ vọng băm ` +
        `${neo.hashHex} nhưng bảng ${bamThucTe === undefined ? "không còn hàng nào ở seq đó" : `có ${bamThucTe}`}` +
        " — sổ đã bị cắt đuôi, bị thay thế, hoặc bị dựng lại.",
    });
  }

  return { ok: problems.length === 0, checked: rows.length, problems };
}
