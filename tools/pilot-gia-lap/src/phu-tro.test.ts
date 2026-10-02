import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CsdlError, kiemUrlCucBo, urlVaiDangNhap } from "./csdl.js";
import { CONG_MAC_DINH, CumError, canhBaoAclWindows, kiemThuMucTrangThai, moiTruongSach, moiTruongTienTrinh, type BiMatCum } from "./cum.js";
import { giaiMaBase32, maTotpHienTai } from "./dien-vien.js";
import { HopThu, docTin, tokenTuLink } from "./hop-thu.js";
import { diaChiGiaLap } from "./http.js";
import { chonKichBan, kiemPhienBanNode } from "./index.js";
import { ThamSoError, docThamSo } from "./tham-so.js";
import { gopTrangThai, luotMoiNhat, type ToChucTrangThai } from "./trang-thai.js";

const thuMucTam: string[] = [];
afterEach(async () => {
  for (const d of thuMucTam.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("tham số dòng lệnh", () => {
  it("mặc định là `chay`, đọc cờ và danh sách kịch bản", () => {
    const ts = docThamSo(["--cham", "--chi", "sx-01, XD-02", "--dung-sau"], CONG_MAC_DINH);
    expect(ts).toMatchObject({ lenh: "chay", cham: true, dungSau: true, chi: ["SX-01", "XD-02"] });
    expect(docThamSo(["dang-nhap", "a@b.invalid"], CONG_MAC_DINH).doiSo).toEqual(["a@b.invalid"]);
    expect(docThamSo(["dang-nhap", "a@b.invalid", "org-cu"], CONG_MAC_DINH).doiSo).toEqual(["a@b.invalid", "org-cu"]);
    expect(docThamSo(["--cong-web", "19090"], CONG_MAC_DINH).cong.web).toBe(19090);
    // Shim pnpm.ps1 chuyển `--chi SX-01,XD-02` không nháy xuống node thành "SX-01 XD-02".
    expect(docThamSo(["--chi", "SX-01 XD-02"], CONG_MAC_DINH).chi).toEqual(["SX-01", "XD-02"]);
  });

  it("từ chối lệnh lạ, tuỳ chọn lạ, đối số thiếu/thừa và cổng trùng", () => {
    expect(() => docThamSo(["xoa-het"], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["--nhanh-hon"], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["dang-nhap"], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["dang-nhap", "a@b.invalid", "o", "thua"], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["otp", "0900", "thua"], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["chay", "thua"], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["--cong-web", String(CONG_MAC_DINH.api)], CONG_MAC_DINH)).toThrow(ThamSoError);
    expect(() => docThamSo(["--cong-api", "80"], CONG_MAC_DINH)).toThrow(ThamSoError);
  });
});

describe("chọn kịch bản", () => {
  it("gọi tên kịch bản chậm mà thiếu --cham là lỗi, không phải một lượt rỗng ĐẠT", () => {
    expect(() => chonKichBan({ chi: ["SX-06"], cham: false })).toThrow(/chỉ chạy khi có --cham/u);
    expect(chonKichBan({ chi: ["SX-06"], cham: true }).chon.map((k) => k.ma)).toEqual(["SX-06"]);
    expect(chonKichBan({ chi: [], cham: false }).boQua).toEqual(["SX-06"]);
    expect(() => chonKichBan({ chi: ["SX-99"], cham: false })).toThrow(/không có kịch bản/u);
  });
});

describe("phiên bản Node", () => {
  it("chỉ nhận các bản đã đo chạy được cụm, và từ chối bằng một câu nói rõ thay vì để web chết giữa chừng", () => {
    for (const hong of ["20.18.0", "22.6.0", "22.12.0", "23.0.0", "23.1.0", "26.0.0", "v22.13.0", ""]) {
      expect(() => kiemPhienBanNode(hong)).toThrow(/cần Node 22 từ 22\.13/u);
    }
    for (const duoc of ["22.13.0", "22.22.2", "23.2.0", "24.21.0", "25.9.0"]) expect(() => kiemPhienBanNode(duoc)).not.toThrow();
  });
});

describe("trạng thái trình diễn", () => {
  const tc = (orgId: string, ma: string): ToChucTrangThai => ({ ma, ten: ma, orgId, nguoi: [], loiMoiConLai: [], goiDeLai: [] });

  it("lượt mới đứng đầu, tổ chức của các lượt cũ được GIỮ — bí mật TOTP của họ chỉ nằm ở đây", () => {
    const cu = { phienBan: 1 as const, taoLuc: "a", toChuc: [tc("o-sx-1", "SX"), tc("o-xd-1", "XD")] };
    expect(gopTrangThai(cu, [tc("o-sx-2", "SX")], "b").toChuc.map((t) => t.orgId)).toEqual(["o-sx-2", "o-sx-1", "o-xd-1"]);
    expect(gopTrangThai(cu, [tc("o-xd-1", "XD")], "c").toChuc.map((t) => t.orgId)).toEqual(["o-xd-1", "o-sx-1"]);
    expect(gopTrangThai(null, [tc("o", "SX")], "d")).toEqual({ phienBan: 1, taoLuc: "d", toChuc: [tc("o", "SX")] });
  });

  it("lượt mới nhất = các tổ chức đầu tệp cùng `luot`; tệp của bản đầu (không `luot`) chỉ lấy tổ chức đầu", () => {
    const l = (orgId: string, luot?: string): ToChucTrangThai => ({ ...tc(orgId, "SX"), ...(luot === undefined ? {} : { luot }) });
    const tt = gopTrangThai({ phienBan: 1, taoLuc: "a", toChuc: [l("cu-1", "L1"), l("cu-2", "L1")] }, [l("moi-1", "L2"), l("moi-2", "L2")], "b");
    expect(luotMoiNhat(tt).map((t) => t.orgId)).toEqual(["moi-1", "moi-2"]);
    expect(luotMoiNhat({ phienBan: 1, taoLuc: "c", toChuc: [l("x"), l("y")] }).map((t) => t.orgId)).toEqual(["x"]);
    expect(luotMoiNhat({ phienBan: 1, taoLuc: "d", toChuc: [] })).toEqual([]);
  });

  it("thư mục trạng thái trong kho chỉ được nằm dưới `.pilot-gia-lap`; ngoài kho thì mọi chỗ", () => {
    for (const ok of ["/kho/.pilot-gia-lap", "/kho/.pilot-gia-lap/lan-2", "/kho/tools/.pilot-gia-lap", "/tmp/pgl", "/"]) {
      expect(() => kiemThuMucTrangThai("/kho", ok), ok).not.toThrow();
    }
    for (const sai of ["/kho", "/kho/demo", "/kho/..la", "/kho/tools/pilot-gia-lap"]) {
      expect(() => kiemThuMucTrangThai("/kho", sai), sai).toThrow(CumError);
    }
  });

  // [S1.255 / khoản 328] Đo trên Windows thật: kho trên `D:\`, gốc ổ cho `Authenticated Users` quyền sửa và `Users` quyền đọc, máy có
  // hai tài khoản — thư mục trạng thái thừa hưởng ACL ấy (`mode: 0o700` bị Windows bỏ qua), và công cụ không nói gì. Kế hoạch §4
  // đã khuyên đặt kho dưới hồ sơ người dùng; nay công cụ nói ra khi dựng cụm ngoài hồ sơ ấy.
  it("[khoản 328] Windows: thư mục trạng thái NGOÀI hồ sơ người dùng ⇒ câu cảnh báo nêu thư mục, `icacls`, `--thu-muc`; trong hồ sơ ⇒ không", () => {
    const hoSo = String.raw`C:\Users\nguye`;
    const ngoaiHoSo = String.raw`D:\Claude\TrustProcure\.pilot-gia-lap`;
    const cb = canhBaoAclWindows("win32", ngoaiHoSo, hoSo);
    expect(cb).not.toBeNull();
    expect(cb).toContain(ngoaiHoSo);
    expect(cb).toContain("icacls");
    expect(cb).toContain("--thu-muc");
    expect(cb).toContain("cum.json");
    for (const trong of [String.raw`C:\Users\nguye\.pilot-gia-lap`, String.raw`C:\Users\nguye\code\kho\.pilot-gia-lap`, String.raw`c:\users\NGUYE\x`, hoSo]) {
      expect(canhBaoAclWindows("win32", trong, hoSo), trong).toBeNull();
    }
    // Bẫy tiền tố: `C:\Users\nguye2` KHÔNG nằm dưới `C:\Users\nguye`; thư mục cha, ổ khác, hay `..` thoát ra cũng vậy.
    for (const ngoai of [String.raw`C:\Users\nguye2\.pilot-gia-lap`, String.raw`C:\Users`, String.raw`E:\Users\nguye\x`, String.raw`C:\Users\nguye\..\rdp\x`]) {
      expect(canhBaoAclWindows("win32", ngoai, hoSo), ngoai).not.toBeNull();
    }
    // POSIX: bit 0700 có tác dụng (`docBiMat` chmod) — không cảnh báo, dù thư mục ở đâu.
    expect(canhBaoAclWindows("linux", "/srv/kho/.pilot-gia-lap", "/home/u")).toBeNull();
    expect(canhBaoAclWindows("darwin", "/Volumes/x/.pilot-gia-lap", "/Users/u")).toBeNull();
  });

  it("[khoản 328] lúc dựng cụm (`chuanBiCum` — lệnh chạy và `cum`) cảnh báo đi ra stderr, với thư mục trạng thái và hồ sơ của MÁY", () => {
    const ma = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const dau = ma.indexOf("async function chuanBiCum(");
    expect(dau, "đối chứng: còn hàm chuanBiCum").toBeGreaterThan(0);
    const than = ma.slice(dau, ma.indexOf("\n}\n", dau));
    expect(than).toMatch(/const canhBao = canhBaoAclWindows\(process\.platform, thuMuc, homedir\(\)\);\s*if \(canhBao !== null\) bao\(canhBao\);/u);
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

  it("từ chối mọi tham số truy vấn — pg để `?host=`/`?port=`/`?user=` ghi đè phần máy chủ và vai của URL", () => {
    for (const url of [
      "postgres://u:p@127.0.0.1:5432/db?host=10.0.0.5",
      "postgres://u:p@localhost/db?host=/cloudsql/du-an:vung:may",
      "postgres://u:p@127.0.0.1/db?port=6543",
      "postgres://u:p@127.0.0.1/db?user=postgres&password=x",
      "postgres://u:p@127.0.0.1/db?sslmode=disable",
    ]) {
      expect(() => kiemUrlCucBo(url), url).toThrow(CsdlError);
      expect(() => urlVaiDangNhap(url, "app_api_login", "m".repeat(30)), url).toThrow(CsdlError);
    }
  });

  it("URL vai đăng nhập giữ máy chủ và CSDL, thay tên và mật khẩu", () => {
    const u = new URL(urlVaiDangNhap("postgres://postgres:x@127.0.0.1:55433/pilot", "app_api_login", "m".repeat(30), "6543"));
    expect([u.username, u.password, u.hostname, u.port, u.pathname]).toEqual(["app_api_login", "m".repeat(30), "127.0.0.1", "55433", "/pilot"]);
  });

  it("URL không ghi cổng: tiến trình con nhận ĐÚNG cổng mà pg của kết nối đặc quyền dùng — PGPORT, rồi 5432", () => {
    // Tiến trình con không nhận PGPORT (moiTruongSach bỏ mọi PG*), nên cổng phải nằm trong URL của nó.
    expect(new URL(urlVaiDangNhap("postgres://postgres@localhost/pilot", "app_api_login", "m".repeat(30), "55433")).port).toBe("55433");
    expect(new URL(urlVaiDangNhap("postgres://postgres@localhost/pilot", "app_api_login", "m".repeat(30), undefined)).port).toBe("5432");
    expect(new URL(urlVaiDangNhap("postgres://postgres@localhost/pilot", "app_api_login", "m".repeat(30), " ")).port).toBe("5432");
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

  it("môi trường nền bỏ mọi biến của dự án và của libpq — URL đặc quyền, PGPASSWORD không đi xuống tiến trình con", () => {
    const sach = moiTruongSach({
      PATH: "/bin",
      TRUSTPROCURE_SEED_DATABASE_URL: "postgres://postgres@127.0.0.1/x",
      DATABASE_URL: "x",
      NODE_ENV: "production",
      PGPASSWORD: "x",
      PGOPTIONS: "-c search_path=x",
      PGUSER: "postgres",
    });
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
    // [ADR-107] Link mang `<orgId>:<token>`; tổ chức trong link phải là tổ chức của tin.
    expect(tokenTuLink("http://127.0.0.1:18090/i#org-1:abcdefghijklmnopQRST_-12", "org-1")).toBe("abcdefghijklmnopQRST_-12");
    expect(() => tokenTuLink("http://127.0.0.1:18090/i#org-2:abcdefghijklmnopQRST_-12", "org-1")).toThrow(/tổ chức/u);
    expect(() => tokenTuLink("http://127.0.0.1:18090/i#abcdefghijklmnopQRST_-12", "org-1")).toThrow(/tổ chức/u);
    expect(() => tokenTuLink("http://127.0.0.1:18090/i#org-1:ngan", "org-1")).toThrow(/hình dạng/u);
    expect(() => tokenTuLink("http://127.0.0.1/i", "org-1")).toThrow();
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

  it("một lần ĐỌC hỏng không bị nhớ như tin hỏng — lượt quét sau đọc lại tệp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pgl-hop-thu-"));
    thuMucTam.push(dir);
    const h = await HopThu.mo(dir);
    const tep = join(dir, "0001-moi.json");
    await mkdir(tep); // readFile → EISDIR: đứng thay cho khoá chia sẻ tạm của trình quét virus
    expect(await h.xem(() => true)).toEqual([]);
    await rmdir(tep);
    await writeFile(tep, JSON.stringify({ loai: "OTP", kenh: "SMS", den: "0900", ma: "333333" }));
    expect(await h.xem((x) => x.loai === "OTP")).toHaveLength(1);
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
