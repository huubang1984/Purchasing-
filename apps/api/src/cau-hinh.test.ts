// [S1.11 / ADR-021] Cấu hình fail-closed: thiếu là ném, sai là ném, trùng là ném — và thông điệp
// không bao giờ mang giá trị của một bí mật.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CauHinhError, docCauHinh, type MoiTruong } from "./cau-hinh.js";

function khoaKyPkcs8(): string {
  return generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
}

const BI_MAT = {
  master: randomBytes(32).toString("base64"),
  master2: randomBytes(32).toString("base64"),
  totp: randomBytes(32).toString("base64"),
  pepper: randomBytes(32).toString("base64"),
  ky: khoaKyPkcs8(),
};

function envHopLe(ghiDe: Record<string, string | undefined> = {}): MoiTruong {
  return {
    TRUSTPROCURE_DATABASE_URL: "postgres://app_api_login:mk@127.0.0.1:5432/trustprocure",
    TRUSTPROCURE_PUBLIC_BASE_URL: "https://mua.vidu.vn",
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    TRUSTPROCURE_MASTER_KEYS: `v1=${BI_MAT.master},v2=${BI_MAT.master2}`,
    TRUSTPROCURE_MASTER_KEY_ACTIVE: "v2",
    TRUSTPROCURE_TOTP_MASTER_KEYS: `t1=${BI_MAT.totp}`,
    TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE: "t1",
    TRUSTPROCURE_OTP_PEPPERS: `p1=${BI_MAT.pepper}`,
    TRUSTPROCURE_OTP_PEPPER_ACTIVE: "p1",
    TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `ky-2026=${BI_MAT.ky}`,
    TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "ky-2026",
    TRUSTPROCURE_SENDER_ADAPTER: "dev-mailbox",
    TRUSTPROCURE_DEV_MAILBOX_DIR: join(tmpdir(), "hop-thu-dev"),
    ...ghiDe,
  };
}

/** Ném `CauHinhError`, thông điệp nêu tên biến, và KHÔNG chứa một bí mật nào của fixture. */
function nemVeBien(env: MoiTruong, ten: string, them?: RegExp): void {
  let loi: unknown;
  try {
    docCauHinh(env);
  } catch (e) {
    loi = e;
  }
  expect(loi).toBeInstanceOf(CauHinhError);
  const msg = (loi as Error).message;
  expect(msg).toContain(ten);
  if (them !== undefined) expect(msg).toMatch(them);
  for (const gt of Object.values(BI_MAT)) expect(msg).not.toContain(gt.slice(0, 12));
}

describe("[S1.11] docCauHinh — bộ cấu hình hợp lệ", () => {
  it("đọc đủ, dẫn nửa công khai của khoá ký, mặc định cho host/port/pool", () => {
    const ch = docCauHinh(envHopLe());
    expect(ch.listenHost).toBe("127.0.0.1");
    expect(ch.listenPort).toBe(8080);
    expect(ch.dbPoolMax).toBe(10);
    expect(ch.allowedOrigins).toEqual([]);
    expect(ch.trustedProxies).toEqual([]);
    expect(ch.afterCommitTimeoutMs).toBeUndefined();
    expect(ch.masterKeys.active).toBe("v2");
    expect(Object.keys(ch.masterKeys.keys).sort()).toEqual(["v1", "v2"]);
    expect(ch.masterKeys.keys["v1"]).toHaveLength(32);
    expect(ch.receiptSigningKeys.keys["ky-2026"]?.publicKey.length).toBeGreaterThan(60);
    expect(ch.receiptSigningKeys.keys["ky-2026"]?.privateKey.length).toBeGreaterThan(100);
    expect(ch.publicBaseUrl).toBe("https://mua.vidu.vn");
  });

  it("đọc tuỳ chọn: origin, cổng, pool, trần sau commit; http chỉ cho localhost", () => {
    const ch = docCauHinh(
      envHopLe({
        TRUSTPROCURE_ALLOWED_ORIGINS: "https://app.vidu.vn, https://app.vidu.vn:8443",
        TRUSTPROCURE_LISTEN_PORT: "0",
        TRUSTPROCURE_DB_POOL_MAX: "3",
        TRUSTPROCURE_AFTER_COMMIT_TIMEOUT_MS: "250",
        TRUSTPROCURE_PUBLIC_BASE_URL: "http://localhost:3000/",
      }),
    );
    expect(ch.allowedOrigins).toEqual(["https://app.vidu.vn", "https://app.vidu.vn:8443"]);
    expect(ch.listenPort).toBe(0);
    expect(ch.dbPoolMax).toBe(3);
    expect(ch.afterCommitTimeoutMs).toBe(250);
    expect(ch.publicBaseUrl).toBe("http://localhost:3000");
  });
});

describe("[S1.11] docCauHinh — fail-closed, thông điệp chỉ nêu TÊN biến", () => {
  it.each([
    "TRUSTPROCURE_DATABASE_URL",
    "TRUSTPROCURE_PUBLIC_BASE_URL",
    "TRUSTPROCURE_KEY_ADAPTER",
    "TRUSTPROCURE_MASTER_KEYS",
    "TRUSTPROCURE_MASTER_KEY_ACTIVE",
    "TRUSTPROCURE_TOTP_MASTER_KEYS",
    "TRUSTPROCURE_TOTP_MASTER_KEY_ACTIVE",
    "TRUSTPROCURE_OTP_PEPPERS",
    "TRUSTPROCURE_OTP_PEPPER_ACTIVE",
    "TRUSTPROCURE_RECEIPT_SIGNING_KEYS",
    "TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE",
    "TRUSTPROCURE_SENDER_ADAPTER",
    "TRUSTPROCURE_DEV_MAILBOX_DIR",
  ])("thiếu %s ⇒ ném, nêu đúng tên; chuỗi rỗng cũng là thiếu", (ten) => {
    nemVeBien(envHopLe({ [ten]: undefined }), ten);
    nemVeBien(envHopLe({ [ten]: "   " }), ten);
  });

  it("adapter chưa có trong kho (kms, ses) ⇒ ném NÓI RÕ là chưa có, không rơi về bản dev", () => {
    nemVeBien(envHopLe({ TRUSTPROCURE_KEY_ADAPTER: "kms" }), "TRUSTPROCURE_KEY_ADAPTER", /CHƯA CÓ/u);
    nemVeBien(envHopLe({ TRUSTPROCURE_SENDER_ADAPTER: "ses" }), "TRUSTPROCURE_SENDER_ADAPTER", /CHƯA CÓ/u);
    // Không nới theo hoa/thường: "Local-Dev" là một chuỗi khác.
    nemVeBien(envHopLe({ TRUSTPROCURE_KEY_ADAPTER: "Local-Dev" }), "TRUSTPROCURE_KEY_ADAPTER");
  });

  it("khoá 32 byte: sai độ dài, không phải base64, thiếu dấu =, trùng phiên bản, active không có trong vòng", () => {
    nemVeBien(envHopLe({ TRUSTPROCURE_MASTER_KEYS: `v1=${randomBytes(16).toString("base64")}` }), "TRUSTPROCURE_MASTER_KEYS", /32 byte/u);
    nemVeBien(envHopLe({ TRUSTPROCURE_OTP_PEPPERS: "p1=khong-phai-base64!!" }), "TRUSTPROCURE_OTP_PEPPERS", /base64/u);
    // Không có dấu `=` nào (base64 30 byte không đệm) ⇒ thiếu tên phiên bản; có đệm `==` thì phần trước
    // dấu `=` đầu tiên bị đọc thành tên phiên bản và rơi vào "tên phiên bản không hợp lệ" — cả hai đều ném.
    nemVeBien(envHopLe({ TRUSTPROCURE_OTP_PEPPERS: randomBytes(30).toString("base64") }), "TRUSTPROCURE_OTP_PEPPERS", /<phiên bản>=<base64>/u);
    nemVeBien(envHopLe({ TRUSTPROCURE_OTP_PEPPERS: BI_MAT.pepper }), "TRUSTPROCURE_OTP_PEPPERS");
    nemVeBien(envHopLe({ TRUSTPROCURE_MASTER_KEYS: `v1=${BI_MAT.master},v1=${BI_MAT.master2}` }), "TRUSTPROCURE_MASTER_KEYS", /hai lần/u);
    nemVeBien(envHopLe({ TRUSTPROCURE_MASTER_KEY_ACTIVE: "v9" }), "TRUSTPROCURE_MASTER_KEY_ACTIVE");
    nemVeBien(envHopLe({ TRUSTPROCURE_MASTER_KEYS: `v 1=${BI_MAT.master}` }), "TRUSTPROCURE_MASTER_KEYS", /tên phiên bản/u);
  });

  it("ba vòng bí mật phải ĐÔI MỘT khác nhau — dán cùng một base64 vào hai biến là ném, nêu cả hai tên", () => {
    nemVeBien(envHopLe({ TRUSTPROCURE_TOTP_MASTER_KEYS: `t1=${BI_MAT.master}` }), "TRUSTPROCURE_TOTP_MASTER_KEYS", /TRUSTPROCURE_MASTER_KEYS/u);
    nemVeBien(envHopLe({ TRUSTPROCURE_OTP_PEPPERS: `p1=${BI_MAT.totp}` }), "TRUSTPROCURE_OTP_PEPPERS", /TRUSTPROCURE_TOTP_MASTER_KEYS/u);
    // Trùng NGAY TRONG một vòng cũng là trùng.
    nemVeBien(envHopLe({ TRUSTPROCURE_MASTER_KEYS: `v1=${BI_MAT.master},v2=${BI_MAT.master}` }), "TRUSTPROCURE_MASTER_KEYS", /CÙNG một giá trị/u);
  });

  it("khoá ký: không phải PKCS8, hoặc không phải P-256 ⇒ ném", () => {
    const ky = (der: string) => envHopLe({ TRUSTPROCURE_RECEIPT_SIGNING_KEYS: `k=${der}`, TRUSTPROCURE_RECEIPT_SIGNING_ACTIVE: "k" });
    nemVeBien(ky(randomBytes(40).toString("base64")), "TRUSTPROCURE_RECEIPT_SIGNING_KEYS", /PKCS8/u);
    const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    nemVeBien(ky(p384), "TRUSTPROCURE_RECEIPT_SIGNING_KEYS", /P-256/u);
    const ed = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    nemVeBien(ky(ed), "TRUSTPROCURE_RECEIPT_SIGNING_KEYS", /P-256/u);
  });

  it("URL công khai: http ngoài localhost, có đường dẫn/query/fragment/thông tin đăng nhập, không phải URL ⇒ ném", () => {
    for (const xau of ["http://mua.vidu.vn", "https://mua.vidu.vn/app", "https://mua.vidu.vn/?a=1", "https://mua.vidu.vn/#x", "https://u:p@mua.vidu.vn", "mua.vidu.vn", "ftp://mua.vidu.vn"]) {
      nemVeBien(envHopLe({ TRUSTPROCURE_PUBLIC_BASE_URL: xau }), "TRUSTPROCURE_PUBLIC_BASE_URL");
    }
  });

  it("origin được phép: phải là origin thuần", () => {
    for (const xau of ["https://app.vidu.vn/", "app.vidu.vn", "https://app.vidu.vn/duong", "https://u@app.vidu.vn"]) {
      nemVeBien(envHopLe({ TRUSTPROCURE_ALLOWED_ORIGINS: xau }), "TRUSTPROCURE_ALLOWED_ORIGINS");
    }
  });

  it("[review H3-1] URL CSDL phải đăng nhập bằng app_api_login — superuser hay tên khác ⇒ ném; [H3-3] hộp thư dev phải là đường dẫn tuyệt đối", () => {
    for (const xau of ["postgres://postgres:mk@127.0.0.1:5432/db", "postgres://app_unseal_login:mk@127.0.0.1:5432/db", "postgres://127.0.0.1:5432/db", "khong-phai-uri"]) {
      nemVeBien(envHopLe({ TRUSTPROCURE_DATABASE_URL: xau }), "TRUSTPROCURE_DATABASE_URL");
    }
    for (const xau of ["./hop-thu-dev", "hop-thu-dev", "../ngoai"]) {
      nemVeBien(envHopLe({ TRUSTPROCURE_DEV_MAILBOX_DIR: xau }), "TRUSTPROCURE_DEV_MAILBOX_DIR", /TUYỆT ĐỐI/u);
    }
  });

  it("[sổ nợ 41] proxy tin cậy: danh sách CIDR được đọc; mục sai IP/tiền tố ⇒ ném nêu tên biến", () => {
    expect(docCauHinh(envHopLe({ TRUSTPROCURE_TRUSTED_PROXIES: " 10.0.0.0/8, fd00::/8 ,127.0.0.1 " })).trustedProxies).toEqual(["10.0.0.0/8", "fd00::/8", "127.0.0.1"]);
    nemVeBien(envHopLe({ TRUSTPROCURE_TRUSTED_PROXIES: "proxy.noi.bo" }), "TRUSTPROCURE_TRUSTED_PROXIES", /không phải địa chỉ IP/u);
    nemVeBien(envHopLe({ TRUSTPROCURE_TRUSTED_PROXIES: "10.0.0.0/40" }), "TRUSTPROCURE_TRUSTED_PROXIES", /tiền tố/u);
  });

  it("số: không phải số, ngoài khoảng ⇒ ném", () => {
    nemVeBien(envHopLe({ TRUSTPROCURE_LISTEN_PORT: "tám" }), "TRUSTPROCURE_LISTEN_PORT");
    nemVeBien(envHopLe({ TRUSTPROCURE_LISTEN_PORT: "70000" }), "TRUSTPROCURE_LISTEN_PORT");
    nemVeBien(envHopLe({ TRUSTPROCURE_DB_POOL_MAX: "0" }), "TRUSTPROCURE_DB_POOL_MAX");
    nemVeBien(envHopLe({ TRUSTPROCURE_AFTER_COMMIT_TIMEOUT_MS: "5" }), "TRUSTPROCURE_AFTER_COMMIT_TIMEOUT_MS");
  });
});
