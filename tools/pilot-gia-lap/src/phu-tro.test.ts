import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CsdlError, kiemUrlCucBo, urlVaiDangNhap } from "./csdl.js";
import { CONG_MAC_DINH, moiTruongSach, moiTruongTienTrinh, type BiMatCum } from "./cum.js";
import { giaiMaBase32, maTotpHienTai } from "./dien-vien.js";
import { HopThu, docTin, tokenTuLink } from "./hop-thu.js";
import { diaChiGiaLap } from "./http.js";
import { ThamSoError, docThamSo } from "./tham-so.js";

const thuMucTam: string[] = [];
afterEach(async () => {
  for (const d of thuMucTam.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("tham số dòng lệnh", () => {
  it("mặc định là `chay`, đọc cờ và danh sách kịch bản", () => {
    const ts = docThamSo(["--cham", "--chi", "sx-01, XD-02", "--dung-sau"], CONG_MAC_DINH);
    expect(ts).toMatchObject({ lenh: "chay", cham: true, dungSau: true, chi: ["SX-01", "XD-02"] });
    expect(docThamSo(["dang-nhap", "a@b.invalid"], CONG_MAC_DINH).doiSo).toEqual(["a@b.invalid"]);
    expect(docThamSo(["--cong-web", "19090"], CONG_MAC_DINH).cong.web).toBe(19090);
  });

  it("từ chối lệnh lạ, tuỳ chọn lạ, đối số thiếu/thừa và cổng trùng", () => {
    expect(() => docThamSo(["xoa-het"], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["--nhanh-hon"], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["dang-nhap"], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["chay", "thua"], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["--cong-web", String(CONG_MAC_DINH.api)], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["--cong-api", "80"], CONG_MAC_DINH)).toThrow(ThamSoError);
  });
});

describe("CSDL chỉ cục bộ", () => {
  it("nhận localhost/127.0.0.1/::1, từ chối máy khác", () => {
    expect(kiemUrlCucBo("postgres://u:p@127.0.0.1:5432/db").hostname).toBe("127.0.0.1");
    expect(kiemUrlCucBo("postgresql://u:p@localhost/db").hostname).toBe("localhost");
    expect(kiemUrlCucBo("postgres://u:p@[::1]:5432/db").hostname).toBe("[::1]");
    for (const url of ["postgres://u:p@db.noi-bo:5432/db", "postgres://u:p@10.0.0.5/db", "mysql://u:p@127.0.0.1/db", "postgres://u:p@127.0.0.1:5432/", "khong-phai-url"]) {
      expect(() => kiemUrlCucBo(url), url).toThrow(CsdlError);
    }
  });

  it("URL vai đăng nhập giữ máy chủ và CSDL, thay tên và mật khẩu", () => {
    const u = new URL(urlVaiDangNhap("postgres://postgres:x@127.0.0.1:55433/pilot", "app_api_login", "abc_DEF-123456789012345678"));
    expect([u.username, u.password, u.hostname, u.port, u.pathname]).toEqual(["app_api_login", "abc_DEF-123456789012345678", "127.0.0.1", "55433", "/pilot"]);
  });
});

describe("môi trường tiến trình của cụm", () => {
  const biMat: BiMatCum = {
    phienBan: 1,
    matKhauApi: "a".repeat(43),
    matKhauWorker: "b".repeat(43),
    masterKey: Buffer.alloc(32, 1).toString("base64"),
    totpMasterKey: Buffer.alloc(32, 2).toString("base64"),
    otpPepper: Buffer.alloc(32, 3).toString("base64"),
    receiptKid: "k1",
    receiptPkcs8: "UEtDUzg=",
    receiptSpki: "U1BLSQ==",
  };
  const ts = { thuMuc: "/tmp/pgl", cong: CONG_MAC_DINH, biMat, urlApi: "postgres://app_api_login:a@127.0.0.1/db", urlWorker: "postgres://app_unseal_login:b@127.0.0.1/db" };

  it("api: khoá local-dev, hộp thư dev, proxy tin cậy CHỈ 127.0.0.1, origin là web", () => {
    const e = moiTruongTienTrinh("api", ts);
    expect(e.NODE_ENV).toBe("development");
    expect(e.TRUSTPROCURE_KEY_ADAPTER).toBe("local-dev");
    expect(e.TRUSTPROCURE_SENDER_ADAPTER).toBe("dev-mailbox");
    expect(e.TRUSTPROCURE_TRUSTED_PROXIES).toBe("127.0.0.1");
    expect(e.TRUSTPROCURE_LISTEN_HOST).toBe("127.0.0.1");
    expect(e.TRUSTPROCURE_ALLOWED_ORIGINS).toBe(`http://127.0.0.1:${CONG_MAC_DINH.web}`);
    expect(new Set([e.TRUSTPROCURE_MASTER_KEYS, e.TRUSTPROCURE_TOTP_MASTER_KEYS, e.TRUSTPROCURE_OTP_PEPPERS]).size).toBe(3);
  });

  it("worker dùng CÙNG vòng khoá bọc với api và vai đăng nhập riêng", () => {
    const api = moiTruongTienTrinh("api", ts);
    const w = moiTruongTienTrinh("unseal-worker", ts);
    expect(w.TRUSTPROCURE_MASTER_KEYS).toBe(api.TRUSTPROCURE_MASTER_KEYS);
    expect(w.TRUSTPROCURE_DATABASE_URL).toContain("app_unseal_login");
    expect(w.TRUSTPROCURE_OTP_PEPPERS).toBeUndefined();
  });

  it("tiến trình công bố khoá chỉ nhận nửa CÔNG KHAI", () => {
    const k = moiTruongTienTrinh("public-keys", ts);
    expect(k.TRUSTPROCURE_RECEIPT_PUBLIC_KEYS).toBe(JSON.stringify({ k1: "U1BLSQ==" }));
    expect(JSON.stringify(k)).not.toContain(biMat.receiptPkcs8);
  });

  it("môi trường nền bỏ mọi biến của dự án — URL đặc quyền không đi xuống tiến trình con", () => {
    const sach = moiTruongSach({ PATH: "/bin", TRUSTPROCURE_SEED_DATABASE_URL: "postgres://postgres@127.0.0.1/x", DATABASE_URL: "x", NODE_ENV: "production" });
    expect(sach).toEqual({ PATH: "/bin" });
  });
});

describe("hộp thư dev", () => {
  it("đọc đúng năm hình dạng tin, bỏ mọi thứ khác", () => {
    expect(docTin({ loai: "OTP", kenh: "SMS", den: "0912", ma: "123456", luc: "x" })).toMatchObject({ loai: "OTP", ma: "123456" });
    expect(docTin({ loai: "LOGIN_LINK", orgId: "o", den: "a@b", duongLink: "http://x/login#t" })?.loai).toBe("LOGIN_LINK");
    expect(docTin({ loai: "OTP", den: "0912" })).toBeNull();
    expect(docTin({ loai: "LA", den: "x" })).toBeNull();
    expect(docTin(null)).toBeNull();
    expect(tokenTuLink("http://127.0.0.1:18090/i#abcdefghijklmnopQRST_-12")).toBe("abcdefghijklmnopQRST_-12");
    expect(() => tokenTuLink("http://127.0.0.1/i")).toThrow();
  });

  it("tin CŨ lúc mở không bao giờ được nhận; một tin chỉ được nhận một lần", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pgl-hop-thu-"));
    thuMucTam.push(dir);
    await writeFile(join(dir, "0001-cu.json"), JSON.stringify({ loai: "OTP", kenh: "SMS", den: "0900", ma: "111111" }));
    const h = await HopThu.mo(dir);
    await writeFile(join(dir, "0002-moi.json"), JSON.stringify({ loai: "OTP", kenh: "SMS", den: "0900", ma: "222222" }));
    const t = await h.cho("otp", (x) => x.loai === "OTP" && x.den === "0900", 2000);
    expect(t.loai === "OTP" ? t.ma : "").toBe("222222");
    await expect(h.cho("otp lần hai", (x) => x.loai === "OTP" && x.den === "0900", 300)).rejects.toThrow(/chưa có otp lần hai/u);
    expect((await h.otpMoiNhat("0900"))?.ma).toBe("222222");
  });
});

describe("địa chỉ và TOTP", () => {
  it("mỗi diễn viên một /64 trong dải tài liệu 2001:db8::/32", () => {
    expect(diaChiGiaLap(0xabc, 1)).toBe("2001:db8:abc:1::1");
    expect(diaChiGiaLap(1, 2)).not.toBe(diaChiGiaLap(1, 3));
    expect(() => diaChiGiaLap(0x10000, 1)).toThrow(RangeError);
  });

  it("base32 và mã TOTP khớp vectơ RFC 6238 (SHA-1, T = 59 s ⇒ 287082)", () => {
    const biMat = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
    expect(giaiMaBase32(biMat).toString("ascii")).toBe("12345678901234567890");
    expect(maTotpHienTai(biMat, 59_000).ma).toBe("287082");
    expect(maTotpHienTai(biMat, 59_000).conGiay).toBe(1);
  });
});
