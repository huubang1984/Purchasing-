// [ADR-069] Kênh Zalo ZNS — đo trên fetch GIẢ và kho GIẢ: hình dạng lời gọi, vòng đời token (làm mới, ghi kho,
// single-flight, thua cuộc đua), lỗi không mang dữ liệu nhạy cảm. Chưa gọi Zalo thật.
import { describe, expect, it } from "vitest";
import { URL_GUI_ZNS, URL_TOKEN_ZALO, ZaloTokenMatError, taoBoGuiZalo, type KhoTokenZalo, type TokenZalo } from "./gui-zalo.js";
import { GuiKenhError } from "./kenh-so.js";

const BAY_GIO = 1_800_000_000_000;
const SO = "+84901234567";
const MAU = { otp: "1001", loiMoi: "1002", giaHan: "1003" };

interface LanGoi {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

class KhoGia implements KhoTokenZalo {
  soLanGhi = 0;
  loiGhi: Error | undefined;
  constructor(public tk: TokenZalo) {}
  doc(): Promise<TokenZalo> {
    return Promise.resolve(this.tk);
  }
  ghi(t: TokenZalo): Promise<void> {
    if (this.loiGhi !== undefined) return Promise.reject(this.loiGhi);
    this.soLanGhi += 1;
    this.tk = t;
    return Promise.resolve();
  }
}

const tokenCu = (ghiDe: Partial<TokenZalo> = {}): TokenZalo => ({
  appId: "123",
  secretKey: "bi-mat-app",
  accessToken: "",
  refreshToken: "rt-1",
  hetHanLuc: 0,
  ...ghiDe,
});

function json(v: unknown, status = 200): Response {
  return new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
}

function fetchGia(tl: (l: LanGoi, lan: number) => Response | Promise<Response>): { goi: typeof fetch; lan: LanGoi[] } {
  const lan: LanGoi[] = [];
  const goi = (async (url: string | URL | Request, init?: RequestInit) => {
    const l: LanGoi = {
      url: typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : "",
    };
    lan.push(l);
    return tl(l, lan.length);
  }) as typeof fetch;
  return { goi, lan };
}

const TOKEN_OK = { access_token: "at-2", refresh_token: "rt-2", expires_in: "90000" };

describe("[ADR-069] bộ gửi Zalo ZNS", () => {
  it("lần đầu: làm mới bằng refresh token, GHI kho, rồi gửi đúng template/số/tham số", async () => {
    const kho = new KhoGia(tokenCu());
    const f = fetchGia((l) => (l.url === URL_TOKEN_ZALO ? json(TOKEN_OK) : json({ error: 0, message: "Success" })));
    const g = taoBoGuiZalo({ kho, mau: MAU, fetch: f.goi, bayGio: () => BAY_GIO });
    await g.guiOtp(SO, "123456");
    expect(f.lan.map((l) => l.url)).toEqual([URL_TOKEN_ZALO, URL_GUI_ZNS]);
    const [lamMoi, gui] = f.lan as [LanGoi, LanGoi];
    expect(lamMoi.headers.secret_key).toBe("bi-mat-app");
    expect(Object.fromEntries(new URLSearchParams(lamMoi.body))).toEqual({ app_id: "123", refresh_token: "rt-1", grant_type: "refresh_token" });
    expect(kho.soLanGhi).toBe(1);
    expect(kho.tk).toMatchObject({ accessToken: "at-2", refreshToken: "rt-2", hetHanLuc: BAY_GIO + 90_000_000 });
    expect(gui.headers.access_token).toBe("at-2");
    expect(JSON.parse(gui.body)).toEqual({ phone: "84901234567", template_id: "1001", template_data: { otp: "123456" } });
  });

  it("token còn hạn trong kho ⇒ không làm mới; nhiều lần gửi dùng lại token trong bộ nhớ", async () => {
    const kho = new KhoGia(tokenCu({ accessToken: "at-kho", hetHanLuc: BAY_GIO + 3_600_000 }));
    const f = fetchGia(() => json({ error: 0 }));
    const g = taoBoGuiZalo({ kho, mau: MAU, fetch: f.goi, bayGio: () => BAY_GIO });
    await g.guiLoiMoi(SO, "https://app.vidu.vn/i#t");
    await g.guiGiaHan(SO, "2026-10-01T10:00:00Z");
    expect(f.lan.map((l) => l.url)).toEqual([URL_GUI_ZNS, URL_GUI_ZNS]);
    expect(f.lan.map((l) => (JSON.parse(l.body) as { template_id: string }).template_id)).toEqual(["1002", "1003"]);
    expect(JSON.parse(f.lan[0]!.body)).toMatchObject({ template_data: { duong_dan: "https://app.vidu.vn/i#t" } });
    expect(kho.soLanGhi).toBe(0);
  });

  it("single-flight: năm lần gửi đồng thời chung MỘT lần làm mới", async () => {
    const kho = new KhoGia(tokenCu());
    const f = fetchGia((l) => (l.url === URL_TOKEN_ZALO ? json(TOKEN_OK) : json({ error: 0 })));
    const g = taoBoGuiZalo({ kho, mau: MAU, fetch: f.goi, bayGio: () => BAY_GIO });
    await Promise.all([1, 2, 3, 4, 5].map((i) => g.guiOtp(SO, String(i))));
    expect(f.lan.filter((l) => l.url === URL_TOKEN_ZALO)).toHaveLength(1);
    expect(kho.soLanGhi).toBe(1);
  });

  it("làm mới thất bại vì task khác đã xoay ⇒ dùng token mới trong kho, không ném", async () => {
    const kho = new KhoGia(tokenCu());
    const f = fetchGia((l) => {
      if (l.url === URL_TOKEN_ZALO) {
        // Task khác thắng: kho đã mang refresh token mới và access token còn hạn.
        kho.tk = tokenCu({ accessToken: "at-khac", refreshToken: "rt-khac", hetHanLuc: BAY_GIO + 3_600_000 });
        return json({ error: -14014 }, 400);
      }
      return json({ error: 0 });
    });
    const g = taoBoGuiZalo({ kho, mau: MAU, fetch: f.goi, bayGio: () => BAY_GIO });
    await g.guiOtp(SO, "1");
    expect(f.lan[1]!.headers.access_token).toBe("at-khac");
  });

  it("làm mới thất bại thật ⇒ GuiKenhError chỉ mang mã, không token/secret", async () => {
    const kho = new KhoGia(tokenCu());
    const f = fetchGia(() => json({ error: -14014, error_description: "refresh token rt-1 invalid" }, 400));
    const g = taoBoGuiZalo({ kho, mau: MAU, fetch: f.goi, bayGio: () => BAY_GIO });
    const loi = (await g.guiOtp(SO, "1").catch((e: unknown) => e)) as Error;
    expect(loi).toBeInstanceOf(GuiKenhError);
    expect(loi.message).toMatch(/HTTP 400, error -14014/u);
    expect(loi.message).not.toMatch(/rt-1|bi-mat-app|invalid/u);
    expect(f.lan).toHaveLength(1);
  });

  it("ghi kho hỏng sau khi xoay ⇒ ZaloTokenMatError (tên riêng); tiến trình vẫn gửi được bằng token trong bộ nhớ", async () => {
    const kho = new KhoGia(tokenCu());
    kho.loiGhi = new Error("AccessDenied");
    const f = fetchGia((l) => (l.url === URL_TOKEN_ZALO ? json(TOKEN_OK) : json({ error: 0 })));
    const g = taoBoGuiZalo({ kho, mau: MAU, fetch: f.goi, bayGio: () => BAY_GIO });
    const loi = (await g.guiOtp(SO, "1").catch((e: unknown) => e)) as Error;
    expect(loi.name).toBe("ZaloTokenMatError");
    expect(loi).toBeInstanceOf(ZaloTokenMatError);
    await g.guiOtp(SO, "2");
    expect(f.lan.at(-1)!.headers.access_token).toBe("at-2");
  });

  it("ZNS từ chối ⇒ ném mã lỗi, không số; lần sau đọc lại kho thay vì tin bộ nhớ", async () => {
    const kho = new KhoGia(tokenCu({ accessToken: "at-kho", hetHanLuc: BAY_GIO + 3_600_000 }));
    let lan = 0;
    const f = fetchGia(() => {
      lan += 1;
      return lan === 1 ? json({ error: -124, message: "phone 84901234567 bad" }) : json({ error: 0 });
    });
    const g = taoBoGuiZalo({ kho, mau: MAU, fetch: f.goi, bayGio: () => BAY_GIO });
    const loi = (await g.guiOtp(SO, "1").catch((e: unknown) => e)) as Error;
    expect(loi.message).toMatch(/error -124/u);
    expect(loi.message).not.toContain("901234567");
    kho.tk = tokenCu({ accessToken: "at-moi-cap", hetHanLuc: BAY_GIO + 3_600_000 });
    await g.guiOtp(SO, "2");
    expect(f.lan.at(-1)!.headers.access_token).toBe("at-moi-cap");
  });

  it("số ngoài Việt Nam ⇒ ném trước mọi lời gọi", async () => {
    const f = fetchGia(() => json({ error: 0 }));
    const g = taoBoGuiZalo({ kho: new KhoGia(tokenCu()), mau: MAU, fetch: f.goi, bayGio: () => BAY_GIO });
    await expect(g.guiOtp("+6591234567", "1")).rejects.toThrow(/\+84/u);
    expect(f.lan).toHaveLength(0);
  });
});
