import type pg from "pg";
import type { ExternalAnchor } from "./writer.js";
import { assertTenantBound } from "./tenant-guard.js";

export type ChainProblemKind =
  | "HASH_MISMATCH"
  | "LINK_BROKEN"
  | "SEQ_GAP"
  | "ANCHOR_MISSING"
  | "NOT_ANCHORED"
  | "EMPTY_LEDGER";

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
   *
   * [vòng fix 1 — CR2] BẮT BUỘC, và mảng RỖNG là một câu trả lời hợp lệ nhưng KHÔNG MIỄN PHÍ:
   * nó sinh một `NOT_ANCHORED` và `ok = false`. Lý do đo được nằm ở docstring của
   * `verifyAuditChain`; tóm tắt: không có neo ngoài thì `ok = true` không phân biệt được với
   * một sổ đã bị sửa VÀ tính lại đuôi, nên một lời gọi không neo KHÔNG ĐƯỢC âm thầm cho ra một
   * kết luận kiểm toán màu xanh.
   *
   * [vòng fix 2 — I2] MỘT NEO LẤY TỪ `exportChainHead` TRONG CÙNG PHIÊN KHÔNG CHỨNG MINH GÌ —
   * nó chỉ làm `NOT_ANCHORED` im đi. Cả hai vế khi ấy đọc cùng một bảng, dưới cùng một RLS,
   * trong cùng một vùng tin cậy với tác nhân; `ok:true` thu được KHÔNG PHÂN BIỆT ĐƯỢC với một
   * kết luận kiểm toán thật. Vì thế `exportChainHead` trả `ChainHeadExport` chứ không trả kiểu
   * này, và kiểu này đòi thêm `source` — giá trị chỉ điền được khi neo ĐÃ ĐI QUA nơi cất ngoài
   * database và QUAY VỀ. `source` KHÔNG được xác thực ở đây (không thể — artefact chưa được
   * ký); nó chỉ bắt xuất xứ phải viết ra thành chữ và đưa xuất xứ đó vào chẩn đoán.
   */
  readonly externalAnchors: readonly ExternalAnchor[];
  /**
   * Người gọi TUYÊN BỐ rằng sổ rỗng là kết quả mong đợi (ví dụ: một tổ chức vừa được tạo).
   * Không có cờ này, `checked === 0` sinh một `EMPTY_LEDGER` — xem [vòng fix 1 — IM3].
   */
  readonly expectEmpty?: boolean;
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
 * ==========================================================================================
 * PHÁT BIỂU ĐÚNG MỨC — đọc trước khi trích dẫn kết quả của hàm này
 * ==========================================================================================
 * [vòng fix 1 — CR2] Bản trước viết "`ok === true` chứng minh: không ai SỬA ... các hàng ĐANG
 * CÓ trong bảng". ĐO ĐƯỢC LÀ SAI. Reviewer dựng lại bằng CHÍNH hàm SQL thật, dưới role deploy
 * KHÔNG superuser: sửa `action` của seq 3 rồi tính lại prev_hash/hash từ seq 3 trở đi —
 *   không neo ngoài: {"ok":true,"checked":6,"problems":[]}
 *   có neo ngoài:    ok=false, ANCHOR_MISSING tại seq 6
 * Đầu chuỗi nằm TRONG bán kính sửa đổi của tác nhân, nên chuỗi tự nó không ràng buộc gì trước
 * một tác nhân UPDATE được; nó chỉ bắt kẻ tấn công LƯỜI.
 *
 * Phát biểu đúng, bốn đoạn. Nó có mặt ở ba nơi — db/migrations/004_audit_chain_functions.sql,
 * chỗ này, và task-6-report.md §11.2 — TƯƠNG ĐƯƠNG VỀ NỘI DUNG, KHÔNG y hệt về văn bản: 004 đặt
 * câu về tiền ảnh v2 ở khối §(1) riêng của nó thay vì trong đoạn 1. [vòng fix 2 — M3] Bản trước
 * viết "nhân bản y hệt"; không có meta-test nào canh trục này, nên chữ đó là một lời hứa không
 * ai giữ. Đừng đọc "ba nơi" thành "khớp từng chữ".
 *
 *   Với sổ của một tổ chức MÀ PHIÊN HIỆN TẠI ĐỌC ĐƯỢC, hàm này phát hiện mọi thao tác XOÁ,
 *   CHÈN, CẮT ĐUÔI, và mọi thao tác SỬA trên các trường đi vào băm. Từ vòng fix 1, tiền ảnh
 *   phủ ĐỦ 13 cột dữ liệu của `audit_events` (`prev_hash` đi vào băm ở dạng byte, `hash` là
 *   đầu ra) — không còn cột nào nằm ngoài. `checked` là SỐ HÀNG ĐỌC ĐƯỢC DƯỚI RLS, không phải
 *   số hàng tồn tại.
 *
 *   Trước `app_api`/`app_unseal`/SQL injection, phát biểu này mạnh — nhưng công việc do TRIGGER
 *   và REVOKE THEO CỘT của B4 làm, chúng ngăn việc sửa đổi ngay từ đầu.
 *
 *   Trước CHỦ SỞ HỮU BẢNG KHÔNG-SUPERUSER, chuỗi KHÔNG CÓ NEO NGOÀI chứng minh về cơ bản là
 *   KHÔNG GÌ CẢ: tác nhân đó sửa một hàng rồi tính lại đuôi bằng chính hàm thật.
 *
 *   NẾU VÀ CHỈ NẾU người kiểm truyền vào một `ExternalAnchor` giữ ở nơi role deploy KHÔNG GHI
 *   ĐƯỢC, chuỗi còn phát hiện việc sổ bị THAY THẾ / DỰNG LẠI / LÀM RỖNG — cho TIỀN TỐ TỚI LẦN
 *   XUẤT CUỐI. Nó vẫn không nói gì về sự kiện bị NUỐT TRƯỚC KHI GHI, về mọi thứ SAU lần xuất
 *   cuối (nhịp neo CHÍNH LÀ cửa sổ giả mạo), hay về các cột ngoài tiền ảnh.
 *
 * Lỗ còn lại, đã đo ở bàn giao Task 5 và KHÔNG đóng được bằng chuỗi hash: một trigger
 * BEFORE INSERT ... RETURN NULL có điều kiện nuốt sự kiện CÓ CHỌN LỌC trong khi seq và
 * prev_hash vẫn liền mạch. Lớp phòng thủ tương ứng là danh sách trắng trigger trong
 * hardening.always.sql.
 *
 * Băm được tính lại bằng CHÍNH hàm SQL đã dùng lúc ghi (`audit_compute_hash`), nên không có
 * nguy cơ lệch do tuần tự hoá giữa hai tầng — và chính vì thế thân hàm đó được hardening cưỡng
 * chế ở mọi lần migrate() (mục D1a).
 *
 * NÉM (không trả về kết quả) khi phiên đang gắn một tổ chức KHÁC `orgId` — xem
 * `assertTenantBound`.
 */
export async function verifyAuditChain(
  client: pg.PoolClient,
  orgId: string,
  options: VerifyOptions,
): Promise<VerificationResult> {
  await assertTenantBound(client, orgId, "verifyAuditChain");

  const { rows } = await client.query<HangChuoi>(
    `SELECT ae.seq, ae.prev_hash, ae.hash,
            public.audit_compute_hash(ae.prev_hash, ae.id, ae.org_id, ae.seq, ae.occurred_at,
                                      ae.actor_type, ae.actor_id, ae.action, ae.resource_type,
                                      ae.resource_id, ae.payload, ae.request_id, ae.ip,
                                      ae.user_agent) AS bam_lai
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

  let coNeoDungToChuc = false;
  for (const neo of options.externalAnchors) {
    if (neo.orgId !== orgId) continue;
    coNeoDungToChuc = true;
    const bamThucTe = bamTheoSeq.get(neo.seq);
    if (bamThucTe === neo.hashHex) continue;
    problems.push({
      seq: neo.seq,
      kind: "ANCHOR_MISSING",
      detail:
        `Mốc neo NGOÀI DB (nguồn "${neo.source}", xuất lúc ${neo.exportedAt}) tại seq ${neo.seq} kỳ vọng băm ` +
        `${neo.hashHex} nhưng bảng ${bamThucTe === undefined ? "không còn hàng nào ở seq đó" : `có ${bamThucTe}`}` +
        " — sổ đã bị cắt đuôi, bị thay thế, hoặc bị dựng lại.",
    });
  }

  // [vòng fix 1 — CR2] Không có mốc neo NÀO của đúng tổ chức này thì kết luận không thể xanh.
  // seq 0 vì vấn đề thuộc về TOÀN chuỗi, không thuộc một mắt xích nào.
  if (!coNeoDungToChuc) {
    problems.push({
      seq: 0,
      kind: "NOT_ANCHORED",
      detail:
        "Không có mốc neo NGOÀI DB nào của tổ chức này được truyền vào. Chuỗi hash tự nó nằm " +
        "cùng vùng tin cậy với tác nhân: một chủ sở hữu bảng không-superuser sửa một hàng rồi " +
        "tính lại đuôi bằng chính hàm băm thật thì mọi phép kiểm còn lại đều XANH (đã đo). " +
        "Kết quả này chỉ nói 'chuỗi tự nhất quán', KHÔNG nói 'sổ không bị giả mạo'.",
    });
  }

  // [vòng fix 1 — IM3] "Không có vấn đề" và "không kiểm được" phải phân biệt được. Khẳng định
  // tenant ở đầu hàm đã loại ca "đọc nhầm tổ chức", nên `checked === 0` ở đây thật sự là sổ
  // rỗng — nhưng một sổ rỗng vẫn KHÔNG chứng minh gì (nó cũng là hình dạng của một sổ vừa bị
  // dựng lại). Người gọi phải nói ra rằng mình mong đợi điều đó.
  if (rows.length === 0 && options.expectEmpty !== true) {
    problems.push({
      seq: 0,
      kind: "EMPTY_LEDGER",
      detail:
        "Sổ của tổ chức này không có hàng nào đọc được. Đó cũng chính là hình dạng của một sổ " +
        "vừa bị DỰNG LẠI hoặc LÀM RỖNG, nên nó không được tính là 'hợp lệ'. Truyền " +
        "expectEmpty: true nếu sổ rỗng đúng là điều bạn mong đợi.",
    });
  }

  return { ok: problems.length === 0, checked: rows.length, problems };
}
