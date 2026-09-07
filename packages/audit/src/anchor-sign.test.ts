// ==============================================================================================
// TEST CỦA BỘ KÝ MỐC NEO — FILE DUY NHẤT NGOÀI `tools/neo-so-kiem-toan` ĐƯỢC IMPORT `anchor-sign.ts`
//
// Quy tắc `g11-ky-neo-chi-o-cong-cu-xuat-neo` liệt kê đích danh file này. Đừng thêm một import
// nào từ đây sang nơi khác, và đừng import file này từ đâu cả —
// `g11-khong-import-nguoc-tu-anchor-sign-test` cấm, vì một file test cũng là một cây cầu.
// ==============================================================================================

import { taoBoKyNeoThuNghiem } from "@trustprocure/test-support";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnchorSigningKeyRing,
  createLocalDevAnchorSigner,
  generateAnchorKeyPair,
  type AnchorKeyPair,
} from "./anchor-sign.js";
import { AnchorError, parseAnchorText } from "./anchor-text.js";
import { verifyAnchorRecord } from "./anchor-verify.js";

const ORG = "11111111-2222-3333-4444-555555555555";
const TRUONG = {
  orgId: ORG,
  seq: 6,
  hashHex: "a".repeat(64),
  exportedAt: "2026-09-07T10:11:12.345Z",
} as const;

function vongKhoa(kid = "neo-2026", them?: Record<string, AnchorKeyPair>): AnchorSigningKeyRing {
  return new AnchorSigningKeyRing(kid, { [kid]: generateAnchorKeyPair(), ...them });
}

describe("bộ ký mốc neo", () => {
  it("[INV-B3] chữ ký nó sinh ra kiểm được bằng đường ĐỌC, và kid đi vào văn bản đã ký", () => {
    const ring = vongKhoa("neo-2026");
    const banGhi = createLocalDevAnchorSigner(ring).sign(TRUONG);

    expect(parseAnchorText(banGhi.text).kid).toBe("neo-2026");
    const neo = verifyAnchorRecord(banGhi, ring.publicKeys(), "kho thử");
    expect(neo.seq).toBe(6);
    expect(neo.source).toContain("kid=neo-2026");
  });

  it("[INV-B3] một vòng khoá KHÁC không kiểm được chữ ký này", () => {
    const banGhi = createLocalDevAnchorSigner(vongKhoa("neo-2026")).sign(TRUONG);
    expect(() =>
      verifyAnchorRecord(banGhi, vongKhoa("neo-2026").publicKeys(), "kho thử"),
    ).toThrow(/KHÔNG khớp văn bản/);
  });

  it("[INV-B3] mốc neo do bộ ký THỬ NGHIỆM sinh ra cũng kiểm được — hai cài đặt, một định dạng", () => {
    // Vế đối xứng của test đầu: `taoBoKyNeoThuNghiem` ký bằng `createSign` trần, bộ ký sản phẩm
    // đi qua `AnchorSigningKeyRing`. Hai đường độc lập cùng ra một artefact kiểm được là bằng
    // chứng rằng định dạng — chứ không phải một cài đặt cụ thể — mới là thứ chịu lực.
    const bo = taoBoKyNeoThuNghiem("neo-doc-lap");
    expect(() => verifyAnchorRecord(bo.ky(TRUONG), bo.khoaCongKhai, "kho")).not.toThrow();
  });

  it("từ chối ký khi một trường sai định dạng — cổng chặn nằm trên đường KÝ", () => {
    const boKy = createLocalDevAnchorSigner(vongKhoa());
    expect(() => boKy.sign({ ...TRUONG, seq: 0 })).toThrow(AnchorError);
  });

  describe("vòng khoá", () => {
    it("từ chối vòng khoá rỗng", () => {
      expect(() => new AnchorSigningKeyRing("neo", {})).toThrow(/ít nhất một khoá/);
    });

    it("từ chối kid mang ký tự đi vào được một dòng khoa=gia-tri", () => {
      expect(
        () => new AnchorSigningKeyRing("a=b", { "a=b": generateAnchorKeyPair() }),
      ).toThrow(/không hợp lệ/);
    });

    it("từ chối khi khoá đang dùng không có trong vòng khoá", () => {
      expect(
        () => new AnchorSigningKeyRing("vang-mat", { "co-mat": generateAnchorKeyPair() }),
      ).toThrow(/không chứa khoá đang dùng/);
    });

    it("giữ khoá CŨ sau khi xoay — mốc neo cũ vẫn kiểm được", () => {
      // Cùng luật với `ReceiptSigningKeyRing` (ADR-011 mục 3), và ở đây hậu quả của việc phá luật
      // nặng hơn: gỡ một khoá neo cũ làm mọi mốc neo đã xuất trước lần xoay vĩnh viễn không kiểm
      // được, tức xoá sạch chính thứ ràng buộc quá khứ.
      const cu = generateAnchorKeyPair();
      const ringCu = new AnchorSigningKeyRing("neo-2025", { "neo-2025": cu });
      const banGhiCu = createLocalDevAnchorSigner(ringCu).sign(TRUONG);

      const ringMoi = new AnchorSigningKeyRing("neo-2026", {
        "neo-2025": cu,
        "neo-2026": generateAnchorKeyPair(),
      });
      expect(ringMoi.activeKeyId).toBe("neo-2026");
      expect(() => verifyAnchorRecord(banGhiCu, ringMoi.publicKeys(), "kho")).not.toThrow();
    });

    it("publicKeys() không mang một byte nào của khoá RIÊNG", () => {
      // Vế phủ định suy từ tính chất, cùng khuôn với `apps/public-keys`: dò chuỗi byte khoá riêng
      // dưới cả ba cách mã hoá mà nó có thể lọt ra.
      const cap = generateAnchorKeyPair();
      const ring = new AnchorSigningKeyRing("neo", { neo: cap });
      const congKhai = [...ring.publicKeys().values()]
        .map((k) => Buffer.from(k).toString("hex"))
        .join("|");
      const rieng = Buffer.from(cap.privateKey);
      for (const dang of ["hex", "base64", "base64url"] as const) {
        expect(congKhai).not.toContain(rieng.toString(dang));
      }
      // Đối chứng cho chính phép dò: nó phải TÌM RA một lần rò rỉ dựng sẵn.
      expect(rieng.toString("hex") + congKhai).toContain(rieng.toString("hex"));
    });
  });

  it("[INV-B3] hai nửa khoá KHÔNG phải một cặp thì bị chặn NGAY lúc tạo bộ ký", () => {
    // ==========================================================================================
    // [review lượt 9 — H9-3] Không có vế tự kiểm này, một lần xoay khoá dán nhầm nửa công khai
    // cho ra một bộ ký chạy SẠCH: `xuat` thoát mã 0 và in `seq=...` mỗi lượt, hàng tháng trời.
    // `kiem` chưa có LỊCH (ADR-026 §5⑴), nên lỗi chỉ lộ ra ở lần kiểm toán thật — và khi ấy
    // `loadVerifiedAnchors` fail-closed đúng thiết kế, nhưng TOÀN BỘ cửa sổ đó không có một mốc
    // neo nào dùng được. Fail-closed ở đường ĐỌC không cứu được một lỗi cấu hình ở đường GHI.
    //
    // MỐC CHẾT: gỡ khối tự kiểm trong `createLocalDevAnchorSigner` thì test này ĐỎ.
    // ==========================================================================================
    const lech = new AnchorSigningKeyRing("neo-lech", {
      "neo-lech": {
        privateKey: generateAnchorKeyPair().privateKey,
        publicKey: generateAnchorKeyPair().publicKey,
      },
    });
    expect(() => createLocalDevAnchorSigner(lech)).toThrow(/KHÔNG phải một cặp/);
  });

  describe("hàng rào môi trường fail-closed", () => {
    const GOC = {
      NODE_ENV: process.env["NODE_ENV"],
      TRUSTPROCURE_KEY_ADAPTER: process.env["TRUSTPROCURE_KEY_ADAPTER"],
      TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS: process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"],
    };

    afterEach(() => {
      for (const [ten, gt] of Object.entries(GOC)) {
        if (gt === undefined) delete process.env[ten];
        else process.env[ten] = gt;
      }
    });

    it("[INV-G1] bị CHẶN ở production, và chặn NGAY lúc tạo chứ không đợi lần ký đầu", () => {
      process.env["NODE_ENV"] = "production";
      process.env["TRUSTPROCURE_KEY_ADAPTER"] = "local-dev";
      delete process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"];
      const ring = vongKhoa();
      expect(() => createLocalDevAnchorSigner(ring)).toThrow(/local-dev.*bị chặn/s);
    });

    it("[INV-G1] bị CHẶN khi không tiến trình nào khai adapter — mặc định là TỪ CHỐI", () => {
      delete process.env["NODE_ENV"];
      delete process.env["TRUSTPROCURE_KEY_ADAPTER"];
      delete process.env["TRUSTPROCURE_ALLOW_LOCAL_DEV_KEYS"];
      const ring = vongKhoa();
      expect(() => createLocalDevAnchorSigner(ring)).toThrow(/bị chặn/);
    });

    it("[INV-G1] bị CHẶN khi tiến trình khai một adapter KHÁC", () => {
      process.env["TRUSTPROCURE_KEY_ADAPTER"] = "aws-kms";
      const ring = vongKhoa();
      expect(() => createLocalDevAnchorSigner(ring)).toThrow(/đang là "aws-kms"/);
    });
  });
});
