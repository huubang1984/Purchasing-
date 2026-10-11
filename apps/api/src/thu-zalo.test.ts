// [ADR-069] Công cụ gửi thử Zalo ZNS — đo trên fetch GIẢ và kho GIẢ: đọc tham số, giá trị thử cùng hình dạng sản
// phẩm gửi, mã thoát cho từng loại hỏng, và đầu ra không mang số điện thoại đầy đủ, token hay secret. Không gọi Zalo.
import { describe, expect, it } from "vitest";
import type { KhoTokenZalo, TokenZalo } from "./adapters/gui-zalo.js";
import { URL_GUI_ZNS, URL_TOKEN_ZALO } from "./adapters/gui-zalo.js";
import { ThamSoSaiError, chayThuZalo, cheSo, docThamSoThuZalo, giaTriThu } from "./thu-zalo.js";

const BAY_GIO = 1_800_000_000_000;
const SO_TRONG_NUOC = "0901234567";
const SO_E164 = "+84901234567";

class KhoGia implements KhoTokenZalo {
  soLanGhi = 0;
  loiDoc: Error | undefined;
  loiGhi: Error | undefined;
  constructor(public tk: TokenZalo) {}
  doc(): Promise<TokenZalo> {
    return this.loiDoc === undefined ? Promise.resolve(this.tk) : Promise.reject(this.loiDoc);
  }
  ghi(t: TokenZalo): Promise<void> {
    if (this.loiGhi !== undefined) return Promise.reject(this.loiGhi);
    this.soLanGhi += 1;
    this.tk = t;
    return Promise.resolve();
  }
}

const tokenMoiNap = (): TokenZalo => ({ appId: "123", secretKey: "bi-mat-app", accessToken: "", refreshToken: "rt-1", hetHanLuc: 0 });

function fetchGia(phanHoiZns: Record<string, unknown>, ghiLai: { url: string; body: string }[] = []): typeof fetch {
  return ((url: string, init: RequestInit) => {
    ghiLai.push({ url, body: typeof init.body === "string" ? init.body : "" });
    const than = url === URL_TOKEN_ZALO ? { access_token: "at-moi", refresh_token: "rt-2", expires_in: 90_000 } : phanHoiZns;
    return Promise.resolve(new Response(JSON.stringify(than), { status: 200 }));
  }) as typeof fetch;
}

async function chay(argv: string[], kho: KhoGia, f: typeof fetch): Promise<{ ma: number; ra: string }> {
  const dong: string[] = [];
  const ma = await chayThuZalo(docThamSoThuZalo(argv), { kho, in: (x) => dong.push(x), fetch: f, bayGio: () => BAY_GIO });
  return { ma, ra: dong.join("\n") };
}

describe("[ADR-069] thu-zalo: đọc tham số", () => {
  it("--chi-doc-secret đứng một mình là đủ; mặc định secret, region, tên miền của prod", () => {
    expect(docThamSoThuZalo(["--chi-doc-secret"])).toMatchObject({
      chiDocSecret: true,
      secret: "tp/api/zalo-oa",
      region: "ap-southeast-1",
      tenMien: "trustprocure.jinji.vn",
    });
  });

  it.each([
    [["--loai", "otp", "--so", SO_TRONG_NUOC], "thiếu --template"],
    [["--loai", "sms", "--so", SO_TRONG_NUOC, "--template", "1"], "loại lạ"],
    [["--loai", "otp", "--so", SO_TRONG_NUOC, "--template", "abc"], "template không phải số"],
    [["--loai", "otp", "--bay"], "tham số lạ"],
    [["--loai"], "thiếu giá trị"],
  ])("%j ⇒ ThamSoSaiError (%s)", (argv) => {
    expect(() => docThamSoThuZalo(argv)).toThrow(ThamSoSaiError);
  });
});

describe("[ADR-069] thu-zalo: giá trị thử cùng hình dạng sản phẩm gửi", () => {
  it("otp là sáu chữ số", () => {
    const { ten, giaTri } = giaTriThu("otp", "trustprocure.jinji.vn", BAY_GIO);
    expect(ten).toBe("otp");
    expect(giaTri).toMatch(/^[0-9]{6}$/u);
  });

  it("duong_dan cùng dạng /i#<mã tổ chức>:<token> và cùng độ dài (112 ký tự với tên miền prod)", () => {
    const { ten, giaTri } = giaTriThu("loi-moi", "trustprocure.jinji.vn", BAY_GIO);
    expect(ten).toBe("duong_dan");
    expect(giaTri).toMatch(/^https:\/\/trustprocure\.jinji\.vn\/i#[0-9a-f-]{36}:[A-Za-z0-9_-]{43}$/u);
    expect(giaTri).toHaveLength(112);
  });

  it("han_nop là chuỗi ISO UTC, bảy ngày sau", () => {
    expect(giaTriThu("gia-han", "x.vn", BAY_GIO)).toEqual({ ten: "han_nop", giaTri: new Date(BAY_GIO + 7 * 86_400_000).toISOString() });
  });

  it("che số: đủ để nhận ra, không đủ để chép lại", () => {
    expect(cheSo(SO_E164)).toBe("+84•••••4567");
  });
});

describe("[ADR-069] thu-zalo: chạy", () => {
  it("gửi otp: làm mới token, GHI LẠI kho, gọi ZNS đúng template và số E.164; đầu ra không mang số đầy đủ hay bí mật", async () => {
    const kho = new KhoGia(tokenMoiNap());
    const goi: { url: string; body: string }[] = [];
    const { ma, ra } = await chay(["--loai", "otp", "--so", SO_TRONG_NUOC, "--template", "4242"], kho, fetchGia({ error: 0 }, goi));
    expect(ma).toBe(0);
    expect(kho.soLanGhi).toBe(1);
    expect(kho.tk.refreshToken).toBe("rt-2");
    expect(goi.map((g) => g.url)).toEqual([URL_TOKEN_ZALO, URL_GUI_ZNS]);
    const than = JSON.parse(goi[1]!.body) as { phone: string; template_id: string; template_data: Record<string, string> };
    expect([than.phone, than.template_id, Object.keys(than.template_data)]).toEqual(["84901234567", "4242", ["otp"]]);
    expect(than.template_data.otp).toMatch(/^[0-9]{6}$/u);
    expect(ra).toContain("+84•••••4567");
    expect(ra).toContain("access token hết hạn lúc");
    for (const lo of ["901234567", "rt-1", "rt-2", "at-moi", "bi-mat-app"]) expect(ra).not.toContain(lo);
  });

  it("ZNS từ chối ⇒ mã 1, dòng HỎNG mang mã lỗi của Zalo", async () => {
    const { ma, ra } = await chay(["--loai", "gia-han", "--so", SO_E164, "--template", "1"], new KhoGia(tokenMoiNap()), fetchGia({ error: -124 }));
    expect(ma).toBe(1);
    expect(ra).toMatch(/^HỎNG: .*error -124/u);
  });

  it("token đã xoay mà không ghi được kho ⇒ mã 3, nói phải cấp lại refresh token", async () => {
    const kho = new KhoGia(tokenMoiNap());
    kho.loiGhi = new Error("AccessDenied");
    const { ma, ra } = await chay(["--loai", "otp", "--so", SO_E164, "--template", "1"], kho, fetchGia({ error: 0 }));
    expect(ma).toBe(3);
    expect(ra).toContain("cấp lại refresh token");
  });

  it("--chi-doc-secret: không gọi Zalo, không ghi kho, chỉ nói trường nào có", async () => {
    const kho = new KhoGia(tokenMoiNap());
    const goi: { url: string; body: string }[] = [];
    const { ma, ra } = await chay(["--chi-doc-secret"], kho, fetchGia({ error: 0 }, goi));
    expect(ma).toBe(0);
    expect(goi).toEqual([]);
    expect(kho.soLanGhi).toBe(0);
    expect(ra).toBe("secret: app_id có, secret_key có, refresh_token có; chưa có access token");
  });

  it("lỗi AWS khi đọc secret ⇒ mã 1, in TÊN lỗi, không đổ stack", async () => {
    const kho = new KhoGia(tokenMoiNap());
    kho.loiDoc = Object.assign(new Error("Secrets Manager can't find the specified secret."), {
      name: "ResourceNotFoundException",
      $metadata: { httpStatusCode: 400 },
    });
    const { ma, ra } = await chay(["--chi-doc-secret"], kho, fetchGia({ error: 0 }));
    expect(ma).toBe(1);
    expect(ra).toContain("(ResourceNotFoundException)");
  });
});
