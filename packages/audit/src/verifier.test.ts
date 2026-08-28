import type pg from "pg";
import { describe, expect, it } from "vitest";
import { verifyAuditChain, type ChainProblem } from "./verifier.js";
import type { ChainHeadExport, ExternalAnchor } from "./writer.js";

/**
 * Kiểm chứng LOGIC ghép chuỗi, không cần container.
 *
 * Vì sao đáng có bên cạnh chain.int.test.ts: bốn phép kiểm của bộ kiểm chứng (SEQ_GAP,
 * LINK_BROKEN, HASH_MISMATCH, ANCHOR_MISSING) CHE NHAU trên dữ liệu thật — xoá một hàng ở giữa
 * làm đứt cả seq lẫn liên kết, nên một test tích hợp duy nhất không phân biệt được phép kiểm nào
 * đang làm việc. Ở đây từng phép kiểm được cô lập bằng một hàng dựng tay, nên đột biến vào ĐÚNG
 * một phép kiểm giết ĐÚNG một test.
 */

interface HangGia {
  seq: string;
  prev_hash: Buffer;
  hash: Buffer;
  bam_lai: Buffer;
}

const KHOI_NGUYEN = Buffer.alloc(32, 0);

function bam(nhan: string): Buffer {
  const b = Buffer.alloc(32, 0);
  b.write(nhan, "utf8");
  return b;
}

const ORG = "11111111-1111-1111-1111-111111111111";

/**
 * Client giả: phân biệt BA truy vấn của bộ kiểm chứng bằng nội dung của chúng. Cố ý KHÔNG khớp
 * theo thứ tự gọi — một đột biến hoán vị hai truy vấn sẽ vẫn bị bắt.
 *
 * [vòng fix 1 — IM3] `ganToChuc` mô phỏng GUC `app.org_id` của phiên. Mặc định là đúng tổ chức
 * đang kiểm; truyền một giá trị khác để dựng đúng ca "công cụ kiểm toán đọc nhầm tenant".
 */
function clientGia(
  chuoi: HangGia[],
  neo: { seq: string }[],
  ganToChuc: string | null = ORG,
): pg.PoolClient {
  const gia = {
    query: (sql: string, thamSo?: unknown[]): Promise<{ rows: unknown[] }> => {
      if (sql.includes("app_current_org_id")) {
        const orgHoi = (thamSo?.[0] ?? null) as string | null;
        return Promise.resolve({
          rows: [{ khop: ganToChuc === orgHoi, dang_gan: ganToChuc }],
        });
      }
      return Promise.resolve({ rows: sql.includes("audit_chain_anchors") ? neo : chuoi });
    },
  };
  return gia as unknown as pg.PoolClient;
}

/** Một chuỗi n mắt xích hoàn toàn hợp lệ. */
function chuoiTot(n: number): HangGia[] {
  const hang: HangGia[] = [];
  let truoc: Buffer = KHOI_NGUYEN;
  for (let i = 1; i <= n; i += 1) {
    const h = bam(`h${i}`);
    hang.push({ seq: String(i), prev_hash: truoc, hash: h, bam_lai: h });
    truoc = h;
  }
  return hang;
}

/**
 * Mốc neo NGOÀI DB khớp đúng mắt xích thứ `seq` của `chuoiTot`. Dùng cho những test chỉ muốn hỏi
 * về MỘT phép kiểm cụ thể mà không bị `NOT_ANCHORED` chen vào.
 *
 * [vòng fix 1 — CR2] Vì sao mọi test phải mang một mốc neo: `externalAnchors` nay BẮT BUỘC, và
 * mảng rỗng sinh `NOT_ANCHORED`. Đó chính là điều mục CR2 mua được — xem docstring của
 * verifyAuditChain.
 */
function neoKhop(seq: number): ExternalAnchor {
  return {
    orgId: ORG,
    seq,
    hashHex: bam(`h${seq}`).toString("hex"),
    exportedAt: "2026-08-27T00:00:00.000Z",
    // [vòng fix 2 — I2] `source` là BẮT BUỘC từ vòng này. Nó không được xác thực ở đâu cả —
    // giá trị của nó là bắt xuất xứ phải viết ra thành chữ, và fixture cũng không được miễn.
    source: "kho-artefact-gia-lap-cua-test",
  };
}

/** Chỉ giữ những vấn đề THUỘC CHUỖI, bỏ hai vấn đề mức-kết-luận của vòng fix 1. */
function chiVanDeChuoi(vd: readonly ChainProblem[]): [number, string][] {
  return vd
    .filter((p) => p.kind !== "NOT_ANCHORED" && p.kind !== "EMPTY_LEDGER")
    .map((p) => [p.seq, p.kind]);
}

describe("bộ kiểm chứng chuỗi kiểm toán", () => {
  it("[INV-B3] chuỗi hợp lệ CÓ mốc neo ngoài: ok, không vấn đề, đếm đúng số mắt xích", async () => {
    const kq = await verifyAuditChain(clientGia(chuoiTot(4), []), ORG, {
      externalAnchors: [neoKhop(4)],
    });
    expect(kq).toEqual({ ok: true, checked: 4, problems: [] });
  });

  /**
   * [vòng fix 1 — CR2] ĐÂY LÀ TEST QUAN TRỌNG NHẤT CỦA FILE NÀY. Bản trước codify điều NGƯỢC
   * LẠI: "chuỗi hợp lệ -> ok:true" với `externalAnchors` bỏ trống. Reviewer đo được rằng một
   * chủ sở hữu bảng không-superuser sửa một hàng rồi TÍNH LẠI ĐUÔI bằng chính hàm băm thật thì
   * kết quả cũng là ok:true, checked:6 — tức kết luận màu xanh KHÔNG PHÂN BIỆT ĐƯỢC hai trạng
   * thái. Một lời gọi không neo vì thế không được phép cho ra kết luận kiểm toán màu xanh.
   */
  it("[INV-B3] chuỗi hợp lệ mà KHÔNG có mốc neo ngoài -> NOT_ANCHORED, ok:false", async () => {
    const kq = await verifyAuditChain(clientGia(chuoiTot(4), []), ORG, { externalAnchors: [] });
    expect(kq.ok).toBe(false);
    expect(kq.checked).toBe(4);
    expect(kq.problems.map((p) => p.kind)).toEqual(["NOT_ANCHORED"]);
  });

  /**
   * [vòng fix 2 — I2] NEO TỰ ĐÚC TỪ CHÍNH CÁI SỔ ĐANG KIỂM.
   *
   * `[CR2]` của vòng fix 1 mua "không xanh khi KHÔNG neo" bằng cách đánh đổi "xanh khi có BẤT
   * KỲ neo nào". Đường dễ viết nhất khi ấy là lấy đầu chuỗi bằng `exportChainHead` rồi nộp
   * ngay lại cho bộ kiểm chứng — cùng bảng, cùng phiên, cùng vùng tin cậy — và kết quả
   * `{"ok":true,"problems":[]}` KHÔNG PHÂN BIỆT ĐƯỢC với một kết luận kiểm toán thật. Trước
   * vòng fix 1, `ok:true` ít nhất đi kèm một mảng neo RỖNG mà ai đọc mã cũng thấy; sau nó,
   * `ok:true` luôn đi kèm một mảng neo, nên nó TRÔNG NHƯ đã được neo.
   *
   * Bản vá đặt sự thật vào KIỂU: `exportChainHead` trả `ChainHeadExport`, thiếu `source`, nên
   * lời gọi đó không còn biên dịch được. `@ts-expect-error` bên dưới LÀ phép đo — nếu ai gỡ
   * `source` khỏi `ExternalAnchor` thì lỗi biến mất và `pnpm typecheck` (cổng t0) ĐỎ.
   *
   * Và vế thứ hai của test này quan trọng không kém: ở THÌ CHẠY, lớp kiểu không tồn tại. Một
   * object thiếu `source` vẫn làm `NOT_ANCHORED` im đi. Bản vá mua đúng MỘT thứ — đường tắt
   * không còn viết được một cách TÌNH CỜ — và nói rộng hơn thế là nói quá.
   */
  it("[vòng fix 2 — I2] neo tự đúc từ exportChainHead bị KIỂU chặn, còn thì chạy thì KHÔNG", async () => {
    const xuat: ChainHeadExport = {
      orgId: ORG,
      seq: 4,
      hashHex: bam("h4").toString("hex"),
      exportedAt: "2026-08-27T00:00:00.000Z",
    };
    const kq = await verifyAuditChain(clientGia(chuoiTot(4), []), ORG, {
      // @ts-expect-error `ChainHeadExport` thiếu `source` nên nó KHÔNG phải một `ExternalAnchor`.
      externalAnchors: [xuat],
    });
    expect(
      kq.ok,
      "ở thì chạy KHÔNG có lớp nào chặn — bản vá là lớp KIỂU, và chỉ là lớp kiểu",
    ).toBe(true);
    expect(kq.problems).toEqual([]);
  });

  it("[INV-F1] mốc neo CHỈ của tổ chức khác không tính là đã neo -> NOT_ANCHORED", async () => {
    const neoNgoai: ExternalAnchor = {
      orgId: "22222222-2222-2222-2222-222222222222",
      seq: 99,
      hashHex: bam("khac").toString("hex"),
      exportedAt: "2026-08-27T00:00:00.000Z",
      source: "kho-artefact-gia-lap-cua-test",
    };
    const kq = await verifyAuditChain(clientGia(chuoiTot(2), []), ORG, {
      externalAnchors: [neoNgoai],
    });
    // Mốc của tổ chức khác vẫn KHÔNG sinh báo động giả (không có ANCHOR_MISSING nào)...
    expect(kq.problems.map((p) => p.kind)).toEqual(["NOT_ANCHORED"]);
    // ...nhưng nó cũng KHÔNG mua được kết luận xanh: đó là vế mà vòng trước để hở.
    expect(kq.ok).toBe(false);
  });

  /**
   * [vòng fix 1 — IM3] "Sổ rỗng" là một CÂU TRẢ LỜI, không phải một chứng nhận sức khoẻ: nó
   * cũng chính là hình dạng của một sổ vừa bị dựng lại. Người gọi phải nói ra rằng mình mong
   * đợi nó.
   */
  it("[INV-B3] sổ rỗng KHÔNG khai báo trước -> EMPTY_LEDGER, ok:false", async () => {
    const kq = await verifyAuditChain(clientGia([], []), ORG, { externalAnchors: [] });
    expect(kq.ok).toBe(false);
    expect(kq.checked).toBe(0);
    expect(kq.problems.map((p) => p.kind).sort()).toEqual(["EMPTY_LEDGER", "NOT_ANCHORED"]);
  });

  it("[INV-B3] sổ rỗng ĐÃ khai báo trước (expectEmpty) thì chỉ còn thiếu mốc neo", async () => {
    const kq = await verifyAuditChain(clientGia([], []), ORG, {
      externalAnchors: [],
      expectEmpty: true,
    });
    expect(kq.problems.map((p) => p.kind)).toEqual(["NOT_ANCHORED"]);
  });

  /**
   * [vòng fix 1 — IM3] Bộ kiểm chứng không được trả lời "KHÔNG CÓ VẤN ĐỀ" ở chỗ phải trả lời
   * "KHÔNG KIỂM ĐƯỢC". Đo được trên DB thật: verifyAuditChain(client gắn tenant Q, orgP) trả
   * {"ok":true,"checked":0} trong khi sổ của P có 5 hàng.
   */
  it("[INV-F1] phiên gắn tổ chức KHÁC -> NÉM, không trả về kết luận nào", async () => {
    const loi = await verifyAuditChain(
      clientGia(chuoiTot(3), [], "22222222-2222-2222-2222-222222222222"),
      ORG,
      { externalAnchors: [] },
    ).then(
      () => "THÀNH CÔNG",
      (e: Error) => e.message,
    );
    expect(loi).toContain("22222222-2222-2222-2222-222222222222");
    expect(loi).toContain("withTenant");
  });

  it("[INV-F1] phiên CHƯA gắn tổ chức nào -> NÉM, và thông báo nói rõ điều đó", async () => {
    const loi = await verifyAuditChain(clientGia(chuoiTot(3), [], null), ORG, {
      externalAnchors: [],
    }).then(
      () => "THÀNH CÔNG",
      (e: Error) => e.message,
    );
    expect(loi).toContain("chưa gắn");
  });

  it("[INV-B3] băm không khớp bản tính lại -> HASH_MISMATCH, và CHỈ nó", async () => {
    const chuoi = chuoiTot(3);
    chuoi[1] = { ...chuoi[1]!, bam_lai: bam("khac") };
    const kq = await verifyAuditChain(clientGia(chuoi, []), ORG, {
      externalAnchors: [neoKhop(3)],
    });
    expect(chiVanDeChuoi(kq.problems)).toEqual([[2, "HASH_MISMATCH"]]);
    expect(kq.ok).toBe(false);
  });

  it("[INV-B3] prev_hash không nối đuôi hàng trước -> LINK_BROKEN, và CHỈ nó", async () => {
    const chuoi = chuoiTot(3);
    chuoi[2] = { ...chuoi[2]!, prev_hash: bam("lac") };
    const kq = await verifyAuditChain(clientGia(chuoi, []), ORG, {
      externalAnchors: [neoKhop(3)],
    });
    expect(chiVanDeChuoi(kq.problems)).toEqual([[3, "LINK_BROKEN"]]);
  });

  it("[INV-B3] hàng đầu chuỗi không bắt đầu từ khởi nguyên 32 byte 0 -> LINK_BROKEN", async () => {
    const chuoi = chuoiTot(2);
    chuoi[0] = { ...chuoi[0]!, prev_hash: bam("khong-phai-khoi-nguyen") };
    const kq = await verifyAuditChain(clientGia(chuoi, []), ORG, {
      externalAnchors: [neoKhop(2)],
    });
    expect(chiVanDeChuoi(kq.problems).map((p) => p[1])).toEqual(["LINK_BROKEN"]);
  });

  it("[INV-B3] seq nhảy cóc -> SEQ_GAP, và CHỈ nó khi liên kết vẫn nguyên", async () => {
    // Liên kết cố ý GIỮ NGUYÊN: đây là ca mà SEQ_GAP là phép kiểm DUY NHẤT còn tác dụng.
    const chuoi = chuoiTot(3);
    chuoi[2] = { ...chuoi[2]!, seq: "9" };
    const kq = await verifyAuditChain(clientGia(chuoi, []), ORG, {
      externalAnchors: [neoKhop(2)],
    });
    expect(chiVanDeChuoi(kq.problems)).toEqual([[9, "SEQ_GAP"]]);
  });

  it("[INV-B3] mốc neo trong DB không còn hàng tương ứng -> ANCHOR_MISSING", async () => {
    const kq = await verifyAuditChain(clientGia(chuoiTot(2), [{ seq: "6" }]), ORG, {
      externalAnchors: [neoKhop(2)],
    });
    expect(chiVanDeChuoi(kq.problems)).toEqual([[6, "ANCHOR_MISSING"]]);
  });

  it("[INV-B3] mốc neo NGOÀI DB không khớp -> ANCHOR_MISSING, kể cả khi sổ đã bị dựng lại rỗng", async () => {
    const neoNgoai: ExternalAnchor = {
      orgId: ORG,
      seq: 5,
      hashHex: bam("h5").toString("hex"),
      exportedAt: "2026-08-27T00:00:00.000Z",
      source: "kho-artefact-gia-lap-cua-test",
    };
    const kq = await verifyAuditChain(clientGia([], []), ORG, {
      externalAnchors: [neoNgoai],
      expectEmpty: true,
    });
    expect(chiVanDeChuoi(kq.problems)).toEqual([[5, "ANCHOR_MISSING"]]);
    expect(kq.problems[0]!.detail).toContain("không còn hàng nào ở seq đó");
  });

  it("[INV-B3] mốc neo NGOÀI DB khớp hàng đang có thì không báo vấn đề", async () => {
    const kq = await verifyAuditChain(clientGia(chuoiTot(3), []), ORG, {
      externalAnchors: [neoKhop(2)],
    });
    expect(kq.problems).toEqual([]);
  });

  it("[INV-B3] mốc neo NGOÀI DB có băm KHÁC ở đúng seq đó -> ANCHOR_MISSING", async () => {
    const neoNgoai: ExternalAnchor = {
      orgId: ORG,
      seq: 2,
      hashHex: bam("bam-cu").toString("hex"),
      exportedAt: "2026-08-27T00:00:00.000Z",
      source: "kho-artefact-gia-lap-cua-test",
    };
    const kq = await verifyAuditChain(clientGia(chuoiTot(3), []), ORG, {
      externalAnchors: [neoNgoai],
    });
    expect(chiVanDeChuoi(kq.problems).map((p) => p[1])).toEqual(["ANCHOR_MISSING"]);
    expect(kq.problems[0]!.detail).toContain("có ");
    // [vòng fix 2 — I2] Xuất xứ phải ĐI VÀO KẾT LUẬN. Không có vế này thì `source` là một
    // trường trang trí mà chỉ trình biên dịch nhìn thấy, và một kết luận kiểm toán vẫn không
    // nói được nó dựa vào gốc tin cậy nào.
    expect(kq.problems[0]!.detail).toContain('nguồn "kho-artefact-gia-lap-cua-test"');
  });

  it("[INV-F1] mốc neo của tổ chức KHÁC bị bỏ qua, không sinh báo động giả", async () => {
    const neoNgoai: ExternalAnchor = {
      orgId: "22222222-2222-2222-2222-222222222222",
      seq: 99,
      hashHex: bam("khac").toString("hex"),
      exportedAt: "2026-08-27T00:00:00.000Z",
      source: "kho-artefact-gia-lap-cua-test",
    };
    const kq = await verifyAuditChain(clientGia(chuoiTot(2), []), ORG, {
      externalAnchors: [neoNgoai, neoKhop(2)],
    });
    expect(kq.problems).toEqual([]);
    expect(kq.ok).toBe(true);
  });
});
