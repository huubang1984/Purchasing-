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
      WHERE ae.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
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
  //
  // [vòng fix 2 — MỤC A, quét toàn repo] MỌI TOÁN TỬ Ở ĐÂY GHI ĐỦ `OPERATOR(pg_catalog.=)`.
  //
  // [vòng fix 3 — MỤC 3] CÂU CŨ Ở ĐÂY SAI, giữ nguyên văn để không ai khôi phục nó:
  //     ┌ "và ĐÂY LÀ VẾ DUY NHẤT TRONG GÓI NÀY MÀ VIỆC ĐÓ VÁ MỘT LỖ ĐO ĐƯỢC chứ chỉ là ghim"
  //     └
  // Nó mâu thuẫn với `tenant-guard.ts` NGAY TRONG CÙNG MỘT COMMIT: docblock ở đó gọi
  // `OPERATOR(pg_catalog.=)` của `assertTenantBound` là "thứ CHỊU LỰC", và đo được — gỡ ghim ở
  // đó thì ba test `[INV-M5]` đỏ (hàng rào tenant bị vượt, `exportChainHead` đúc mốc neo mang
  // nhãn tổ chức khác). Vòng fix 3 đo thêm HAI chỗ nữa trong chính gói này (xem dưới và
  // `writer.ts`). Phát biểu ĐÚNG: trong gói `audit`, việc ghim toán tử/tên kiểu vá một lỗ ĐO
  // ĐƯỢC ở BỐN chỗ — `assertTenantBound` (cả toán tử lẫn tên kiểu), vế `NOT EXISTS` dưới đây,
  // vế `WHERE ae.org_id` của truy vấn chuỗi ở trên, và `exportChainHead`/`recordChainAnchor`
  // của `writer.ts`. Ba chỗ sau chỉ lộ ra dưới phiên KHÔNG chịu RLS — xem ngay dưới.
  //
  // Vế `NOT EXISTS` này là bộ phát hiện CẮT ĐUÔI. Dưới một `search_path` thù địch cướp `=` cho
  // `uuid`, `bigint` và `bytea` — cả ba đều là kiểu của chính ba cột được so — đã đo trên
  // PostgreSQL 16.15, trong một phiên gắn ĐÚNG tổ chức, trên một mốc neo trỏ tới hàng KHÔNG
  // tồn tại:
  //     EXISTS(... org_id = $1)                          -> true
  //     EXISTS(... seq = 999999)                         -> true
  //     EXISTS(... hash = decode('00','hex'))            -> true
  //     EXISTS(cả ba vế)                                 -> true   => NOT EXISTS = false
  // Tức `ANCHOR_MISSING` KHÔNG BAO GIỜ được báo: bộ kiểm chứng trả `ok:true` trên một sổ ĐÃ BỊ
  // CẮT ĐUÔI. Một công cụ kiểm toán fail-OPEN, im lặng — đúng lớp hỏng nặng nhất của gói này.
  //
  // [vòng fix 3 — MỤC 2] VẾ `WHERE ae.org_id` CỦA TRUY VẤN CHUỖI Ở TRÊN CŨNG CHỊU LỰC. Câu cũ
  // ở đây là một PHÁT BIỂU VÔ ĐIỀU KIỆN và nó SAI với một lớp phiên có thật; giữ nguyên văn:
  //     ┌ "nhưng ở đó việc ghim chỉ bỏ đi một bậc tự do: RLS đã giới hạn tập hàng về đúng tổ
  //     └  chức đang gắn, nên một `=` bị cướp ở đó KHÔNG mở rộng tập hàng ra ngoài tổ chức."
  // Mệnh đề "RLS đã giới hạn tập hàng" chỉ đúng VỚI PHIÊN CHỊU RLS. Một phiên `rolsuper` hoặc
  // `rolbypassrls` KHÔNG chịu RLS — và đó đúng là phiên mà một người vận hành chạy công cụ kiểm
  // toán bằng tay sẽ có (cũng là phiên `db.pool` mà `packages/test-support` cấp). Đo được, sổ
  // của P có 3 hàng và sổ của Q có 7 hàng, phiên SUPERUSER gắn P, `=` của `uuid` bị cướp:
  //     mã NGUYÊN BẢN (đã ghim)            -> checked = 3          (đúng)
  //     gỡ ghim ở vế `WHERE ae.org_id` này -> checked = 3 + 7 = 10 <<< TẬP HÀNG TRÀN RA NGOÀI
  //                                                                    TỔ CHỨC
  // ⇒ dưới phiên không chịu RLS, vế `WHERE` này là LỚP DUY NHẤT giới hạn tập hàng, nên ghim ở
  //   đây là VÁ chứ không phải trang trí. Mốc chết: test `[INV-M5] phiên BYPASSRLS` trong
  //   `tenant-guard.int.test.ts`.
  //
  // VÌ SAO KHÔNG THÊM MỘT PHÉP KIỂM `rolsuper`/`rolbypassrls` VÀO `assertTenantBound` theo
  // khuôn `khangDinhAuditPoolDungQuyen` của `[F9]`: hai đường KHÁC NHAU về kết cục. `[F9]` canh
  // đường GHI, ở đó một phiên bỏ qua RLS làm `WITH CHECK (org_id = app_current_org_id())` mất
  // hiệu lực và KHÔNG có vế nào khác thay thế được — từ chối là đường đóng duy nhất. Ở đường
  // ĐỌC này, vế `WHERE ... OPERATOR(pg_catalog.=) $1::pg_catalog.uuid` ĐÃ giới hạn tập hàng
  // đúng bằng phép đo ngay trên (checked = 3 dưới superuser + toán tử bị cướp), nên một phép
  // kiểm role mua thêm 0 bảo đảm; đổi lại nó sẽ CẤM chính người vận hành chạy `verifyAuditChain`
  // trong tình huống mà công cụ này sinh ra để phục vụ (điều tra sự cố dưới quyền DBA). Chọn
  // hạ phát biểu xuống đúng mức + đặt mốc chết, thay vì thêm một cổng chặn sai tầng.
  //
  // KIỂM THỬ ĐỘT BIẾN NÓI CHÍNH XÁC HƠN, và ghi ra vì nó hiệu chỉnh câu trên. Gỡ
  // `OPERATOR(pg_catalog.=)` khỏi TỪNG vế một:
  //     `ae.hash` một mình  -> GIẾT (test [INV-B2]: sửa nội dung hàng ĐANG ĐƯỢC NEO)
  //     `ae.seq`  một mình  -> SỐNG SÓT
  //     CẢ HAI cùng lúc     -> GIẾT hai lần ([INV-B3] cắt đuôi + [INV-B2] sửa nội dung)
  // `ae.seq` một mình sống sót KHÔNG phải vì thiếu test mà vì nó DƯ THỪA về mặt logic: `hash`
  // là khoá phân biệt hàng trên thực tế, nên một `seq` bị cướp vẫn bị `hash` (đang ghim) chặn
  // lại ở mọi trạng thái mà S0 với tới được. Nó được giữ để cả ba vế cùng một quy ước — không
  // phải vì có một khai thác đã đo cho riêng nó. `ae.org_id` cũng vậy.
  //
  // [vòng fix 3] DƯ LƯỢNG NÓI THẲNG, KHÔNG CÓ MỐC CHẾT: gỡ ghim ở `WHERE a.org_id` (vế lọc
  // bảng NEO) và ở `ae.org_id OPERATOR(pg_catalog.=) a.org_id` (trong `NOT EXISTS`) SỐNG SÓT cả
  // bộ test. Cơ chế đã hiểu, không phải "chưa có test":
  //   - `ae.org_id = a.org_id`: `hash` (đang ghim) là khoá phân biệt hàng, y hệt lập luận của
  //     `ae.seq` ở trên. Dư thừa về logic.
  //   - `WHERE a.org_id`: dưới phiên KHÔNG chịu RLS nó KHÔNG dư thừa — nó sẽ kéo mốc neo của
  //     tổ chức KHÁC vào báo cáo của tổ chức này. Ca phân biệt được cần một tổ chức thứ hai có
  //     mốc neo TREO LƠ LỬNG (đã neo rồi bị cắt đuôi) trong cùng CSDL; fixture đó chưa dựng.
  //     Đây là một lỗ RÒ RỈ BÁO CÁO xuyên tổ chức, không phải lỗ fail-open — nhưng nó là dư
  //     lượng thật, ghi vào sổ nợ `task-8-report.md` §V3.5 chứ không giấu.
  const { rows: hangNeo } = await client.query<{ seq: string }>(
    `SELECT a.seq
       FROM public.audit_chain_anchors a
      WHERE a.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND NOT EXISTS (
          SELECT 1 FROM public.audit_events ae
           WHERE ae.org_id OPERATOR(pg_catalog.=) a.org_id
             AND ae.seq OPERATOR(pg_catalog.=) a.seq
             AND ae.hash OPERATOR(pg_catalog.=) a.hash
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
