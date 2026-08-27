import type pg from "pg";
import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "./verifier.js";
import type { ExternalAnchor } from "./writer.js";

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

/**
 * Client giả: phân biệt hai truy vấn của bộ kiểm chứng bằng bảng mà chúng đọc. Cố ý KHÔNG khớp
 * theo thứ tự gọi — một đột biến hoán vị hai truy vấn sẽ vẫn bị bắt.
 */
function clientGia(chuoi: HangGia[], neo: { seq: string }[]): pg.PoolClient {
  const gia = {
    query: (sql: string): Promise<{ rows: unknown[] }> =>
      Promise.resolve({ rows: sql.includes("audit_chain_anchors") ? neo : chuoi }),
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

const ORG = "11111111-1111-1111-1111-111111111111";

describe("bộ kiểm chứng chuỗi kiểm toán", () => {
  it("[INV-B3] chuỗi hợp lệ: ok, không vấn đề, đếm đúng số mắt xích", async () => {
    const kq = await verifyAuditChain(clientGia(chuoiTot(4), []), ORG);
    expect(kq).toEqual({ ok: true, checked: 4, problems: [] });
  });

  it("[INV-B3] sổ rỗng là HỢP LỆ — và đó chính là bậc tự do mà mốc neo ngoài DB tồn tại để đóng", async () => {
    const kq = await verifyAuditChain(clientGia([], []), ORG);
    expect(kq).toEqual({ ok: true, checked: 0, problems: [] });
  });

  it("[INV-B3] băm không khớp bản tính lại -> HASH_MISMATCH, và CHỈ nó", async () => {
    const chuoi = chuoiTot(3);
    chuoi[1] = { ...chuoi[1]!, bam_lai: bam("khac") };
    const kq = await verifyAuditChain(clientGia(chuoi, []), ORG);
    expect(kq.problems.map((p) => [p.seq, p.kind])).toEqual([[2, "HASH_MISMATCH"]]);
    expect(kq.ok).toBe(false);
  });

  it("[INV-B3] prev_hash không nối đuôi hàng trước -> LINK_BROKEN, và CHỈ nó", async () => {
    const chuoi = chuoiTot(3);
    chuoi[2] = { ...chuoi[2]!, prev_hash: bam("lac") };
    const kq = await verifyAuditChain(clientGia(chuoi, []), ORG);
    expect(kq.problems.map((p) => [p.seq, p.kind])).toEqual([[3, "LINK_BROKEN"]]);
  });

  it("[INV-B3] hàng đầu chuỗi không bắt đầu từ khởi nguyên 32 byte 0 -> LINK_BROKEN", async () => {
    const chuoi = chuoiTot(2);
    chuoi[0] = { ...chuoi[0]!, prev_hash: bam("khong-phai-khoi-nguyen") };
    const kq = await verifyAuditChain(clientGia(chuoi, []), ORG);
    expect(kq.problems.map((p) => p.kind)).toEqual(["LINK_BROKEN"]);
  });

  it("[INV-B3] seq nhảy cóc -> SEQ_GAP, và CHỈ nó khi liên kết vẫn nguyên", async () => {
    // Liên kết cố ý GIỮ NGUYÊN: đây là ca mà SEQ_GAP là phép kiểm DUY NHẤT còn tác dụng.
    const chuoi = chuoiTot(3);
    chuoi[2] = { ...chuoi[2]!, seq: "9" };
    const kq = await verifyAuditChain(clientGia(chuoi, []), ORG);
    expect(kq.problems.map((p) => [p.seq, p.kind])).toEqual([[9, "SEQ_GAP"]]);
  });

  it("[INV-B3] mốc neo trong DB không còn hàng tương ứng -> ANCHOR_MISSING", async () => {
    const kq = await verifyAuditChain(clientGia(chuoiTot(2), [{ seq: "6" }]), ORG);
    expect(kq.problems.map((p) => [p.seq, p.kind])).toEqual([[6, "ANCHOR_MISSING"]]);
  });

  it("[INV-B3] mốc neo NGOÀI DB không khớp -> ANCHOR_MISSING, kể cả khi sổ đã bị dựng lại rỗng", async () => {
    const neoNgoai: ExternalAnchor = {
      orgId: ORG,
      seq: 5,
      hashHex: bam("h5").toString("hex"),
      exportedAt: "2026-08-27T00:00:00.000Z",
    };
    const kq = await verifyAuditChain(clientGia([], []), ORG, { externalAnchors: [neoNgoai] });
    expect(kq.problems.map((p) => [p.seq, p.kind])).toEqual([[5, "ANCHOR_MISSING"]]);
    expect(kq.problems[0]!.detail).toContain("không còn hàng nào ở seq đó");
  });

  it("[INV-B3] mốc neo NGOÀI DB khớp hàng đang có thì không báo vấn đề", async () => {
    const neoNgoai: ExternalAnchor = {
      orgId: ORG,
      seq: 2,
      hashHex: bam("h2").toString("hex"),
      exportedAt: "2026-08-27T00:00:00.000Z",
    };
    const kq = await verifyAuditChain(clientGia(chuoiTot(3), []), ORG, {
      externalAnchors: [neoNgoai],
    });
    expect(kq.problems).toEqual([]);
  });

  it("[INV-B3] mốc neo NGOÀI DB có băm KHÁC ở đúng seq đó -> ANCHOR_MISSING", async () => {
    const neoNgoai: ExternalAnchor = {
      orgId: ORG,
      seq: 2,
      hashHex: bam("bam-cu").toString("hex"),
      exportedAt: "2026-08-27T00:00:00.000Z",
    };
    const kq = await verifyAuditChain(clientGia(chuoiTot(3), []), ORG, {
      externalAnchors: [neoNgoai],
    });
    expect(kq.problems.map((p) => p.kind)).toEqual(["ANCHOR_MISSING"]);
    expect(kq.problems[0]!.detail).toContain("có ");
  });

  it("[INV-F1] mốc neo của tổ chức KHÁC bị bỏ qua, không sinh báo động giả", async () => {
    const neoNgoai: ExternalAnchor = {
      orgId: "22222222-2222-2222-2222-222222222222",
      seq: 99,
      hashHex: bam("khac").toString("hex"),
      exportedAt: "2026-08-27T00:00:00.000Z",
    };
    const kq = await verifyAuditChain(clientGia(chuoiTot(2), []), ORG, {
      externalAnchors: [neoNgoai],
    });
    expect(kq.problems).toEqual([]);
    expect(kq.ok).toBe(true);
  });
});
