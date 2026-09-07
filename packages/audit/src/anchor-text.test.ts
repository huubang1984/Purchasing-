import { describe, expect, it } from "vitest";
import {
  ANCHOR_FORMAT_LABEL,
  ANCHOR_SIGNING_ALGORITHM,
  AnchorError,
  buildAnchorText,
  parseAnchorText,
  type AnchorFields,
} from "./anchor-text.js";

const HOP_LE: AnchorFields = {
  kid: "neo-2026",
  orgId: "11111111-2222-3333-4444-555555555555",
  seq: 6,
  hashHex: "a".repeat(64),
  exportedAt: "2026-09-07T10:11:12.345Z",
};

describe("văn bản chính tắc của mốc neo", () => {
  it("dựng đúng bảy dòng, đúng thứ tự, kết thúc bằng một dòng mới", () => {
    const text = buildAnchorText(HOP_LE);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.slice(0, -1).split("\n")).toEqual([
      ANCHOR_FORMAT_LABEL,
      `alg=${ANCHOR_SIGNING_ALGORITHM}`,
      "kid=neo-2026",
      "org_id=11111111-2222-3333-4444-555555555555",
      "seq=6",
      `chain_hash=${"a".repeat(64)}`,
      "exported_at=2026-09-07T10:11:12.345Z",
    ]);
  });

  it("đọc ngược ra đúng các trường đã dựng", () => {
    expect(parseAnchorText(buildAnchorText(HOP_LE))).toEqual({
      ...HOP_LE,
      alg: ANCHOR_SIGNING_ALGORITHM,
    });
  });

  // Bảng này là hàng rào của định dạng, và mỗi hàng là một đường mà một trường bẩn đi vào văn bản
  // ĐƯỢC KÝ. Ca `kid` mang `\n` là ca nặng nhất: nó chèn thêm được một dòng vào văn bản, tức đúc
  // ra một mốc neo mang `seq`/`chain_hash` khác thứ người ký tưởng mình đang ký.
  it.each([
    ["kid rỗng", { kid: "" }],
    ["kid mang xuống dòng", { kid: "neo\nchain_hash=" + "b".repeat(64) }],
    ["kid mang dấu bằng", { kid: "neo=2026" }],
    ["org_id không phải UUID", { orgId: "khong-phai-uuid" }],
    ["org_id viết HOA", { orgId: "11111111-2222-3333-4444-55555555555A" }],
    ["seq bằng 0", { seq: 0 }],
    ["seq âm", { seq: -1 }],
    ["seq không nguyên", { seq: 1.5 }],
    ["chain_hash ngắn", { hashHex: "a".repeat(63) }],
    ["chain_hash viết HOA", { hashHex: "A".repeat(64) }],
    ["exported_at thiếu Z", { exportedAt: "2026-09-07T10:11:12.345" }],
    ["exported_at chỉ tới giây", { exportedAt: "2026-09-07T10:11:12Z" }],
  ])("từ chối dựng khi %s", (_ten, chenh) => {
    expect(() => buildAnchorText({ ...HOP_LE, ...chenh })).toThrow(AnchorError);
  });

  it("từ chối đọc một văn bản không mang nhãn định dạng", () => {
    const text = buildAnchorText(HOP_LE).replace(ANCHOR_FORMAT_LABEL, "trustprocure-anchor-v2");
    expect(() => parseAnchorText(text)).toThrow(/không phải một mốc neo TrustProcure v1/);
  });

  it("từ chối đọc một văn bản thiếu dòng mới cuối", () => {
    expect(() => parseAnchorText(buildAnchorText(HOP_LE).slice(0, -1))).toThrow(
      /kết thúc bằng một dòng mới/,
    );
  });

  it("từ chối đọc một văn bản có thêm một dòng lạ", () => {
    expect(() => parseAnchorText(buildAnchorText(HOP_LE) + "them=1\n")).toThrow(/đúng 7 dòng/);
  });

  it("từ chối đọc khi một trường bị đổi TÊN — thứ tự trường là một phần của định dạng", () => {
    const text = buildAnchorText(HOP_LE).replace("chain_hash=", "chainhash=");
    expect(() => parseAnchorText(text)).toThrow(/phải là trường "chain_hash"/);
  });
});
