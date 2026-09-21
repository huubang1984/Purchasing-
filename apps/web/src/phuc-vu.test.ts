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

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODULE_TRINH_DUYET, MODULE_WEB, TRANG, napTep, taoWebServer } from "./phuc-vu.js";

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
    for (const ten of MODULE_WEB) expect(m.has(`/lib/${ten}.js`), ten).toBe(true);
  });

  // ============================================================================================
  // [S1.99 / khoản 198] MỌI ĐƯỜNG MÀ SẢN PHẨM DỰNG LINK TỚI PHẢI LÀ ĐƯỜNG `apps/web` PHỤC VỤ
  //
  // Khoản 198 sống từ S1.92 và rộng ra ở S1.93: bộ gửi tin dựng `${baseUrl}/login#<mã>` cho
  // người mua và `${baseUrl}/i#<mã>` cho nhà cung cấp, mà bản đồ `TRANG` không có đường nào
  // trong hai đường ấy — nên MỌI link do sản phẩm sinh ra trả 404, và lượt đi thử chỉ đi được
  // nhờ link VIẾT TAY của `tools/gieo-demo`. Hai vòng liền đọc qua mà không ai thấy, vì không
  // lớp nào nối hai phía lại.
  //
  // Vế này đọc VĂN BẢN NGUỒN của bộ gửi chứ không import nó: một cạnh import từ `apps/web` sang
  // `apps/api` là một cạnh depcruise phải bless, và khối mở đầu tệp này đã ghi rằng đổi một ranh
  // giới kiến trúc lấy sự tiện lợi của một test là đổi sai chiều. Đọc văn bản không tạo cạnh nào.
  //
  // Nó đo HÌNH DẠNG chứ không đo một danh sách: thêm một dạng link mới ở bộ gửi mà quên trang
  // thì câu này đỏ, kể cả khi không ai nhớ tới khoản 198.
  // ============================================================================================
  it("[khoản 198] mọi đường dẫn bộ gửi tin dựng link tới đều nằm trong TRANG", () => {
    const nguon = readFileSync(
      new URL("../../api/src/adapters/hop-thu-dev.ts", import.meta.url),
      "utf8",
    );
    const duong = [...nguon.matchAll(/\$\{tuyChon\.baseUrl\}(\/[a-z0-9-]*)#/gu)].map((m) => m[1]);
    // Đối chứng dương: nếu biểu thức này khớp 0 lần thì vế dưới đúng một cách rỗng tuếch.
    expect(duong.length, "không đọc được dạng link nào ở hop-thu-dev.ts").toBeGreaterThanOrEqual(3);
    for (const d of new Set(duong)) expect(Object.keys(TRANG), d).toContain(d);
  });

  it("[khoản 198] /i ra trang nộp thầu và /login ra trang mở thầu", async () => {
    const ri = await goi("/i");
    expect(ri.status).toBe(200);
    expect(ri.text).toContain("Nộp báo giá");
    const rl = await goi("/login");
    expect(rl.status).toBe(200);
    expect(rl.text).toContain("Mở thầu");
  });

  it("[khoản 206] phép tính tiền ra JavaScript, còn nguyên hai bộ đọc chuỗi", async () => {
    const r = await goi("/lib/so-tien.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/javascript");
    // Cùng vế chống "phục vụ một bản rỗng" mà `/lib/seal.js` dùng: hai bộ đọc phải cùng có mặt,
    // vì chính việc chỉ có MỘT bộ đọc cho cả chuỗi máy lẫn chuỗi người gõ là khiếm khuyết cũ.
    expect(r.text).toContain("export function donGiaNguoiGo");
    expect(r.text).toContain("export function sangNguyen");
    expect(r.text).not.toMatch(/from\s+["']node:/u);
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

// ==============================================================================================
// [S1.107 / lượt soi ngang 77 — ③] LUẬT CẤM SINK HTML PHẢI ĐỎ THẬT
//
// `apps/web/trang/*.js` là mã DUY NHẤT của kho chạy trong trình duyệt của người mua và của nhà
// cung cấp, và nó dựng DOM từ dữ liệu máy chủ trả về — tên nhà cung cấp, mã thành phần chính sách,
// thông điệp lỗi. Lượt soi ngang **76** tìm ra BA khiếm khuyết CAO và cả ba nằm trong đúng thư mục
// này; S1.99 vá chúng, nhưng vá ĐIỂM. Tới lượt 77, thư mục ấy vẫn chỉ có MỘT luật (`no-undef`).
//
// Vòng này thêm luật, và mũi đo dưới đây là thứ biến nó từ một dòng cấu hình thành một LỚP: viết
// một tệp vi phạm THẬT vào đúng thư mục ấy rồi chạy eslint, đòi nó đỏ. *"Một quy tắc chưa từng đỏ
// thật là một quy tắc chưa được đo"* — cùng khuôn ba probe depcruise của `boundaries.test.ts`.
// ==============================================================================================
describe("[S1.107] lớp cấm sink HTML ở apps/web/trang", () => {
  const GOC_KHO = fileURLToPath(new URL("../../../", import.meta.url));

  it("một tệp gán `innerHTML` trong `apps/web/trang/` làm eslint ĐỎ — và đỏ vì ĐÚNG luật ấy", () => {
    const probe = join(GOC_KHO, "apps/web/trang/zzprobe-sink.js");
    writeFileSync(
      probe,
      `const el = document.getElementById("x");
el.innerHTML = "<b>" + location.hash + "</b>";
`,
    );
    try {
      let ra = "";
      try {
        execFileSync("npx", ["eslint", "apps/web/trang/zzprobe-sink.js"], {
          cwd: GOC_KHO,
          encoding: "utf8",
          shell: true,
        });
      } catch (e) {
        ra = String((e as { stdout?: string }).stdout ?? "");
      }
      expect(ra, "eslint KHÔNG đỏ trên một tệp gán innerHTML — luật không có răng").toContain("no-restricted-properties");
      expect(ra).toContain("innerHTML");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 120_000);

  it("ĐỐI CHỨNG ÂM: cùng tệp ấy dựng DOM bằng `textContent` thì eslint XANH", () => {
    // Không có vế này, vế trên xanh y hệt với một cấu hình làm đỏ MỌI tệp trong thư mục.
    const probe = join(GOC_KHO, "apps/web/trang/zzprobe-sach.js");
    writeFileSync(
      probe,
      `const el = document.getElementById("x");
el.replaceChildren();
el.textContent = location.hash;
`,
    );
    try {
      const ra = execFileSync("npx", ["eslint", "apps/web/trang/zzprobe-sach.js"], {
        cwd: GOC_KHO,
        encoding: "utf8",
        shell: true,
      });
      expect(ra.trim()).toBe("");
    } finally {
      rmSync(probe, { force: true });
    }
  }, 120_000);
});
