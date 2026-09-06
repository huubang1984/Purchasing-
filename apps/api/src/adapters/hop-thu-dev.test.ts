// [S1.11] Hộp thư dev: mỗi tin một tệp, link mang token ở FRAGMENT (ADR-020 mục 3), không một byte
// nào qua console, và không dựng được khi tiến trình khai adapter khác local-dev.
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { taoHopThuDev, type TinHopThuDev } from "./hop-thu-dev.js";

let thuMuc: string;

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env["TRUSTPROCURE_KEY_ADAPTER"];
  if (thuMuc !== undefined) rmSync(thuMuc, { recursive: true, force: true });
});

function docTin(): TinHopThuDev[] {
  return readdirSync(thuMuc)
    .sort()
    .map((t) => JSON.parse(readFileSync(join(thuMuc, t), "utf8")) as TinHopThuDev);
}

describe("[S1.11] hộp thư dev", () => {
  it("ba loại tin, ba tệp; link đăng nhập /login#<token>, link mời /i#<token>, OTP chỉ có mã; không qua console", async () => {
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    thuMuc = join(mkdtempSync(join(tmpdir(), "tp-hop-thu-")), "con");
    const ht = taoHopThuDev({ thuMuc, baseUrl: "https://mua.vidu.vn" });
    expect(ht.loginLinkSender.name).toBe("dev-mailbox");
    await ht.loginLinkSender.send({ orgId: "org-1", email: "a@vidu.vn", token: "TOKEN-DANG-NHAP" });
    await ht.invitationLinkSender.send({ orgId: "org-1", invitationId: "inv-1", channel: "EMAIL", destination: "ncc@vidu.vn", token: "TOKEN-MOI" });
    await ht.otpSender.send({ channel: "SMS", destination: "+84900000000", code: "123456" });
    const tin = docTin();
    expect(tin).toHaveLength(3);
    expect(tin.map((t) => t.loai)).toEqual(["LOGIN_LINK", "INVITATION_LINK", "OTP"]);
    const [dn, moi, otp] = tin as [TinHopThuDev, TinHopThuDev, TinHopThuDev];
    expect(dn.loai === "LOGIN_LINK" && dn.duongLink).toBe("https://mua.vidu.vn/login#TOKEN-DANG-NHAP");
    expect(moi.loai === "INVITATION_LINK" && moi.duongLink).toBe("https://mua.vidu.vn/i#TOKEN-MOI");
    expect(otp.loai === "OTP" && otp.ma).toBe("123456");
    // Token không bao giờ vào đường dẫn hay query — chỉ sau `#`.
    for (const t of tin) if ("duongLink" in t) expect(new URL(t.duongLink).pathname + new URL(t.duongLink).search).not.toMatch(/TOKEN/u);
    expect(loi).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    // Thư mục được tạo (kể cả lồng), tệp chỉ chủ đọc được — trên POSIX; Windows không có mode.
    if (process.platform !== "win32") {
      expect(statSync(thuMuc).mode & 0o777).toBe(0o700);
      for (const t of readdirSync(thuMuc)) expect(statSync(join(thuMuc, t)).mode & 0o777).toBe(0o600);
    }
  });

  it("hàng rào môi trường chạy NGAY KHI TẠO; [review H3-2] local-dev + NODE_ENV=production cũng bị chặn", () => {
    thuMuc = mkdtempSync(join(tmpdir(), "tp-hop-thu-"));
    process.env["TRUSTPROCURE_KEY_ADAPTER"] = "kms";
    expect(() => taoHopThuDev({ thuMuc, baseUrl: "https://mua.vidu.vn" })).toThrow(/local-dev/u);
    const nodeEnvGoc = process.env["NODE_ENV"];
    process.env["TRUSTPROCURE_KEY_ADAPTER"] = "local-dev";
    process.env["NODE_ENV"] = "production";
    try {
      expect(() => taoHopThuDev({ thuMuc, baseUrl: "https://mua.vidu.vn" })).toThrow(/mâu thuẫn/u);
    } finally {
      if (nodeEnvGoc === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = nodeEnvGoc;
    }
  });

  it("[review H3-3] thư mục có sẵn với quyền rộng được siết về 0700 (POSIX)", () => {
    thuMuc = mkdtempSync(join(tmpdir(), "tp-hop-thu-"));
    if (process.platform === "win32") return; // Windows không có mode POSIX — vế này chỉ đo được trên Linux/macOS (CI T1 ubuntu).
    chmodSync(thuMuc, 0o755);
    taoHopThuDev({ thuMuc, baseUrl: "https://mua.vidu.vn" });
    expect(statSync(thuMuc).mode & 0o777).toBe(0o700);
  });
});
