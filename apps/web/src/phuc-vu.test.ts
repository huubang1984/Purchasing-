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

import { execFile } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// [khoản nợ 59] Hai probe ở cuối tệp viết một tệp `.js` THẬT vào `apps/web/trang/`, và thư mục
// ấy NẰM TRONG mục tiêu cruise (`packages apps tools tests db`). Khoá này là thứ giữ chúng không
// giẫm lên lượt cruise toàn kho của `tests/architecture/boundaries.test.ts` — xem khối lý do đầy
// đủ trong chính tệp khoá, và xem mục 7c của §S1.107 để biết vì sao dòng này có mặt.
import { TRAN_TEST_GIU_KHOA_MS, voiKhoaDepcruiseAsync } from "../../../tests/architecture/khoa-depcruise.js";
import * as chinhSach from "./chinh-sach.js";
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

  // ============================================================================================
  // [S1.173 / ADR-107] HÌNH DẠNG LINK CỦA BỘ GỬI PHẢI LÀ HÌNH DẠNG TRANG ĐÍCH ĐỌC ĐƯỢC
  //
  // Khoản 198 đóng ở S1.99 với hai lời khai mà vòng này đo là sai cho kênh thật: `nop-thau.js` bỏ qua
  // fragment không có dấu hai chấm (không điền cả ô mã), và thân thư của SES, SMS, Zalo không mang
  // `orgId` — chỉ bản ghi JSON của hộp thư dev có. Nên mọi link do bộ gửi THẬT sinh ra dẫn tới một trang
  // đòi thứ người nhận không có. Vế dưới nối hai phía: đọc VĂN BẢN của ba bộ gửi, và CHẠY `docLink()` của
  // trang đích trên đúng dạng ấy.
  // ============================================================================================
  it("[ADR-107] mọi link của ba bộ gửi mang `<orgId>:<token>` (hoặc `<orgId>` trơn ở tin báo không mã)", () => {
    const tep = ["hop-thu-dev.ts", "gui-ses.ts", "kenh-so.ts"];
    const link: { tep: string; duong: string; manh: string }[] = [];
    for (const t of tep) {
      const nguon = readFileSync(new URL(`../../api/src/adapters/${t}`, import.meta.url), "utf8");
      for (const m of nguon.matchAll(/\$\{[A-Za-z]+\.baseUrl\}(\/[a-z0-9-]*)(#\$\{[^}]*\}(?::\$\{[^}]*\})?)?/gu)) {
        link.push({ tep: t, duong: m[1] ?? "", manh: m[2] ?? "" });
      }
    }
    // Đối chứng dương: 3 ở hộp thư dev, 4 ở SES (đăng nhập, mời, tin báo có mã và không mã), 1 ở kênh số.
    expect(link.length, "không đọc được đủ các chỗ dựng link").toBe(8);
    for (const l of link) {
      // Mọi đường — không chỉ của hộp thư dev như vế khoản 198 ở trên — phải là đường `apps/web` phục vụ.
      expect(Object.keys(TRANG), `${l.tep}: ${l.duong}`).toContain(l.duong);
      expect(l.manh === "#${m.orgId}:${m.token}" || l.manh === "#${m.orgId}", `${l.tep}: ${l.duong}${l.manh}`).toBe(true);
    }
    // Dạng `#<orgId>` trơn đúng MỘT chỗ: nhánh `token === null` của tin báo người duyệt qua SES. Cho nó ở chỗ
    // khác là để một bộ gửi rơi mất token mà vẫn xanh.
    const tron = link.filter((l) => l.manh === "#${m.orgId}");
    expect(tron.map((l) => `${l.tep}${l.duong}`)).toEqual(["gui-ses.ts/login"]);
  });

  it("[ADR-107] docLink() của bốn trang đọc `<orgId>:<token>`; trang /login đọc thêm `<orgId>` trơn và xoá ô mã", () => {
    const ORG = "11111111-1111-4111-8111-111111111111";
    const chay = (trang: string, hash: string, truoc: { org: string; token: string }) => {
      const js = readFileSync(new URL(`../trang/${trang}.js`, import.meta.url), "utf8");
      const ham = /^function docLink\(\) \{[\s\S]*?^\}/mu.exec(js)?.[0];
      expect(ham, `${trang}.js không còn hàm docLink`).toBeDefined();
      // `/login` dùng hằng `LA_UUID` chung của trang; ba trang kia không có nó.
      const hang = /^const LA_UUID = .*;$/mu.exec(js)?.[0] ?? "";
      const o = { org: { value: truoc.org }, token: { value: truoc.token } };
      runInNewContext(`${hang}\n${ham ?? ""}\ndocLink();`, { $: (id: "org" | "token") => o[id], location: { hash }, decodeURIComponent });
      return { org: o.org.value, token: o.token.value };
    };
    for (const trang of ["mo-thau", "tao-thau", "chinh-sach", "nop-thau"]) {
      expect(chay(trang, `#${ORG}:tokTokTokTokTokTok_-1`, { org: "", token: "" }), trang).toEqual({ org: ORG, token: "tokTokTokTokTokTok_-1" });
    }
    expect(chay("mo-thau", `#${ORG}`, { org: "", token: "ma-cu-cua-nguoi-truoc" })).toEqual({ org: ORG, token: "" });
    expect(chay("mo-thau", "#chiCoMaTronKhongCoToChuc", { org: "go-tay", token: "" })).toEqual({ org: "go-tay", token: "chiCoMaTronKhongCoToChuc" });
  });

  it("[ADR-107] ô tổ chức của /login nhận nguyên một link cũ dán vào, và nói đúng khi mã sai hình dạng", () => {
    const ORG = "11111111-1111-4111-8111-111111111111";
    const js = readFileSync(new URL("../trang/mo-thau.js", import.meta.url), "utf8");
    const hang = /^const LA_UUID = .*;$/mu.exec(js)?.[0];
    const ham = /^function docToChuc\(\) \{[\s\S]*?^\}/mu.exec(js)?.[0];
    expect(hang).toBeDefined();
    expect(ham).toBeDefined();
    const doc = (v: string): unknown => {
      const ctx: Record<string, unknown> = { $: () => ({ value: v }) };
      runInNewContext(`${hang ?? ""}\n${ham ?? ""}\nketQua = docToChuc();`, ctx);
      return ctx["ketQua"];
    };
    expect(doc(ORG)).toBe(ORG);
    expect(doc(`  https://mua.vidu.vn/login#${ORG}:tokTokTokTokTokTok_-1 `)).toBe(ORG);
    expect(doc(`#${ORG}`)).toBe(ORG);
    expect(doc("")).toBe("");
    expect(doc("cong-ty-a")).toBeNull();
  });

  // ============================================================================================
  // [S1.9102] BA TRANG NGƯỜI MUA HỎI LẠI PHIÊN CÒN HẠN LÚC TẢI, VÀ BỐN TRANG XOÁ MÃ KHỎI THANH ĐỊA CHỈ SAU KHI DÙNG
  //
  // Phiên là cookie `Path=/` sống tới 8 giờ kể cả sau khi đóng trình duyệt, còn mã đăng nhập chỉ dùng được một
  // lần — trước vòng này mỗi trang chỉ hỏi `/me` sau khi đăng nhập, nên sang trang khác là phải xin link mới.
  // Nay trang hỏi lúc tải và, có phiên, HỎI người dùng thay vì tự mở: trên máy dùng chung phiên ấy có thể của
  // người khác (lượt soi đo được một chữ ký duyệt ghi dưới danh tính của người không hề duyệt).
  //
  // Bản đầu của vế này trích từng hàm bằng regex và gọi chúng lẻ — lượt soi đảo `thuPhienCo();` lên trước
  // `docLink();` ở cả ba trang mà vế vẫn xanh, trong khi đúng thứ tự ấy là thứ giữ link của người B không mở
  // phiên của người A. Nay vế NẠP NGUYÊN TỆP TRANG vào `node:vm`, với DOM giả dựng từ id và `hidden` của tệp
  // HTML cùng tên, `fetch` giả giữ một "cookie", và `history`/`location` giả: thứ tự ở cấp tệp, trình nghe
  // nút, trình nghe hashchange đều chạy như trên trình duyệt. Import `/lib/*` được thay bằng hàm rỗng — vế này
  // không đo tiền hay mật mã.
  // ============================================================================================
  describe("[S1.9102] hỏi lại phiên lúc tải, đăng xuất, đổi người, và xoá fragment sau khi dùng mã", () => {
    const BUOC: Record<string, readonly string[]> = {
      "mo-thau": ["b2", "b3", "b4", "b5", "b6", "b7", "b8"],
      "tao-thau": ["b2", "b3", "b4", "b5"],
      "chinh-sach": ["b2", "b3"],
    };
    const ORG = "11111111-2222-4333-8444-555555555555";
    const A = { userId: "aaaaaaaa-0000-4000-8000-000000000000", sessionId: "s-a", orgId: ORG, kind: "USER" };
    const B = { userId: "bbbbbbbb-0000-4000-8000-000000000000", sessionId: "s-b", orgId: ORG, kind: "USER" };
    type Phien = typeof A;
    type Nghe = Record<string, Array<() => unknown>>;
    interface PhanTu {
      hidden: boolean; textContent: string; value: string; disabled: boolean; checked: boolean; className: string;
      dataset: Record<string, string>; lop: Set<string>; nghe: Nghe;
      classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
      addEventListener: (t: string, f: () => unknown) => void;
      replaceChildren: () => void; append: () => void; appendChild: () => void; setAttribute: () => void;
      querySelector: () => PhanTu; querySelectorAll: () => PhanTu[]; focus: () => void; remove: () => void;
    }
    const taoPhanTu = (hidden: boolean): PhanTu => {
      const lop = new Set<string>();
      const nghe: Nghe = {};
      const e: PhanTu = {
        hidden, textContent: "", value: "", disabled: false, checked: false, className: "", dataset: {}, lop, nghe,
        classList: { add: (c) => { lop.add(c); }, remove: (c) => { lop.delete(c); }, contains: (c) => lop.has(c) },
        addEventListener: (t, f) => { (nghe[t] ??= []).push(f); },
        replaceChildren: () => undefined, append: () => undefined, appendChild: () => undefined, setAttribute: () => undefined,
        querySelector: () => taoPhanTu(false), querySelectorAll: () => [], focus: () => undefined, remove: () => undefined,
      };
      return e;
    };
    // `/lib/chinh-sach.js` là bản thật (`dienMau` vẽ bảng bậc mặc định); mọi tên import khác là một hàm trả chuỗi rỗng.
    const THU_VIEN: Record<string, unknown> = { ...chinhSach };
    const cho = () => new Promise((r) => { setTimeout(r, 5); });

    interface TuyChon {
      hash: string;
      cookie: Phien | null;
      /** Ai được cookie sau `/auth/totp` thành công. */
      nguoiVao?: Phien;
      /** Trả thay phản hồi mặc định cho một lời gọi; `undefined` là dùng mặc định. */
      thay?: (lenh: string) => Promise<{ status: number; body: unknown }> | undefined;
    }
    const dungTrang = async (trang: string, tuyChon: TuyChon) => {
      const html = readFileSync(new URL(`../trang/${trang}.html`, import.meta.url), "utf8");
      const js = readFileSync(new URL(`../trang/${trang}.js`, import.meta.url), "utf8").replace(
        /^import \{([^}]*)\} from "[^"]+";$/gmu,
        (_m, ten: string) => `const {${ten}} = __thuVien;`,
      );
      const el: Record<string, PhanTu> = {};
      for (const m of html.matchAll(/<\w+([^>]*?)\sid="([^"]+)"([^>]*)>/gu)) {
        el[m[2] ?? ""] = taoPhanTu(/\shidden(?:\s|$)/u.test(`${m[1] ?? ""} ${m[3] ?? ""} `));
      }
      const lay = (id: string): PhanTu => (el[id] ??= taoPhanTu(false));
      const trangThai = { cookie: tuyChon.cookie, goi: [] as string[], thayUrl: [] as string[] };
      const loc = { pathname: trang === "mo-thau" ? "/login" : `/${trang}`, search: "", hash: tuyChon.hash };
      const ngheCuaSo: Nghe = {};
      const fetch = async (url: string, init: { method: string }) => {
        const lenh = `${init.method} ${url.replace(/^\/api/u, "")}`;
        trangThai.goi.push(lenh);
        const r = (await tuyChon.thay?.(lenh)) ?? (() => {
          if (lenh === "GET /me") return trangThai.cookie === null ? { status: 401, body: { error: "x" } } : { status: 200, body: trangThai.cookie };
          if (lenh === "POST /auth/redeem") return { status: 200, body: { needsEnrollment: false } };
          if (lenh === "POST /auth/totp") { trangThai.cookie = tuyChon.nguoiVao ?? B; return { status: 200, body: { ok: true } }; }
          if (lenh === "POST /auth/logout") {
            const co = trangThai.cookie !== null;
            trangThai.cookie = null;
            return co ? { status: 200, body: { ok: true } } : { status: 401, body: { error: "x" } };
          }
          if (lenh === "GET /policy/versions" && trangThai.cookie !== null) return { status: 200, body: { phienBan: [], daBat: false, choKy: false } };
          return { status: 401, body: { error: "x" } };
        })();
        return { status: r.status, text: () => Promise.resolve(JSON.stringify(r.body)) };
      };
      const thuVien = new Proxy(THU_VIEN, { get: (t, k: string) => (k in t ? t[k] : () => "") });
      runInNewContext(js, {
        __thuVien: thuVien,
        document: { getElementById: lay, createElement: () => taoPhanTu(false), body: taoPhanTu(false) },
        window: { addEventListener: (t: string, f: () => unknown) => { (ngheCuaSo[t] ??= []).push(f); } },
        location: loc,
        history: {
          replaceState: (_s: unknown, _t: string, url: string) => {
            trangThai.thayUrl.push(url);
            loc.hash = "";
          },
        },
        localStorage: { getItem: () => null, setItem: () => undefined },
        fetch, console, setTimeout, clearTimeout, URL, decodeURIComponent,
      }, { filename: `${trang}.js` });
      await cho();
      return {
        el: lay,
        trangThai,
        loc,
        buocMo: () => (BUOC[trang] ?? []).filter((b) => lay(b).hidden === false),
        bam: async (id: string) => {
          for (const f of lay(id).nghe["click"] ?? []) await f();
          await cho();
        },
        doiFragment: async (h: string) => {
          loc.hash = h;
          for (const f of ngheCuaSo["hashchange"] ?? []) await f();
          await cho();
        },
      };
    };

    for (const trang of Object.keys(BUOC)) {
      const tatCa = BUOC[trang] ?? [];

      it(`${trang}: có phiên còn hạn ⇒ HỎI, không tự mở; "Tiếp tục" mới mở, và câu báo không nói "vai"`, async () => {
        const p = await dungTrang(trang, { hash: "", cookie: A });
        expect(p.trangThai.goi).toEqual(["GET /me"]);
        expect(p.buocMo(), "không bước nào được tự mở dưới một phiên chưa ai nhận").toEqual([]);
        expect(p.el("hoi-phien").hidden).toBe(false);
        expect(p.el("hoi-phien").textContent).toContain("aaaaaaaa…");
        expect(p.el("nut-dung-phien").hidden).toBe(false);
        expect(p.el("nut-dang-xuat").hidden).toBe(false);
        await p.bam("nut-dung-phien");
        expect(p.buocMo()).toEqual(tatCa);
        expect(p.el("b1").lop.has("xong")).toBe(true);
        expect(p.el("hoi-phien").hidden).toBe(true);
        expect(p.el("nut-dung-phien").hidden).toBe(true);
        expect(p.el("nut-dang-xuat").hidden, "đang dùng phiên thì phải đăng xuất được").toBe(false);
        expect(p.el("ok1").textContent).toMatch(/Đang dùng phiên còn hạn của người dùng aaaaaaaa…/u);
        expect(p.el("ok1").textContent).not.toMatch(/vai/u);
      });

      it(`${trang}: "Đăng xuất" ở khối hỏi ⇒ POST /auth/logout, về bước 1, cookie không còn`, async () => {
        const p = await dungTrang(trang, { hash: "", cookie: A });
        await p.bam("nut-dang-xuat");
        expect(p.trangThai.goi).toEqual(["GET /me", "POST /auth/logout"]);
        expect(p.trangThai.cookie).toBeNull();
        expect(p.buocMo()).toEqual([]);
        expect(p.el("hoi-phien").hidden).toBe(true);
        expect(p.el("nut-dung-phien").hidden).toBe(true);
        expect(p.el("nut-dang-xuat").hidden).toBe(true);
        expect(p.el("ok1").textContent).toMatch(/Đã đăng xuất/u);
        // Nút "Tiếp tục" cũ không mở lại được phiên đã thu hồi.
        await p.bam("nut-dung-phien");
        expect(p.buocMo()).toEqual([]);
      });

      it(`${trang}: link mang mã (của người B) mở trong trình duyệt có phiên của A ⇒ KHÔNG hỏi /me — thứ tự docLink() rồi thuPhienCo() ở cấp tệp`, async () => {
        const p = await dungTrang(trang, { hash: `#${ORG}:maDangNhapCuaB`, cookie: A });
        expect(p.el("token").value).toBe("maDangNhapCuaB");
        expect(p.trangThai.goi).toEqual([]);
        expect(p.buocMo()).toEqual([]);
        expect(p.el("hoi-phien").hidden).toBe(true);
      });

      it(`${trang}: không cookie (401) hay mất mạng ⇒ ở lại bước 1, không khối hỏi`, async () => {
        const p = await dungTrang(trang, { hash: "", cookie: null });
        expect(p.trangThai.goi).toEqual(["GET /me"]);
        expect(p.buocMo()).toEqual([]);
        expect(p.el("hoi-phien").hidden).toBe(true);
        const q = await dungTrang(trang, { hash: "", cookie: A, thay: (l) => (l === "GET /me" ? Promise.reject(new Error("mat mang")) : undefined) });
        expect(q.buocMo()).toEqual([]);
        expect(q.el("hoi-phien").hidden).toBe(true);
      });

      it(`${trang}: /me 200 mà không có userId hay /me khác 200 mà có userId ⇒ không hỏi`, async () => {
        const p = await dungTrang(trang, { hash: "", cookie: A, thay: (l) => (l === "GET /me" ? Promise.resolve({ status: 200, body: { orgId: ORG } }) : undefined) });
        expect(p.el("hoi-phien").hidden).toBe(true);
        await p.bam("nut-dung-phien");
        expect(p.buocMo(), "phiên không có userId không được giữ chờ để mở").toEqual([]);
        const q = await dungTrang(trang, { hash: "", cookie: A, thay: (l) => (l === "GET /me" ? Promise.resolve({ status: 403, body: A }) : undefined) });
        expect(q.el("hoi-phien").hidden).toBe(true);
      });

      it(`${trang}: đăng nhập bằng link ⇒ xoá fragment đúng MỘT lần sau /auth/totp thành công; TOTP sai thì fragment ở lại`, async () => {
        const p = await dungTrang(trang, {
          hash: `#${ORG}:maCuaB`, cookie: null,
          thay: (l) => (l === "POST /auth/totp" && p.trangThai.goi.filter((g) => g === l).length === 1 ? Promise.resolve({ status: 401, body: { reason: "BAD_CODE" } }) : undefined),
        });
        p.el("ma").value = "123456";
        await p.bam("nut-vao");
        expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/totp"]);
        expect(p.trangThai.thayUrl, "mã chưa tiêu thụ thì chưa được xoá").toEqual([]);
        expect(p.loc.hash).toBe(`#${ORG}:maCuaB`);
        expect(p.buocMo()).toEqual([]);
        await p.bam("nut-vao");
        const sauTotp = p.trangThai.goi.lastIndexOf("POST /auth/totp");
        expect(p.trangThai.goi.slice(sauTotp)).toEqual(["POST /auth/totp", "GET /me", ...(trang === "chinh-sach" ? ["GET /policy/versions"] : [])]);
        expect(p.trangThai.thayUrl).toEqual([p.loc.pathname]);
        expect(p.loc.hash).toBe("");
        expect(p.buocMo()).toEqual(tatCa);
        expect(p.el("ok1").textContent).toMatch(/Đã vào với người dùng bbbbbbbb…/u);
        expect(p.el("nut-dang-xuat").hidden).toBe(false);
      });

      it(`${trang}: đã mở các bước rồi người khác mở link của mình trong CÙNG thẻ (hashchange) ⇒ các bước đóng, không hỏi lại`, async () => {
        const p = await dungTrang(trang, { hash: "", cookie: A });
        await p.bam("nut-dung-phien");
        expect(p.buocMo()).toEqual(tatCa);
        await p.doiFragment(`#${ORG}:maCuaB`);
        expect(p.buocMo()).toEqual([]);
        expect(p.el("b1").lop.has("xong")).toBe(false);
        expect(p.el("nut-dang-xuat").hidden).toBe(true);
        expect(p.el("hoi-phien").hidden).toBe(true);
        expect(p.trangThai.goi).toEqual(["GET /me", ...(trang === "chinh-sach" ? ["GET /policy/versions"] : [])]);
      });

      it(`${trang}: /me của lượt cũ về SAU khi fragment đã đổi sang link của B ⇒ bị bỏ, không mở khối hỏi`, async () => {
        let tha: () => void = () => undefined;
        const p = await dungTrang(trang, {
          hash: "", cookie: A,
          thay: (l) => (l === "GET /me" ? new Promise((r) => { tha = () => { r({ status: 200, body: A }); }; }) : undefined),
        });
        await p.doiFragment(`#${ORG}:maCuaB`);
        tha();
        await cho();
        expect(p.el("hoi-phien").hidden).toBe(true);
        expect(p.el("nut-dung-phien").hidden).toBe(true);
        expect(p.buocMo()).toEqual([]);
      });
    }

    it("mo-thau: tin báo người duyệt `/login#<mã tổ chức>` (không mã) trong trình duyệt có phiên ⇒ HỎI, không tự mở", async () => {
      const p = await dungTrang("mo-thau", { hash: `#${ORG}`, cookie: A });
      expect(p.el("org").value).toBe(ORG);
      expect(p.el("token").value).toBe("");
      expect(p.trangThai.goi).toEqual(["GET /me"]);
      expect(p.buocMo()).toEqual([]);
      expect(p.el("hoi-phien").hidden).toBe(false);
    });

    it("nop-thau: xoá fragment đúng MỘT lần sau /guest/otp/verify thành công; mã sai thì fragment ở lại", async () => {
      let lanXac = 0;
      const p = await dungTrang("nop-thau", {
        hash: `#${ORG}:maLoiMoi`, cookie: null,
        thay: (l) => {
          if (l === "POST /guest/redeem") return Promise.resolve({ status: 200, body: { linkChannel: "EMAIL", otpChannels: ["EMAIL"] } });
          if (l === "POST /guest/otp/verify") { lanXac += 1; return Promise.resolve(lanXac === 1 ? { status: 401, body: { error: "sai" } } : { status: 200, body: {} }); }
          return undefined;
        },
      });
      await p.bam("nut-mo");
      p.el("ma").value = "123456";
      await p.bam("nut-xac");
      expect(p.trangThai.thayUrl).toEqual([]);
      expect(p.loc.hash).toBe(`#${ORG}:maLoiMoi`);
      await p.bam("nut-xac");
      expect(p.trangThai.thayUrl).toEqual(["/nop-thau"]);
      expect(p.loc.hash).toBe("");
    });
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

  it("[khoản 196] phép tính giờ máy chủ ra JavaScript, còn nguyên phép đo lệch và phép đếm", async () => {
    const r = await goi("/lib/dong-ho-may-chu.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/javascript");
    expect(r.text).toContain("export function doLechMayChu");
    expect(r.text).toContain("export function conLaiMs");
    expect(r.text).not.toMatch(/from\s+["']node:/u);
  });

  it("[khoản 196] trang nộp thầu đếm theo giờ máy chủ: nó import phép tính ấy và đọc `gioMayChu`, không tự tính giờ", () => {
    const js = readFileSync(new URL("../trang/nop-thau.js", import.meta.url), "utf8");
    expect(js).toMatch(/from "\/lib\/dong-ho-may-chu\.js"/u);
    expect(js).toContain("gioMayChu");
    expect(js).toContain("gioPhanXu");
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

describe("[ADR-068] chế độ chỉ tĩnh — sau ALB", () => {
  it("`/api/*` ra 404 và KHÔNG gọi upstream nào; trang tĩnh vẫn phục vụ", async () => {
    const truoc = daNhan.length;
    const tinh = taoWebServer({ apiOrigin: null, tls: null });
    await new Promise<void>((xong) => tinh.listen(0, "127.0.0.1", xong));
    const goc = `http://127.0.0.1:${(tinh.address() as AddressInfo).port}`;
    for (const duong of ["/api", "/api/guest/session"]) {
      const res = await fetch(`${goc}${duong}`, { method: "POST", headers: { cookie: "a=b" }, body: "{}" });
      expect(res.status, duong).toBe(404);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    const trang = await fetch(`${goc}/nop-thau`);
    expect(trang.status).toBe(200);
    expect(daNhan.length).toBe(truoc);
    await new Promise<void>((xong) => tinh.close(() => xong()));
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

  /**
   * Viết một tệp `.js` THẬT vào `apps/web/trang/`, chạy eslint trên nó, rồi dọn — TRONG khoá
   * của khoản nợ **59**.
   *
   * Khoá không phải một phép phòng xa: bản đầu của hai probe này KHÔNG có nó, và CI ubuntu của
   * PR #107 đỏ với `ENOENT ... apps/web/trang/zzprobe-sink.js ... in apps/web/trang/zzprobe-sink.js`
   * ở `[INV-G1]` của `tests/architecture/boundaries.test.ts` — lượt cruise TOÀN KHO liệt kê tệp
   * probe rồi đọc nó sau khi `finally` đã xoá. Thư mục `apps/web/trang/` NẰM TRONG mục tiêu
   * cruise (`packages apps tools tests db`), nên một tệp thật ở đó là tài nguyên DÙNG CHUNG.
   */
  // [S1.118] BẤT ĐỒNG BỘ: bản đồng bộ ngủ chặn event loop của worker trong lúc probe `g9-` ở
  // `apps/api/src/routes.test.ts` giữ khoá (tới 131 giây trên CI) — lời gọi RPC `onTaskUpdate` của vitest
  // hết hạn và job ubuntu đỏ dù MỌI test đều qua (PR #118, #119, #121). Xem GIỚI HẠN ở `khoa-depcruise.ts`.
  async function voiTepProbe(ten: string, noiDung: string, do_: (duong: string) => Promise<void>): Promise<void> {
    const duong = join(GOC_KHO, `apps/web/trang/${ten}`);
    await voiKhoaDepcruiseAsync(async () => {
      writeFileSync(duong, noiDung);
      try {
        await do_(`apps/web/trang/${ten}`);
      } finally {
        rmSync(duong, { force: true });
      }
    });
  }

  /** eslint trên một tệp, trả STDOUT — eslint thoát khác 0 khi có lỗi, và STDOUT vẫn là thứ cần đọc. */
  function chayEslint(duongTuongDoi: string): Promise<string> {
    return new Promise((xong) => {
      execFile("npx", ["eslint", duongTuongDoi], { cwd: GOC_KHO, encoding: "utf8", shell: true }, (_loi, stdout) =>
        xong(String(stdout ?? "")),
      );
    });
  }

  it("một tệp gán `innerHTML` trong `apps/web/trang/` làm eslint ĐỎ — và đỏ vì ĐÚNG luật ấy", async () => {
    await voiTepProbe(
      "zzprobe-sink.js",
      `const el = document.getElementById("x");
el.innerHTML = "<b>" + location.hash + "</b>";
`,
      async (duong) => {
        const ra = await chayEslint(duong);
        expect(ra, "eslint KHÔNG đỏ trên một tệp gán innerHTML — luật không có răng").toContain(
          "no-restricted-properties",
        );
        expect(ra).toContain("innerHTML");
      },
    );
  }, TRAN_TEST_GIU_KHOA_MS);

  it("ĐỐI CHỨNG ÂM: cùng tệp ấy dựng DOM bằng `textContent` thì eslint XANH", async () => {
    // Không có vế này, vế trên xanh y hệt với một cấu hình làm đỏ MỌI tệp trong thư mục.
    await voiTepProbe(
      "zzprobe-sach.js",
      `const el = document.getElementById("x");
el.replaceChildren();
el.textContent = location.hash;
`,
      async (duong) => {
        expect((await chayEslint(duong)).trim(), "một tệp sạch mà eslint vẫn kêu — luật quá rộng").toBe("");
      },
    );
  }, TRAN_TEST_GIU_KHOA_MS);
});
