// Nguồn: giải mã stdout `terraform console` và bộ nối AWS CLI — chạy trên một `aws` giả bằng Node (chạy được cả Windows).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { congAwsCli, DocBienError, giaiMaConsole, maLoiAws, TienTrinhError } from "./nguon.js";

/** Đúng dạng terraform 1.x in ra cho `jsonencode(...)`: một chuỗi HCL có ngoặc kép. */
const consoleIn = (v: unknown): string => `${JSON.stringify(JSON.stringify(v))}\n`;

const BIEN = {
  bien: {
    ten_mien: "app.thu-mua.vn",
    anh: { api: "a", worker: "b", migrate: "c", web: "d", public_keys: "e", neo: "f" },
    so_ban_api: 1,
    so_ban_worker: 0,
    ses: { tu_api: "x@thu-mua.vn", tu_canh_bao: "y@thu-mua.vn", nhan_canh_bao: ["z@thu-mua.vn"], configuration_set: "tp-thu" },
    sms: null,
    zalo: null,
    che_do_dns: "BLOCK",
    ses_endpoint_service: "email",
  },
  prod: "942091277863",
  region: "ap-southeast-1",
};

describe("giaiMaConsole", () => {
  it("đọc đủ biến và hằng số", () => {
    const { bien, hang } = giaiMaConsole(consoleIn(BIEN));
    expect(hang).toEqual({ prod: "942091277863", region: "ap-southeast-1" });
    expect(bien.anh.public_keys).toBe("e");
    expect(bien.sms).toBeNull();
    expect(bien.ses.nhan_canh_bao).toEqual(["z@thu-mua.vn"]);
  });

  it("sms có configuration_set null (optional) và zalo đủ ba template", () => {
    const { bien } = giaiMaConsole(
      consoleIn({ ...BIEN, bien: { ...BIEN.bien, sms: { danh_tinh_gui: "THUMUA", configuration_set: null }, zalo: { template_otp: "1", template_invitation: "2", template_deadline: "3" } } }),
    );
    expect(bien.sms).toEqual({ danh_tinh_gui: "THUMUA", configuration_set: null });
    expect(bien.zalo?.template_deadline).toBe("3");
  });

  it("thiếu khoá, sai kiểu, không phải JSON, có ${ ⇒ DocBienError", () => {
    const anhThieu: Record<string, string> = { ...BIEN.bien.anh };
    delete anhThieu["neo"];
    for (const sai of [
      consoleIn({ ...BIEN, bien: { ...BIEN.bien, anh: anhThieu } }),
      consoleIn({ ...BIEN, bien: { ...BIEN.bien, so_ban_api: "1" } }),
      consoleIn({ ...BIEN, bien: { ...BIEN.bien, ses: { ...BIEN.bien.ses, nhan_canh_bao: "z@thu-mua.vn" } } }),
      "Error: No value for required variable\n",
      '"$${x}"',
    ]) {
      expect(() => giaiMaConsole(sai), sai.slice(0, 60)).toThrow(DocBienError);
    }
  });
});

describe("maLoiAws", () => {
  it("tách tên lỗi từ stderr của CLI", () => {
    expect(maLoiAws("\nAn error occurred (ResourceNotFoundException) when calling the DescribeSecret operation: x\n")).toBe("ResourceNotFoundException");
    expect(maLoiAws("Error when retrieving token from sso: Token has expired")).toBeNull();
  });
});

describe("congAwsCli trên một aws giả", () => {
  const thuMuc = mkdtempSync(join(tmpdir(), "aws-gia-"));
  afterAll(() => rmSync(thuMuc, { recursive: true, force: true }));
  const tep = join(thuMuc, "aws-gia.mjs");
  // Trả lời theo lệnh con; ghi lại argv để kiểm profile/region/output luôn được gắn.
  writeFileSync(
    tep,
    `const a = process.argv.slice(2);
const k = a.slice(0, 2).join(" ");
const thamSo = (t) => a[a.indexOf(t) + 1];
const loi = (ma) => { process.stderr.write("\\nAn error occurred (" + ma + ") when calling X: y\\n"); process.exit(254); };
if (thamSo("--profile") !== "tp-prod" || thamSo("--region") !== "ap-southeast-1" || thamSo("--output") !== "json") loi("SaiThamSo");
if (k === "sts get-caller-identity") console.log(JSON.stringify({ Account: "942091277863" }));
else if (k === "secretsmanager describe-secret") {
  const id = thamSo("--secret-id");
  if (id === "khong-co") loi("ResourceNotFoundException");
  else if (id === "rong") console.log(JSON.stringify({ Name: id }));
  else if (id === "xoa") console.log(JSON.stringify({ Name: id, DeletedDate: "2026-09-01T00:00:00Z", VersionIdsToStages: { v1: ["AWSCURRENT"] } }));
  else if (id === "het-phien") { process.stderr.write("Error when retrieving token from sso: Token has expired\\n"); process.exit(255); }
  else console.log(JSON.stringify({ Name: id, VersionIdsToStages: { v1: ["AWSPREVIOUS"], v2: ["AWSCURRENT"] } }));
} else if (k === "ecr describe-images") {
  if (thamSo("--repository-name") === "tp-khong") loi("RepositoryNotFoundException");
  if (thamSo("--image-ids") !== "imageDigest=sha256:aa") loi("ImageNotFoundException");
  console.log(JSON.stringify({ imageDetails: [{}] }));
} else if (k === "sesv2 get-email-identity") {
  const m = thamSo("--email-identity");
  if (m === "khong.vn") loi("NotFoundException");
  console.log(JSON.stringify({ VerifiedForSendingStatus: m === "ok.vn" }));
} else if (k === "sesv2 get-account") console.log(JSON.stringify({ ProductionAccessEnabled: false }));
else loi("LenhLa");
`,
  );
  const aws = congAwsCli("tp-prod", "ap-southeast-1", [process.execPath, tep]);

  it("tài khoản, secret, image, SES, sandbox", async () => {
    expect(await aws.taiKhoan()).toBe("942091277863");
    expect(await aws.moTaSecret("tp/api/database-url")).toEqual({ coBanHienHanh: true, daXoa: false });
    expect(await aws.moTaSecret("rong")).toEqual({ coBanHienHanh: false, daXoa: false });
    expect(await aws.moTaSecret("xoa")).toEqual({ coBanHienHanh: true, daXoa: true });
    expect(await aws.moTaSecret("khong-co")).toBeNull();
    expect(await aws.coImage("tp-api", "sha256:aa")).toBe(true);
    expect(await aws.coImage("tp-api", "sha256:bb")).toBe(false);
    expect(await aws.coImage("tp-khong", "sha256:aa")).toBe(false);
    expect(await aws.danhTinhSes("ok.vn")).toEqual({ daXacMinh: true });
    expect(await aws.danhTinhSes("cho.vn")).toEqual({ daXacMinh: false });
    expect(await aws.danhTinhSes("khong.vn")).toBeNull();
    expect(await aws.sesDaRaSandbox()).toBe(false);
  });

  it("lỗi không phải 'không tồn tại' (hết phiên SSO) ⇒ ném, không bao giờ coi là thiếu", () => {
    expect(() => aws.moTaSecret("het-phien")).toThrow(TienTrinhError);
  });
});
