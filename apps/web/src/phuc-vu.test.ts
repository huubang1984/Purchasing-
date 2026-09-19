// ==============================================================================================
// [ADR-044] MÁY CHỦ CỦA LÁT CẮT DEMO — ĐO BỀ MẶT TỆP VÀ BỘ CHUYỂN TIẾP
//
// Test này KHÔNG dựng `apps/api` và KHÔNG cần Postgres, và đó là một lựa chọn chứ không phải một
// sự lười: thứ `apps/web` chịu trách nhiệm là *"chuyển tiếp ĐÚNG những gì, và chỉ những gì"* —
// hành vi của chính API đã có `apps/api/src/guest.int.test.ts` đo đầu-cuối. Một upstream GIẢ làm
// được phép đo ấy sắc hơn một upstream thật: nó khai báo được chính xác thứ nó nhận, nên một
// header bị nuốt hay một header lạ bị thêm vào đều hiện ra ngay.
//
// (Một cạnh import từ `apps/web` sang `apps/api` cũng sẽ là một cạnh mà depcruise phải bless, và
// đổi một ranh giới kiến trúc lấy sự tiện lợi của một test là đổi sai chiều — cùng lập luận đã
// ghi ở đầu `ts-resolve-hook.mjs`.)
// ==============================================================================================

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODULE_TRINH_DUYET, TRANG, napTep, taoWebServer } from "./phuc-vu.js";

interface LanNhan {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly than: string;
}

let nguon: Server;
let web: Server;
let gocWeb = "";
const daNhan: LanNhan[] = [];

/** Upstream giả: ghi lại mọi thứ nhận được, trả về một cookie và một thân JSON. */
function taoNguonGia(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const phan: Buffer[] = [];
    req.on("data", (c: Buffer) => phan.push(c));
    req.on("end", () => {
      daNhan.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, than: Buffer.concat(phan).toString("utf8") });
      res.writeHead(201, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": ["__Host-tp_guest=abc; Path=/; HttpOnly; Secure; SameSite=Strict", "phu=1; Path=/"],
        "x-bi-mat-cua-api": "khong-duoc-di-ra",
      });
      res.end(JSON.stringify({ ok: true, thay: req.url }));
    });
  });
}

async function goi(duong: string, tuyChon: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: Headers; text: string }> {
  const res = await fetch(`${gocWeb}${duong}`, {
    method: tuyChon.method ?? "GET",
    headers: tuyChon.headers,
    body: tuyChon.body,
    redirect: "manual",
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

beforeAll(async () => {
  nguon = taoNguonGia();
  await new Promise<void>((xong) => nguon.listen(0, "127.0.0.1", xong));
  const cong = (nguon.address() as AddressInfo).port;
  web = taoWebServer({ apiOrigin: `http://127.0.0.1:${cong}`, tls: null });
  await new Promise<void>((xong) => web.listen(0, "127.0.0.1", xong));
  gocWeb = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((xong) => web.close(() => xong()));
  await new Promise<void>((xong) => nguon.close(() => xong()));
});

describe("bề mặt tệp", () => {
  it("mọi đường khai trong TRANG có tệp thật, và mọi module trình duyệt gỡ kiểu được", () => {
    const m = napTep();
    for (const duong of Object.keys(TRANG)) expect(m.has(duong), duong).toBe(true);
    for (const ten of MODULE_TRINH_DUYET) expect(m.has(`/lib/${ten}.js`), ten).toBe(true);
  });

  it("trang nộp thầu ra HTML kèm CSP không có unsafe-inline", async () => {
    const r = await goi("/nop-thau");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.text).toContain("Nộp báo giá");
  });

  it("mã niêm phong ra JavaScript, còn nguyên lời gọi thật và KHÔNG còn một import node: nào", async () => {
    const r = await goi("/lib/seal.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/javascript");
    expect(r.text).toContain("export async function sealBid");
    expect(r.text).not.toMatch(/from\s+["']node:/u);
    // Đây là vế chống "phục vụ một bản rỗng": tệp phải còn đúng hai lời gọi mật mã cốt lõi.
    expect(r.text).toContain("deriveContentKey");
    expect(r.text).toContain("encodeEnvelope");
  });

  it("đường không có trong bản đồ là 404, kể cả các dạng leo thư mục", async () => {
    for (const duong of ["/khong-co", "/../package.json", "/..%2f..%2fpackage.json", "/lib/../../package.json", "/trang/nop-thau.html"]) {
      const r = await goi(duong);
      expect([404, 400, 301, 302], duong).toContain(r.status);
      expect(r.text, duong).not.toContain("\"name\": \"trustprocure");
    }
  });

  it("phương thức ghi lên một đường tĩnh bị từ chối", async () => {
    const r = await goi("/nop-thau", { method: "POST", body: "x" });
    expect(r.status).toBe(405);
  });
});

describe("bộ chuyển tiếp", () => {
  it("chuyển tiếp đường dẫn, phương thức, thân, và ĐÚNG bốn header lên api", async () => {
    daNhan.length = 0;
    const r = await goi("/api/guest/redeem", {
      method: "POST",
      body: JSON.stringify({ token: "t" }),
      headers: {
        "content-type": "application/json",
        cookie: "__Host-tp_guest=xyz",
        origin: "http://127.0.0.1:8090",
        accept: "application/json",
        "x-forwarded-for": "9.9.9.9",
        "x-thu-la": "khong-duoc-di-len",
      },
    });
    expect(r.status).toBe(201);
    expect(daNhan).toHaveLength(1);
    const n = daNhan[0]!;
    expect(n.method).toBe("POST");
    expect(n.url).toBe("/guest/redeem");
    expect(n.than).toBe(JSON.stringify({ token: "t" }));
    expect(n.headers.cookie).toBe("__Host-tp_guest=xyz");
    expect(n.headers.origin).toBe("http://127.0.0.1:8090");
    // Hai vế NGƯỢC, và chúng là phần đáng giá nhất của test này: khai hộ người gọi một địa chỉ
    // là đúng thứ `taoDocDiaChi` của api tồn tại để chặn, còn chuyển tiếp mù mọi header là cách
    // một bộ proxy trở thành một lỗ hổng mà không ai đọc ra từ mã của nó.
    expect(n.headers["x-forwarded-for"]).toBeUndefined();
    expect(n.headers["x-thu-la"]).toBeUndefined();
  });

  it("trả MỌI Set-Cookie xuống trình duyệt — phiên khách sống được là nhờ vế này", async () => {
    const r = await goi("/api/guest/otp/verify", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    const ds = r.headers.getSetCookie();
    expect(ds).toHaveLength(2);
    expect(ds[0]).toContain("__Host-tp_guest=abc");
    expect(ds[0]).toContain("HttpOnly");
  });

  it("KHÔNG trả header lạ của api xuống trình duyệt — danh sách trắng theo chiều xuống", async () => {
    const r = await goi("/api/guest/session");
    expect(r.headers.get("x-bi-mat-cua-api")).toBeNull();
    expect(r.headers.get("content-type")).toContain("application/json");
  });

  it("thân vượt trần bị chặn ở 413, và api KHÔNG nhận được gì", async () => {
    daNhan.length = 0;
    const r = await goi("/api/guest/bids", {
      method: "POST",
      body: "x".repeat(1024 * 1024 + 10),
      headers: { "content-type": "application/json" },
    });
    expect(r.status).toBe(413);
    expect(daNhan).toHaveLength(0);
  });

  it("api chết thì trang trả 502 và KHÔNG nói gì về hình dạng mạng bên trong", async () => {
    const chet = taoWebServer({ apiOrigin: "http://127.0.0.1:1", tls: null });
    await new Promise<void>((xong) => chet.listen(0, "127.0.0.1", xong));
    const goc = `http://127.0.0.1:${(chet.address() as AddressInfo).port}`;
    const res = await fetch(`${goc}/api/guest/session`);
    const chu = await res.text();
    expect(res.status).toBe(502);
    expect(chu).not.toContain("127.0.0.1");
    expect(chu).not.toContain("ECONNREFUSED");
    await new Promise<void>((xong) => chet.close(() => xong()));
  });
});
