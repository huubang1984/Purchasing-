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
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// [khoản nợ 59] Hai probe ở cuối tệp viết một tệp `.js` THẬT vào `apps/web/trang/`, và thư mục
// ấy NẰM TRONG mục tiêu cruise (`packages apps tools tests db`). Khoá này là thứ giữ chúng không
// giẫm lên lượt cruise toàn kho của `tests/architecture/boundaries.test.ts` — xem khối lý do đầy
// đủ trong chính tệp khoá, và xem mục 7c của §S1.107 để biết vì sao dòng này có mặt.
import { TRAN_TEST_GIU_KHOA_MS, voiKhoaDepcruiseAsync } from "../../../tests/architecture/khoa-depcruise.js";
import * as benchmarkWeb from "./benchmark.js";
import * as chinhSach from "./chinh-sach.js";
import * as dangNhap from "./dang-nhap.js";
import * as duLieu from "./du-lieu.js";
import * as taoThau from "./tao-thau.js";
import * as nhomHang from "./nhom-hang.js";
import * as nhaCungCap from "./nha-cung-cap.js";
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
  // [S1.176 / ADR-107] HÌNH DẠNG LINK CỦA BỘ GỬI PHẢI LÀ HÌNH DẠNG TRANG ĐÍCH ĐỌC ĐƯỢC
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

  it("[ADR-107] docLink() của ~~bốn~~ [S1.199] năm trang đọc `<orgId>:<token>`; trang /login đọc thêm `<orgId>` trơn và xoá ô mã", () => {
    const ORG = "11111111-1111-4111-8111-111111111111";
    const chay = (trang: string, hash: string, truoc: { org: string; token: string }) => {
      const js = readFileSync(new URL(`../trang/${trang}.js`, import.meta.url), "utf8");
      const ham = /^function docLink\(\) \{[\s\S]*?^\}/mu.exec(js)?.[0];
      expect(ham, `${trang}.js không còn hàm docLink`).toBeDefined();
      // `/login` dùng hằng `LA_UUID` ~~chung của trang~~ [S1.240 / khoản 282] import từ `/lib/dang-nhap.js` — MỘT bản với phép đọc ô
      // tổ chức của bước 1 bốn trang; ba trang kia không dùng nó.
      const o = { org: { value: truoc.org }, token: { value: truoc.token } };
      runInNewContext(`${ham ?? ""}\ndocLink();`, { $: (id: "org" | "token") => o[id], location: { hash }, decodeURIComponent, LA_UUID: dangNhap.LA_UUID });
      return { org: o.org.value, token: o.token.value };
    };
    for (const trang of ["mo-thau", "tao-thau", "chinh-sach", "nop-thau", "du-lieu", "nha-cung-cap"]) {
      expect(chay(trang, `#${ORG}:tokTokTokTokTokTok_-1`, { org: "", token: "" }), trang).toEqual({ org: ORG, token: "tokTokTokTokTokTok_-1" });
    }
    expect(chay("mo-thau", `#${ORG}`, { org: "", token: "ma-cu-cua-nguoi-truoc" })).toEqual({ org: ORG, token: "" });
    expect(chay("mo-thau", "#chiCoMaTronKhongCoToChuc", { org: "go-tay", token: "" })).toEqual({ org: "go-tay", token: "chiCoMaTronKhongCoToChuc" });
  });

  it("[ADR-107] ô tổ chức của ~~/login~~ [S1.240 / khoản 282] bốn trang người mua nhận nguyên một link cũ dán vào, và nói đúng khi mã sai hình dạng", () => {
    const ORG = "11111111-1111-4111-8111-111111111111";
    // [S1.240 / khoản 282] Phép đọc từng là `docToChuc()` riêng của `mo-thau.js` (vế này trích nó bằng regex); nay là
    // `docMaToChuc` của `/lib/dang-nhap.js` — bước 1 của bốn trang và ô xin link của `/login` đọc qua CÙNG hàm ấy.
    const doc = dangNhap.docMaToChuc;
    expect(doc(ORG)).toBe(ORG);
    expect(doc(`  https://mua.vidu.vn/login#${ORG}:tokTokTokTokTokTok_-1 `)).toBe(ORG);
    expect(doc(`#${ORG}`)).toBe(ORG);
    expect(doc("")).toBe("");
    expect(doc("cong-ty-a")).toBeNull();
    const js = readFileSync(new URL("../trang/mo-thau.js", import.meta.url), "utf8");
    expect(js, "mo-thau.js còn một bản đọc ô tổ chức thứ hai").not.toMatch(/function docToChuc\(/u);
    expect(js, "ô xin link của /login không đọc qua docMaToChuc").toMatch(/docMaToChuc\(\$\("org"\)\.value\)/u);
  });

  // ============================================================================================
  // [S1.177] BA TRANG NGƯỜI MUA HỎI LẠI PHIÊN CÒN HẠN LÚC TẢI, VÀ BỐN TRANG XOÁ MÃ KHỎI THANH ĐỊA CHỈ SAU KHI DÙNG
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
  describe("[S1.177] hỏi lại phiên lúc tải, đăng xuất, đổi người, và xoá fragment sau khi dùng mã", () => {
    const BUOC: Record<string, readonly string[]> = {
      "mo-thau": ["b2", "b3", "b4", "b5", "b6", "b7", "b8"],
      "tao-thau": ["b2", "b3", "b4", "b5"],
      "chinh-sach": ["b2", "b3"],
      // [S1.199 / S4.2b] Bước 3 (tạo hàng chuẩn) mở vì `GET /items` giả trả `choGhi`; bước 4 chỉ mở khi bấm Xem một hàng.
      // [S1.234 / S4.3b] Bước 6 (hàng đợi ánh xạ) mở cho mọi người mua đã vào.
      "du-lieu": ["b2", "b3", "b5", "b6"],
      // [S1.201 / S3.6a] Màn nhóm hàng — cùng khuôn đăng nhập và phiên với ba trang người mua kia.
      "nhom-hang": ["b2", "b3"],
      // [S1.9101 / S3.3e1] Màn xác minh nhà cung cấp — cùng khuôn đăng nhập và phiên.
      "nha-cung-cap": ["b2"],
    };
    /**
     * Lời gọi mỗi trang tự đi sau khi mở các bước — trước lượt đo riêng của từng trang. [S1.240 / khoản 282] Bốn trang người mua
     * hỏi link đăng nhập gần đây của chính mình (`/lib/dang-nhap.js`) ngay khi các bước mở, TRƯỚC lời gọi riêng của trang.
     */
    const SAU_MO: Record<string, readonly string[]> = {
      "chinh-sach": ["GET /auth/login-links", "GET /policy/versions"],
      // [S1.9101 / S3.3e1] …rồi ô chọn nhà cung cấp có sẵn (`GET /suppliers`, không cổng) ở cả hai luồng.
      "tao-thau": ["GET /auth/login-links", "GET /policy/versions", "GET /suppliers"],
      "nhom-hang": ["GET /auth/login-links", "GET /categories"],
      "nha-cung-cap": ["GET /auth/login-links", "GET /supplier-verifications"],
      // [S1.199 / S4.2b] Màn dữ liệu nền nạp danh sách hàng chuẩn rồi danh mục đơn vị.
      // [S1.234 / S4.3b] …rồi hàng đợi ánh xạ.
      // [S1.249 / khoản 291] Bước 1 của `/du-lieu` nay là `/lib/dang-nhap.js`: link đăng nhập gần đây TRƯỚC lời gọi riêng của màn.
      "du-lieu": ["GET /auth/login-links", "GET /items", "GET /uom", "GET /mapping-queue"],
      // [S1.216 / khoản 195] `/login` hỏi link đăng nhập gần đây của chính mình sau khi các bước mở.
      "mo-thau": ["GET /auth/login-links"],
    };
    const ORG = "11111111-2222-4333-8444-555555555555";
    const A = { userId: "aaaaaaaa-0000-4000-8000-000000000000", sessionId: "s-a", orgId: ORG, kind: "USER" };
    const B = { userId: "bbbbbbbb-0000-4000-8000-000000000000", sessionId: "s-b", orgId: ORG, kind: "USER" };
    type Phien = typeof A;
    type Nghe = Record<string, Array<() => unknown>>;
    interface PhanTu {
      hidden: boolean; textContent: string; value: string; disabled: boolean; checked: boolean; className: string;
      dataset: Record<string, string>; lop: Set<string>; nghe: Nghe;
      /** [S1.181] Con đã `append` — để đọc được bảng gói thầu (dt/dd). `replaceChildren` xoá nó. */
      con: PhanTu[];
      classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
      addEventListener: (t: string, f: () => unknown) => void;
      replaceChildren: () => void; append: (...c: PhanTu[]) => void; appendChild: () => void; setAttribute: () => void;
      querySelector: (sel: string) => PhanTu; querySelectorAll: () => PhanTu[]; focus: () => void; remove: () => void;
      scrollIntoView: () => void;
      /**
       * [S1.193 / S3.2c2] `Element.before` — `/tao-thau` dời bước lời mời lên trước bước duyệt ở tổ chức đã bật, THẬT trong DOM.
       * Chỉ các `<section>` của trang có bản thật (dời id trong thứ tự của trang); gọi trên phần tử khác là trang làm điều test
       * không đo — ném.
       */
      before: (...c: PhanTu[]) => void;
      /** Id đọc từ HTML (rỗng với phần tử `createElement`) — để `before` biết nó dời gì. */
      id: string;
    }
    const taoPhanTu = (hidden: boolean, id = ""): PhanTu => {
      const lop = new Set<string>();
      const nghe: Nghe = {};
      // [S1.181 / lượt soi] Cùng bộ chọn thì cùng phần tử — như trình duyệt. Bản trước trả một phần tử MỚI mỗi lần gọi, nên
      // `tbody` mà trang xoá và `tbody` mà test đọc là hai đối tượng khác nhau: bảng giá không đo được.
      const qs: Record<string, PhanTu> = {};
      const e: PhanTu = {
        hidden, textContent: "", value: "", disabled: false, checked: false, className: "", dataset: {}, lop, nghe, con: [],
        classList: { add: (c) => { lop.add(c); }, remove: (c) => { lop.delete(c); }, contains: (c) => lop.has(c) },
        addEventListener: (t, f) => { (nghe[t] ??= []).push(f); },
        replaceChildren: () => { e.textContent = ""; e.con.length = 0; }, append: (...c) => { e.con.push(...c); },
        appendChild: () => undefined, setAttribute: () => undefined,
        querySelector: (sel) => (qs[sel] ??= taoPhanTu(false)), querySelectorAll: () => [], focus: () => undefined, remove: () => undefined,
        scrollIntoView: () => undefined,
        before: () => { throw new Error(`before() gọi trên phần tử không phải section: "${id}"`); },
        id,
      };
      return e;
    };
    // `/lib/chinh-sach.js` và `/lib/tao-thau.js` là bản thật (`dienMau` vẽ bảng bậc mặc định); mọi tên import khác là một
    // hàm trả chuỗi rỗng.
    const THU_VIEN: Record<string, unknown> = {
      ...chinhSach,
      // [S1.201 / S3.6a] `/lib/nhom-hang.js` là bản thật: ô chọn nhóm hàng của `/tao-thau` và bảng của `/nhom-hang` đọc từ nó.
      ...nhomHang,
      // [S1.191 / S3.2c2] `/lib/tao-thau.js` cũng là bản thật: nút của dòng lời mời và câu báo đọc từ nó.
      ...taoThau,
      // [S1.199 / S4.2b] `/lib/du-lieu.js` cũng là bản thật: câu §8.10 và bộ lọc đọc từ nó.
      ...duLieu,
      // [S1.9101 / S3.3e1] `/lib/nha-cung-cap.js` là bản thật: trạng thái xác minh, người liên hệ và nút của `/nha-cung-cap`.
      ...nhaCungCap,
      // [S1.260 / S4.5c1] `/lib/benchmark.js` là bản thật: chữ nhãn, thành phần, độ phủ và chữ dải của `/mo-thau` đọc từ nó.
      ...benchmarkWeb,
      // [S1.240 / khoản 282] `/lib/dang-nhap.js` là bản thật: bước 1 (Tiếp, Vào, khối link gần đây) của bốn trang người mua chạy từ
      // nó — nhận `document`, `goi`, `history`, `location` giả mà trang trao vào, nên chạy được ở realm của test.
      ...dangNhap,
      // [S1.181] Đường "Niêm phong và nộp" chạy tới lời gọi POST /guest/bids và vẽ biên nhận: phong bì rỗng, mô tả tối thiểu.
      sealBid: () => Promise.resolve(new Uint8Array(0)),
      chooseKeyAgreementAlgorithm: () => "ECDH_P256",
      describeEnvelope: () => ({ formatVersion: 1, algorithm: "ECDH_P256", ephemeralPublicKey: new Uint8Array(0) }),
    };
    const cho = () => new Promise((r) => { setTimeout(r, 5); });
    const GOI_THAU_KHACH = {
      rfq: { id: "r-1", title: "Mua thép tấm quý IV", status: "OPEN", deadlineAt: "2099-01-01T00:00:00Z" },
      // [S1.181 / ADR-109] Tên doanh nghiệp được mời — `GET /guest/rfq` nay mang nó.
      supplier: { legalName: "Công ty Thép Miền Bắc" },
      items: [{ lineNo: 1, description: "Thép tấm", quantity: "10", unit: "tấn" }],
      publicKeys: [], bafoRound: null, gioMayChu: "2026-09-27T00:00:00Z",
    };

    interface TuyChon {
      hash: string;
      cookie: Phien | null;
      /** [S1.178] Trình duyệt có giữ cookie khách `__Host-tp_guest` còn hạn không (trang nộp thầu). */
      khach?: boolean;
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
        el[m[2] ?? ""] = taoPhanTu(/\shidden(?:\s|$)/u.test(`${m[1] ?? ""} ${m[3] ?? ""} `), m[2] ?? "");
      }
      // [S1.193 / S3.2c2] Thứ tự các `<section>` trong DOM, như HTML khai; `before` của mỗi section dời id trong mảng này và
      // đếm một lần dời.
      const thuTuSection = [...html.matchAll(/<section\b[^>]*\sid="([^"]+)"/gu)].map((m) => m[1] ?? "");
      let soLanDoi = 0;
      for (const id of thuTuSection) {
        const sec = el[id];
        if (sec === undefined) continue;
        sec.before = (...c) => {
          for (const x of c) {
            const tu = thuTuSection.indexOf(x.id);
            if (tu < 0) throw new Error(`before(): "${x.id}" không phải section`);
            thuTuSection.splice(tu, 1);
            thuTuSection.splice(thuTuSection.indexOf(id), 0, x.id);
            soLanDoi += 1;
          }
        };
      }
      const lay = (id: string): PhanTu => (el[id] ??= taoPhanTu(false, id));
      const trangThai = {
        cookie: tuyChon.cookie, khach: tuyChon.khach === true, goi: [] as string[], thayUrl: [] as string[], xoaHen: [] as unknown[],
        /** [S1.201 / S3.6a] Thân của từng lời gọi, theo thứ tự — để đo trang GỬI gì, không chỉ gọi gì. */
        than: [] as { lenh: string; than: unknown }[],
      };
      const loc = { pathname: trang === "mo-thau" ? "/login" : `/${trang}`, search: "", hash: tuyChon.hash };
      const ngheCuaSo: Nghe = {};
      const fetch = async (url: string, init: { method: string; body?: string }) => {
        const lenh = `${init.method} ${url.replace(/^\/api/u, "")}`;
        trangThai.goi.push(lenh);
        trangThai.than.push({ lenh, than: init.body === undefined ? undefined : JSON.parse(init.body) });
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
          if (lenh === "GET /items" && trangThai.cookie !== null) return { status: 200, body: { hangChuan: [], conNua: false, choGhi: true, soNguoiQuanLy: 1 } };
          if (lenh === "GET /uom" && trangThai.cookie !== null) return { status: 200, body: { donVi: [], biDanhChung: [], biDanhToChuc: [] } };
          if (lenh === "GET /mapping-queue" && trangThai.cookie !== null) return { status: 200, body: { dong: [], conNua: false } };
          if (lenh === "GET /categories" && trangThai.cookie !== null) return { status: 200, body: { nhomHang: [] } };
          // [S1.9101 / S3.3e1] Ô chọn nhà cung cấp của `/tao-thau` và bảng hồ sơ của `/nha-cung-cap` — rỗng theo mặc định.
          if (lenh === "GET /suppliers" && trangThai.cookie !== null) return { status: 200, body: { suppliers: [] } };
          if (lenh === "GET /supplier-verifications" && trangThai.cookie !== null) return { status: 200, body: { hoSo: [] } };
          if (lenh === "GET /auth/login-links" && trangThai.cookie !== null) return { status: 200, body: { loginLinks: [] } };
          if (lenh === "GET /guest/rfq" && trangThai.khach) return { status: 200, body: GOI_THAU_KHACH };
          if (lenh === "POST /guest/logout") {
            const co = trangThai.khach;
            trangThai.khach = false;
            return co ? { status: 200, body: { ok: true } } : { status: 401, body: { error: "x" } };
          }
          if (lenh === "POST /guest/otp/verify") { trangThai.khach = true; return { status: 200, body: {} }; }
          return { status: 401, body: { error: "x" } };
        })();
        return { status: r.status, text: () => Promise.resolve(JSON.stringify(r.body)) };
      };
      const thuVien = new Proxy(THU_VIEN, { get: (t, k: string) => (k in t ? t[k] : () => "") });
      runInNewContext(js, {
        __thuVien: thuVien,
        document: { getElementById: lay, createElement: () => taoPhanTu(false), body: taoPhanTu(false) },
        window: {
          addEventListener: (t: string, f: () => unknown) => { (ngheCuaSo[t] ??= []).push(f); },
          // Đếm ngược của trang nộp thầu: không cần chạy thật, chỉ cần không ném và không để hẹn giờ treo test.
          setInterval: () => 1, clearInterval: (h: unknown) => { trangThai.xoaHen.push(h); },
        },
        location: loc,
        history: {
          replaceState: (_s: unknown, _t: string, url: string) => {
            trangThai.thayUrl.push(url);
            loc.hash = "";
          },
        },
        localStorage: { getItem: () => null, setItem: () => undefined },
        // [S1.181] `crypto.subtle` có mặt để trang không dừng ở câu "trình duyệt không có crypto.subtle".
        crypto: { subtle: { generateKey: () => Promise.resolve({}) } },
        fetch, console, setTimeout, clearTimeout, URL, decodeURIComponent, atob, btoa, TextEncoder,
      }, { filename: `${trang}.js` });
      await cho();
      return {
        el: lay,
        trangThai,
        loc,
        buocMo: () => (BUOC[trang] ?? []).filter((b) => lay(b).hidden === false),
        /** [S1.193 / S3.2c2] Thứ tự THẬT của các `<section>` trong DOM, và số lần trang đã dời một section. */
        thuTuSection: () => [...thuTuSection],
        soLanDoi: () => soLanDoi,
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
        expect(p.trangThai.goi.slice(sauTotp)).toEqual(["POST /auth/totp", "GET /me", ...(SAU_MO[trang] ?? [])]);
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
        expect(p.trangThai.goi).toEqual(["GET /me", ...(SAU_MO[trang] ?? [])]);
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

    // ==========================================================================================
    // [S1.230 / khoản 193] BƯỚC 1 CỦA `/login` TÁCH «LẤY BÍ MẬT GHI DANH» KHỎI «VÀO»
    //
    // Bản cũ gộp hai việc khác hẳn nhau vào một nút: bấm Vào là gọi `/auth/redeem`, và nếu tài
    // khoản chưa ghi danh thì bí mật TOTP hiện ra CÙNG chỗ với câu lỗi — nên lần bấm đầu của mọi
    // người mới là một lần trượt, và màn hình không nói nó đang xin thứ gì (chủ dự án đưa nhầm mã
    // đăng nhập thay vì bí mật, đo ngày 2026-09-20). Nay: ô mã sáu số ẨN cho tới khi máy chủ đã
    // nói tài khoản này cần ghi danh hay không; nút Tiếp gọi `/auth/redeem` đúng một lần cho mỗi
    // mã đăng nhập và hiện bí mật kèm nhãn nói rõ nó KHÔNG phải mã đăng nhập; Vào chỉ còn là Vào.
    // ~~Ba trang người mua kia (`tao-thau`, `nhom-hang`, `chinh-sach`) chép cùng khối cũ — khoản 282.~~
    // [S1.240 / khoản 282] Nay bước 1 là MỘT module, `/lib/dang-nhap.js`, mà bốn trang người mua import và gắn vào CÙNG bộ id
    // (chủ dự án chốt cách ⒝ ngày 2026-09-30) — nên sáu ca dưới chạy trên cả bốn trang, cộng một ca mới: ô tổ chức sai hình dạng
    // nói đúng câu và không gọi máy chủ (phép đọc của `/login` nay là của cả bốn). Đo trước trên cây cũ: ba trang kia đỏ ở mọi ca
    // cần nút Tiếp hay ô mã ẩn.
    // [S1.249 / khoản 291] Trang thứ năm: `/du-lieu` (S4.2b) từng chép nút Vào cũ — cùng khiếm khuyết 193, mà phép đếm của 282 bỏ
    // sót — nay gắn cùng module; ba khối DOM dưới (193, 195, 268) chạy trên năm trang. Đo trước trên cây cũ: `/du-lieu` đỏ ở mọi ca
    // cần nút Tiếp, ô mã ẩn, câu ghi danh mới hay khối link gần đây.
    // ==========================================================================================
    // [S1.240 / khoản 282] ~~Bốn trang người mua~~ [S1.249 / khoản 291] Năm trang người mua — cùng một bước 1 (`/lib/dang-nhap.js`),
    // cùng bộ id. ~~`BON_TRANG`~~ đổi tên theo số trang.
    // [S1.9101 / S3.3e1] Sáu trang: `/nha-cung-cap` cùng bước 1 (`/lib/dang-nhap.js`) — tên hằng giữ để không đổi mọi chỗ gọi.
    const NAM_TRANG = ["mo-thau", "tao-thau", "nhom-hang", "chinh-sach", "du-lieu", "nha-cung-cap"] as const;
    /** Các cặp dt/dd đã vẽ vào `link-gan-day` (khối link đăng nhập gần đây — khoản 195, 268). */
    const capLink = (p: { el: (id: string) => PhanTu }): [string, string][] => {
      const con = p.el("link-gan-day").con;
      const ra: [string, string][] = [];
      for (let i = 0; i + 1 < con.length; i += 2) ra.push([con[i]?.textContent ?? "", con[i + 1]?.textContent ?? ""]);
      return ra;
    };

    describe("[S1.230 / khoản 193 · S1.240 / khoản 282 · S1.249 / khoản 291] bước 1 tách «lấy bí mật ghi danh» khỏi «vào» — năm trang người mua", () => {
      const BI_MAT = "JBSWY3DPEHPK3PXP";
      const CHUA_GHI_DANH = { status: 200, body: { needsEnrollment: true, totpSecretBase32: BI_MAT, issuer: "TrustProcure" } };
      const ghiDanh = (l: string) => (l === "POST /auth/redeem" ? Promise.resolve(CHUA_GHI_DANH) : undefined);
      // [S1.249 / khoản 292] Dụng cụ của bốn ca «phản hồi về muộn» ở cuối vòng dưới.
      interface PhanHoi { status: number; body: unknown }
      type Trang = Awaited<ReturnType<typeof dungTrang>>;
      /**
       * Giữ mọi `/auth/redeem`: `ds[i]` là lời gọi thứ i — `tha` trả phản hồi, `nem` là mất mạng. [S1.250 / khoản 310] ~~Chỉ
       * `/auth/redeem`~~ Mọi lời gọi mang lệnh `lenh` (`giuLenh`); `giuRedeem` là `giuLenh("POST /auth/redeem")`.
       */
      const giuLenh = (lenh: string) => {
        const ds: { tha: (r: PhanHoi) => void; nem: () => void }[] = [];
        const thay = (l: string): Promise<PhanHoi> | undefined =>
          l === lenh
            ? new Promise<PhanHoi>((tha, nem) => { ds.push({ tha, nem: () => { nem(new Error("mat mang")); } }); })
            : undefined;
        return { ds, thay };
      };
      const giuRedeem = () => giuLenh("POST /auth/redeem");
      /** Bấm mà KHÔNG đợi trình nghe xong — lời gọi của nó đang bị giữ; trả lượt bấm để đợi sau khi thả. */
      const bamGiu = (p: Trang, id: string): Promise<unknown> => Promise.resolve(p.el(id).nghe["click"]?.[0]?.());
      const maDaGui = (p: Trang): unknown[] =>
        p.trangThai.than.filter((t) => t.lenh === "POST /auth/redeem").map((t) => (t.than as { token?: unknown }).token);
      const canGhiDanh = (biMat: string): PhanHoi => ({ status: 200, body: { needsEnrollment: true, totpSecretBase32: biMat, issuer: "TrustProcure" } });
      /** Phản hồi của lượt cũ không vẽ gì: không khối bí mật, không ô mã sáu số, không câu lỗi. */
      const khongVeGi = (p: Trang): void => {
        expect(p.el("ghi-danh").hidden, "khối bí mật ghi danh mở theo phản hồi của mã cũ").toBe(true);
        expect(p.el("khoi-ma").hidden, "ô mã sáu số mở theo phản hồi của mã cũ").toBe(true);
        expect(p.el("loi1").hidden, "câu lỗi của lượt cũ đè lên lượt mới").toBe(true);
      };

      for (const trang of NAM_TRANG) {
        it(`${trang}: lúc tải: ô mã sáu số ẨN, nút Tiếp hiện, không bí mật nào trên màn, không gọi máy chủ khi link mang mã`, async () => {
          const p = await dungTrang(trang, { hash: `#${ORG}:maMoi`, cookie: null });
          expect(p.el("khoi-ma").hidden, "ô mã sáu số phải ẩn cho tới khi biết needsEnrollment").toBe(true);
          expect(p.el("nut-ghi-danh").hidden).toBe(false);
          expect(p.el("ghi-danh").hidden).toBe(true);
          expect(p.trangThai.goi).toEqual([]);
        });

        it(`${trang}: người mới: Tiếp ⇒ đúng MỘT POST /auth/redeem, KHÔNG /auth/totp, không câu lỗi; bí mật hiện kèm nhãn «không phải mã đăng nhập»; ô mã mở; Tiếp lần nữa không gọi lại; Vào ⇒ totp rồi /me`, async () => {
          const p = await dungTrang(trang, { hash: `#${ORG}:maMoi`, cookie: null, thay: ghiDanh });
          await p.bam("nut-ghi-danh");
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem"]);
          expect(p.trangThai.than[0]?.than).toEqual({ orgId: ORG, token: "maMoi" });
          expect(p.el("loi1").hidden, "lấy bí mật không phải một lần trượt").toBe(true);
          expect(p.el("ghi-danh").hidden).toBe(false);
          expect(p.el("ghi-danh").textContent).toContain(BI_MAT);
          expect(p.el("ghi-danh").textContent).toMatch(/ứng dụng xác thực/u);
          expect(p.el("ghi-danh").textContent).toMatch(/KHÔNG phải mã đăng nhập/u);
          expect(p.el("khoi-ma").hidden).toBe(false);
          expect(p.buocMo()).toEqual([]);
          // Bấm Tiếp lần nữa với cùng mã: KHÔNG gọi lại — mỗi lần `/auth/redeem` là một bí mật MỚI ở
          // máy chủ — và bí mật đã hiện vẫn ở nguyên trên màn.
          await p.bam("nut-ghi-danh");
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem"]);
          expect(p.el("ghi-danh").textContent).toContain(BI_MAT);
          p.el("ma").value = "123456";
          await p.bam("nut-vao");
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/totp", "GET /me", ...(SAU_MO[trang] ?? [])]);
          expect(p.trangThai.than[1]?.than).toEqual({ orgId: ORG, token: "maMoi", code: "123456" });
          expect(p.buocMo()).toEqual(BUOC[trang]);
          expect(p.el("ok1").textContent).toMatch(/Đã vào với người dùng bbbbbbbb…/u);
        });

        it(`${trang}: người đã ghi danh: Tiếp ⇒ một redeem, KHÔNG bí mật nào trên màn, ô mã mở kèm câu nói nhập mã sáu số`, async () => {
          const p = await dungTrang(trang, { hash: `#${ORG}:maCu`, cookie: null });
          await p.bam("nut-ghi-danh");
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem"]);
          expect(p.el("ghi-danh").hidden).toBe(true);
          expect(p.el("khoi-ma").hidden).toBe(false);
          expect(p.el("loi1").hidden).toBe(true);
          expect(p.el("ok1").hidden).toBe(false);
          expect(p.el("ok1").textContent).toMatch(/mã sáu số/u);
        });

        it(`${trang}: mã đăng nhập bị từ chối (401) hay mất mạng ⇒ câu ở loi1, ô mã sáu số VẪN ẨN, không totp; thiếu tổ chức hay tổ chức sai hình dạng ⇒ không gọi gì`, async () => {
          const p = await dungTrang(trang, { hash: `#${ORG}:maHong`, cookie: null, thay: (l) => (l === "POST /auth/redeem" ? Promise.resolve({ status: 401, body: { error: "ma dang nhap khong dung duoc" } }) : undefined) });
          await p.bam("nut-ghi-danh");
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem"]);
          expect(p.el("loi1").textContent).toBe("ma dang nhap khong dung duoc");
          expect(p.el("khoi-ma").hidden).toBe(true);
          expect(p.el("ghi-danh").hidden).toBe(true);
          const q = await dungTrang(trang, { hash: `#${ORG}:maHong`, cookie: null, thay: (l) => (l === "POST /auth/redeem" ? Promise.reject(new Error("mat mang")) : undefined) });
          await q.bam("nut-ghi-danh");
          expect(q.el("loi1").textContent).toMatch(/Không kết nối được máy chủ/u);
          expect(q.el("khoi-ma").hidden).toBe(true);
          expect(q.el("nut-ghi-danh").disabled, "nút phải bật lại sau khi lỗi").toBe(false);
          const r = await dungTrang(trang, { hash: "#chiCoMa", cookie: null });
          await r.bam("nut-ghi-danh");
          expect(r.trangThai.goi).toEqual([]);
          expect(r.el("loi1").textContent).toMatch(/Cần cả mã tổ chức và mã đăng nhập/u);
          // [S1.240 / khoản 282] Ô tổ chức sai hình dạng: câu nói hình dạng đúng (ADR-107), không một lời gọi — cả hai nút.
          const s = await dungTrang(trang, { hash: "#cong-ty-a:maX", cookie: null });
          await s.bam("nut-ghi-danh");
          s.el("ma").value = "123456";
          await s.bam("nut-vao");
          expect(s.trangThai.goi).toEqual([]);
          expect(s.el("loi1").textContent).toMatch(/^Mã tổ chức có dạng /u);
        });

        it(`${trang}: Vào mà bỏ qua Tiếp, tài khoản chưa ghi danh ⇒ redeem, hiện bí mật, DỪNG — không /auth/totp với một mã không thể đúng`, async () => {
          const p = await dungTrang(trang, { hash: `#${ORG}:maMoi`, cookie: null, thay: ghiDanh });
          p.el("ma").value = "123456";
          await p.bam("nut-vao");
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem"]);
          expect(p.el("ghi-danh").textContent).toContain(BI_MAT);
          expect(p.el("khoi-ma").hidden).toBe(false);
          expect(p.el("loi1").hidden).toBe(true);
          expect(p.buocMo()).toEqual([]);
        });

        it(`${trang}: đổi mã đăng nhập (dán mã khác, hashchange, đăng xuất) ⇒ ô mã sáu số đóng và rỗng, bí mật cũ xoá; Tiếp ⇒ redeem cho mã MỚI`, async () => {
          let lan = 0;
          const p = await dungTrang(trang, {
            hash: `#${ORG}:maMoi`, cookie: null,
            // Lần redeem đầu: chưa ghi danh (bí mật hiện). Các lần sau: đã ghi danh.
            thay: (l) => (l === "POST /auth/redeem" && ++lan === 1 ? Promise.resolve(CHUA_GHI_DANH) : undefined),
          });
          await p.bam("nut-ghi-danh");
          expect(p.el("ghi-danh").textContent).toContain(BI_MAT);
          p.el("ma").value = "111111";
          // Người thứ hai dán mã của mình rồi bấm Tiếp.
          p.el("token").value = "maKhac";
          await p.bam("nut-ghi-danh");
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/redeem"]);
          expect(p.trangThai.than[1]?.than).toEqual({ orgId: ORG, token: "maKhac" });
          expect(p.el("ghi-danh").hidden, "bí mật của người trước không được đứng lại").toBe(true);
          expect(p.el("ma").value).toBe("");
          expect(p.el("khoi-ma").hidden).toBe(false);
          // Link của người thứ ba trong cùng thẻ.
          await p.doiFragment(`#${ORG}:maBa`);
          expect(p.el("khoi-ma").hidden).toBe(true);
          expect(p.el("ghi-danh").hidden).toBe(true);
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/redeem"]);
          // Đăng xuất từ một phiên đã mở cũng đóng ô mã.
          const q = await dungTrang(trang, { hash: `#${ORG}:maCu`, cookie: null });
          await q.bam("nut-ghi-danh");
          q.el("ma").value = "123456";
          await q.bam("nut-vao");
          expect(q.buocMo()).toEqual(BUOC[trang]);
          await q.bam("nut-dang-xuat");
          expect(q.buocMo()).toEqual([]);
          expect(q.el("khoi-ma").hidden).toBe(true);
        });

        // ====================================================================================
        // [S1.249 / khoản 292] PHẢN HỒI `/auth/redeem` CỦA LƯỢT CŨ KHÔNG ĐƯỢC GẮN CHO MÃ MỚI
        //
        // `doiMaDangNhap` đặt `daRedeem` và vẽ SAU `await`. Tới trước vòng này, phản hồi của mã A về muộn — sau khi thẻ đã sang link
        // của B (`hashchange`), sau khi đã đăng xuất, hay sau khi người khác đã dán mã của mình — được gắn cho mã đang giữ LÚC ẤY: bí
        // mật ghi danh của A hiện dưới mã của B, mã của B bị coi là đã đổi ở máy chủ (Tiếp không bao giờ gọi `/auth/redeem` cho nó),
        // và nút Vào của một mã cũ đi tiếp tới `/auth/totp`. Nay mỗi lần đổi mã (`datLai`, `doiMa`) mở một lượt mới, và phản hồi của
        // lượt cũ — 200, từ chối hay mất mạng — không đặt gì, không vẽ gì, không mở ô mã sáu số; nút Vào dừng. Bốn cảnh, bốn ca; MỌI
        // `/auth/redeem` bị giữ và ca thả từng lời gọi theo thứ tự đi. Đối chứng dương trong từng ca: phản hồi của lượt HIỆN TẠI — bí
        // mật, từ chối, mất mạng — vẫn hiện như cũ.
        // ====================================================================================
        it(`[S1.249 / khoản 292] ${trang}: ⑴ hashchange — lời «cần ghi danh» cho mã A về MUỘN ⇒ không bí mật của A dưới mã B, ô mã sáu số không mở; Tiếp lại gọi /auth/redeem cho mã B và vẽ như thường`, async () => {
          const g = giuRedeem();
          const p = await dungTrang(trang, { hash: `#${ORG}:maCuaA`, cookie: null, thay: g.thay });
          const lanA = bamGiu(p, "nut-ghi-danh");
          await cho();
          await p.doiFragment(`#${ORG}:maCuaB`);
          g.ds[0]?.tha(canGhiDanh("BIMATCUAA"));
          await lanA;
          await cho();
          expect(p.el("token").value).toBe("maCuaB");
          expect(p.el("ghi-danh").textContent, "bí mật ghi danh của A hiện dưới mã của B").not.toContain("BIMATCUAA");
          khongVeGi(p);
          expect(p.el("ok1").hidden).toBe(true);
          expect(p.el("nut-ghi-danh").disabled, "nút Tiếp bật lại khi lượt cũ xong").toBe(false);
          // Mã của B CHƯA đổi ở máy chủ: Tiếp phải gọi `/auth/redeem` cho nó — và phản hồi của lượt này vẽ như thường.
          const lanB = bamGiu(p, "nut-ghi-danh");
          await cho();
          expect(maDaGui(p), "Tiếp lần nữa phải đổi mã của B ở máy chủ").toEqual(["maCuaA", "maCuaB"]);
          g.ds[1]?.tha(canGhiDanh("BIMATCUAB"));
          await lanB;
          await cho();
          expect(p.el("ghi-danh").textContent).toContain("BIMATCUAB");
          expect(p.el("ghi-danh").textContent).not.toContain("BIMATCUAA");
          expect(p.el("khoi-ma").hidden).toBe(false);
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/redeem"]);
        });

        it(`[S1.249 / khoản 292] ${trang}: ⑵ hashchange — lời từ chối (401) cho mã A về MUỘN ⇒ không câu nào dưới mã B; mất mạng ở lượt của mã B thì vẫn nói`, async () => {
          const g = giuRedeem();
          const p = await dungTrang(trang, { hash: `#${ORG}:maCuaA`, cookie: null, thay: g.thay });
          const lanA = bamGiu(p, "nut-ghi-danh");
          await cho();
          await p.doiFragment(`#${ORG}:maCuaB`);
          g.ds[0]?.tha({ status: 401, body: { error: "ma cua A khong dung duoc" } });
          await lanA;
          await cho();
          expect(p.el("loi1").textContent, "câu từ chối của mã A in dưới mã của B").not.toMatch(/ma cua A/u);
          khongVeGi(p);
          const lanB = bamGiu(p, "nut-ghi-danh");
          await cho();
          expect(maDaGui(p)).toEqual(["maCuaA", "maCuaB"]);
          g.ds[1]?.nem();
          await lanB;
          await cho();
          expect(p.el("loi1").textContent, "mất mạng của lượt HIỆN TẠI vẫn phải nói").toMatch(/Không kết nối được máy chủ/u);
          expect(p.el("khoi-ma").hidden).toBe(true);
        });

        it(`[S1.249 / khoản 292] ${trang}: ⑶ đăng xuất (datLai, cùng mã trong ô) — mất mạng của lượt trước về MUỘN ⇒ không câu «không kết nối» đè lên «Đã đăng xuất»; Tiếp lại gọi lại, lời từ chối của lượt này thì in`, async () => {
          // Trình duyệt đang giữ phiên của người khác (khối hỏi và nút Đăng xuất hiện); A gõ mã của mình, bấm Tiếp, rồi bấm Đăng xuất
          // trước khi máy chủ trả.
          const g = giuRedeem();
          const p = await dungTrang(trang, { hash: "", cookie: A, thay: g.thay });
          expect(p.el("nut-dang-xuat").hidden).toBe(false);
          p.el("org").value = ORG;
          p.el("token").value = "maCuaA";
          const lanA = bamGiu(p, "nut-ghi-danh");
          await cho();
          await p.bam("nut-dang-xuat");
          expect(p.el("ok1").textContent).toMatch(/Đã đăng xuất/u);
          g.ds[0]?.nem();
          await lanA;
          await cho();
          expect(p.el("loi1").textContent, "câu mất mạng của lượt trước đè lên lượt sau đăng xuất").not.toMatch(/Không kết nối/u);
          khongVeGi(p);
          expect(p.el("ok1").textContent, "câu của lượt mới đứng nguyên").toMatch(/Đã đăng xuất/u);
          // Về bước 1 là đổi lại, kể cả với cùng mã: Tiếp gọi lại, và lượt này bị từ chối thì câu từ chối hiện.
          const lanA2 = bamGiu(p, "nut-ghi-danh");
          await cho();
          expect(maDaGui(p)).toEqual(["maCuaA", "maCuaA"]);
          g.ds[1]?.tha({ status: 401, body: { error: "ma dang nhap khong dung duoc" } });
          await lanA2;
          await cho();
          expect(p.el("loi1").textContent).toBe("ma dang nhap khong dung duoc");
          expect(p.trangThai.goi).toEqual(["GET /me", "POST /auth/redeem", "POST /auth/logout", "POST /auth/redeem"]);
        });

        it(`[S1.249 / khoản 292] ${trang}: ⑷ dán mã khác (doiMa) — lời «đã ghi danh» cho mã B về MUỘN khi ô đã sang mã C ⇒ Vào DỪNG, không /auth/totp, ô mã sáu số không mở; phản hồi cho mã C vẽ như thường`, async () => {
          // Mã A đã đổi xong (ô mã sáu số mở); B dán mã của mình, gõ sáu số, bấm Vào — `/auth/redeem` cho mã B bị giữ; C dán mã của
          // mình và bấm Tiếp.
          const g = giuRedeem();
          const p = await dungTrang(trang, { hash: `#${ORG}:maCuaA`, cookie: null, thay: g.thay });
          const lanA = bamGiu(p, "nut-ghi-danh");
          await cho();
          g.ds[0]?.tha({ status: 200, body: { needsEnrollment: false } });
          await lanA;
          await cho();
          expect(p.el("khoi-ma").hidden).toBe(false);
          p.el("token").value = "maCuaB";
          p.el("ma").value = "123456";
          const lanB = bamGiu(p, "nut-vao");
          await cho();
          p.el("token").value = "maCuaC";
          const lanC = bamGiu(p, "nut-ghi-danh");
          await cho();
          expect(maDaGui(p)).toEqual(["maCuaA", "maCuaB", "maCuaC"]);
          g.ds[1]?.tha({ status: 200, body: { needsEnrollment: false } });
          await lanB;
          await cho();
          expect(p.trangThai.goi, "Vào của mã B đi tiếp tới /auth/totp khi ô đã sang mã C").not.toContain("POST /auth/totp");
          khongVeGi(p);
          expect(p.buocMo()).toEqual([]);
          g.ds[2]?.tha(canGhiDanh("BIMATCUAC"));
          await lanC;
          await cho();
          expect(p.el("ghi-danh").textContent).toContain("BIMATCUAC");
          expect(p.el("khoi-ma").hidden).toBe(false);
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/redeem", "POST /auth/redeem"]);
        });

        // ====================================================================================
        // [S1.250 / khoản 310] NÚT VÀO CỦA LƯỢT CŨ DỪNG Ở MỌI `await` — VÀ PHIÊN NÓ ĐÃ MỞ THÌ ĐÓNG
        //
        // Khoản 292 dừng phản hồi `/auth/redeem` của lượt đã qua; nút Vào còn hai `await` nữa — `/auth/totp`, `/me` — không kiểm
        // lượt. Đo ở §S1.249: `/auth/totp` 200 của mã A về sau khi thẻ đã sang link của B ⇒ trang xoá `#<org>:maCuaB` khỏi thanh
        // địa chỉ, hỏi `/me` rồi mở các bước dưới phiên A («Đã vào với người dùng aaaaaaaa…») trong khi ô giữ mã của B. Nay sau
        // MỖI `await` của nút Vào và trong `catch`, lượt đã qua thì im: không xoá mảnh link, không `/me`, không `daVao`, không câu.
        // Phản hồi chỉ được nhận khi ô mã đăng nhập còn mang ĐÚNG mã đã gửi — nên cảnh «dán mã khác mà chưa bấm» (bí mật của mã cũ
        // hiện tới lần bấm kế) cũng dừng. Và vì `/auth/totp` 200 đã đặt cookie phiên của A vào trình duyệt, trang đóng phiên ấy
        // (`POST /auth/logout`, route đăng xuất sẵn có) thay vì để nó sống ngầm; từ chối hay mất mạng ở `/auth/totp` không chứng
        // minh phiên nào đã mở, nên không gọi gì. Bốn cảnh, bốn ca; khuôn bốn ca 292.
        // ====================================================================================
        it(`[S1.250 / khoản 310] ${trang}: ⑴ hashchange — /auth/totp 200 cho mã A về MUỘN ⇒ mảnh link của B còn nguyên, không /me, không «Đã vào…», các bước không mở; phiên A vừa mở bị đóng (POST /auth/logout); Tiếp lại đổi mã B`, async () => {
          const g = giuLenh("POST /auth/totp");
          // Lệnh đóng phiên A cũng bị giữ: nút Vào phải đợi nó xong mới bật lại.
          const gx = giuLenh("POST /auth/logout");
          const p = await dungTrang(trang, { hash: `#${ORG}:maCuaA`, cookie: null, thay: (l) => g.thay(l) ?? gx.thay(l) });
          await p.bam("nut-ghi-danh");
          expect(p.el("khoi-ma").hidden).toBe(false);
          p.el("ma").value = "123456";
          const lanA = bamGiu(p, "nut-vao");
          await cho();
          expect(g.ds).toHaveLength(1);
          await p.doiFragment(`#${ORG}:maCuaB`);
          // Máy chủ đã mở phiên cho A: cookie của nó vào trình duyệt cùng phản hồi.
          p.trangThai.cookie = A;
          g.ds[0]?.tha({ status: 200, body: { ok: true } });
          await cho();
          expect(gx.ds, "phiên A mở ở máy chủ mà trang bỏ thì phải đóng").toHaveLength(1);
          expect(p.el("nut-vao").disabled, "nút Vào bật lại trước khi lệnh đóng phiên A xong — lần Vào kế chạy đua với lệnh xoá cookie").toBe(true);
          p.trangThai.cookie = null;
          gx.ds[0]?.tha({ status: 200, body: { ok: true } });
          await lanA;
          await cho();
          expect(p.loc.hash, "mảnh link (mã CHƯA dùng) của B bị xoá khỏi thanh địa chỉ").toBe(`#${ORG}:maCuaB`);
          expect(p.trangThai.thayUrl).toEqual([]);
          expect(p.trangThai.goi, "trang hỏi /me cho phiên của lượt cũ").not.toContain("GET /me");
          expect(p.buocMo(), "các bước mở dưới phiên A").toEqual([]);
          expect(p.el("ok1").textContent).not.toMatch(/Đã vào/u);
          khongVeGi(p);
          expect(p.trangThai.goi, "phiên A mở ở máy chủ mà trang bỏ thì phải đóng").toEqual(["POST /auth/redeem", "POST /auth/totp", "POST /auth/logout"]);
          expect(p.trangThai.cookie, "phiên A sống ngầm trong trình duyệt").toBeNull();
          expect(p.el("nut-vao").disabled).toBe(false);
          await p.bam("nut-ghi-danh");
          expect(maDaGui(p), "Tiếp lại đổi mã của B").toEqual(["maCuaA", "maCuaB"]);
        });

        it(`[S1.250 / khoản 310] ${trang}: ⑵ hashchange — /me của lượt A về MUỘN (sau /auth/totp 200) ⇒ không daVao: các bước không mở, không «Đã vào…», mảnh link của B còn nguyên; phiên A bị đóng`, async () => {
          const g = giuLenh("GET /me");
          const p = await dungTrang(trang, { hash: `#${ORG}:maCuaA`, cookie: null, nguoiVao: A, thay: g.thay });
          await p.bam("nut-ghi-danh");
          p.el("ma").value = "123456";
          const lanA = bamGiu(p, "nut-vao");
          await cho();
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/totp", "GET /me"]);
          expect(p.trangThai.thayUrl, "mảnh link của A xoá sau /auth/totp 200 — mã A đã tiêu thụ (ADR-020 mục 3)").toEqual([p.loc.pathname]);
          await p.doiFragment(`#${ORG}:maCuaB`);
          g.ds[0]?.tha({ status: 200, body: A });
          await lanA;
          await cho();
          expect(p.loc.hash).toBe(`#${ORG}:maCuaB`);
          expect(p.trangThai.thayUrl, "mảnh link của B bị xoá").toHaveLength(1);
          expect(p.buocMo(), "các bước mở dưới phiên A").toEqual([]);
          expect(p.el("ok1").textContent).not.toMatch(/Đã vào/u);
          khongVeGi(p);
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/totp", "GET /me", "POST /auth/logout"]);
          expect(p.trangThai.cookie, "phiên A sống ngầm trong trình duyệt").toBeNull();
        });

        it(`[S1.250 / khoản 310] ${trang}: ⑶ lời từ chối hay mất mạng của lượt cũ ⇒ không câu nào đè lên lượt mới; /auth/totp không mở phiên nào thì không gọi /auth/logout, /me mất mạng sau /auth/totp 200 thì có`, async () => {
          // ⓐ hashchange, rồi /auth/totp của A bị từ chối (401): không «Mã sáu số không đúng» dưới mã của B; không phiên nào để đóng.
          {
            const g = giuLenh("POST /auth/totp");
            const p = await dungTrang(trang, { hash: `#${ORG}:maCuaA`, cookie: null, thay: g.thay });
            await p.bam("nut-ghi-danh");
            p.el("ma").value = "123456";
            const lanA = bamGiu(p, "nut-vao");
            await cho();
            await p.doiFragment(`#${ORG}:maCuaB`);
            g.ds[0]?.tha({ status: 401, body: { ok: false, reason: "WRONG_CODE", lockedUntil: null } });
            await lanA;
            await cho();
            expect(p.el("loi1").textContent, "câu từ chối của lượt A in dưới mã của B").not.toMatch(/Mã sáu số không đúng/u);
            khongVeGi(p);
            expect(p.trangThai.goi, "từ chối không mở phiên nào — không có gì để đóng").toEqual(["POST /auth/redeem", "POST /auth/totp"]);
          }
          // ⓑ Trình duyệt giữ phiên của người khác (B); A gõ mã của mình, Tiếp, Vào, rồi bấm Đăng xuất trước khi máy chủ trả; lời
          // gọi /auth/totp của A mất mạng ⇒ không «Không kết nối» đè lên «Đã đăng xuất»; mất mạng không chứng minh phiên nào đã mở.
          {
            const g = giuLenh("POST /auth/totp");
            const p = await dungTrang(trang, { hash: "", cookie: B, thay: g.thay });
            expect(p.el("nut-dang-xuat").hidden).toBe(false);
            p.el("org").value = ORG;
            p.el("token").value = "maCuaA";
            await p.bam("nut-ghi-danh");
            p.el("ma").value = "123456";
            const lanA = bamGiu(p, "nut-vao");
            await cho();
            await p.bam("nut-dang-xuat");
            expect(p.el("ok1").textContent).toMatch(/Đã đăng xuất/u);
            g.ds[0]?.nem();
            await lanA;
            await cho();
            expect(p.el("loi1").textContent, "câu mất mạng của lượt trước đè lên lượt sau đăng xuất").not.toMatch(/Không kết nối/u);
            khongVeGi(p);
            expect(p.el("ok1").textContent, "câu của lượt mới đứng nguyên").toMatch(/Đã đăng xuất/u);
            expect(p.trangThai.goi).toEqual(["GET /me", "POST /auth/redeem", "POST /auth/totp", "POST /auth/logout"]);
          }
          // ⓒ /auth/totp 200 (lượt còn hiện tại), hashchange trong lúc /me còn bay, /me mất mạng ⇒ không câu nào; phiên A đã mở
          // chắc chắn, nên trang đóng nó.
          {
            const g = giuLenh("GET /me");
            const p = await dungTrang(trang, { hash: `#${ORG}:maCuaA`, cookie: null, nguoiVao: A, thay: g.thay });
            await p.bam("nut-ghi-danh");
            p.el("ma").value = "123456";
            const lanA = bamGiu(p, "nut-vao");
            await cho();
            await p.doiFragment(`#${ORG}:maCuaB`);
            g.ds[0]?.nem();
            await lanA;
            await cho();
            expect(p.el("loi1").textContent, "câu mất mạng của lượt A in dưới mã của B").not.toMatch(/Không kết nối/u);
            khongVeGi(p);
            expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/totp", "GET /me", "POST /auth/logout"]);
            expect(p.trangThai.cookie).toBeNull();
          }
        });

        it(`[S1.250 / khoản 310] ${trang}: ⑷ dán mã khác vào ô mà CHƯA bấm — /auth/redeem của mã A về sau ⇒ không bí mật của A; /auth/totp 200 của mã A về sau ⇒ không /me, các bước không mở, phiên A bị đóng; lần bấm kế đổi mã B`, async () => {
          // ⓐ Tiếp với mã A bị giữ; B dán mã của mình vào ô (chưa bấm); lời «cần ghi danh» cho mã A về.
          {
            const g = giuRedeem();
            const p = await dungTrang(trang, { hash: `#${ORG}:maCuaA`, cookie: null, thay: g.thay });
            const lanA = bamGiu(p, "nut-ghi-danh");
            await cho();
            p.el("token").value = "maCuaB";
            g.ds[0]?.tha(canGhiDanh("BIMATCUAA"));
            await lanA;
            await cho();
            expect(p.el("ghi-danh").textContent, "bí mật của mã A hiện khi ô đã mang mã B").not.toContain("BIMATCUAA");
            khongVeGi(p);
            expect(p.el("ok1").hidden).toBe(true);
            const lanB = bamGiu(p, "nut-ghi-danh");
            await cho();
            expect(maDaGui(p)).toEqual(["maCuaA", "maCuaB"]);
            g.ds[1]?.tha(canGhiDanh("BIMATCUAB"));
            await lanB;
            await cho();
            expect(p.el("ghi-danh").textContent).toContain("BIMATCUAB");
            expect(p.el("khoi-ma").hidden).toBe(false);
          }
          // ⓑ Vào với mã A, /auth/totp bị giữ; B dán mã của mình vào ô (chưa bấm); 200 của A về (cookie của A đã đặt).
          {
            const g = giuLenh("POST /auth/totp");
            const p = await dungTrang(trang, { hash: `#${ORG}:maCuaA`, cookie: null, thay: g.thay });
            await p.bam("nut-ghi-danh");
            p.el("ma").value = "123456";
            const lanA = bamGiu(p, "nut-vao");
            await cho();
            p.el("token").value = "maCuaB";
            p.trangThai.cookie = A;
            g.ds[0]?.tha({ status: 200, body: { ok: true } });
            await lanA;
            await cho();
            expect(p.trangThai.goi, "trang hỏi /me cho mã A khi ô đã mang mã B").not.toContain("GET /me");
            expect(p.buocMo(), "các bước mở dưới phiên A khi ô đã mang mã B").toEqual([]);
            expect(p.el("ok1").textContent).not.toMatch(/Đã vào/u);
            expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/totp", "POST /auth/logout"]);
            expect(p.trangThai.cookie, "phiên A sống ngầm trong trình duyệt").toBeNull();
            await p.bam("nut-ghi-danh");
            expect(maDaGui(p), "lần bấm kế đổi mã của B").toEqual(["maCuaA", "maCuaB"]);
          }
        });
      }
    });

    // ==========================================================================================
    // [S1.216 / khoản 195 / ADR-126] LINK ĐĂNG NHẬP GẦN ĐÂY CỦA CHÍNH MÌNH
    //
    // Thông điệp gộp ba trạng thái ở route vô danh giữ nguyên; người ĐÃ đăng nhập thì được xem: sau khi
    // các bước mở (vừa đăng nhập, hay «Tiếp tục với phiên này»), `/login` hỏi `GET /auth/login-links` và
    // vẽ mỗi link một dòng — «Link lúc X» → «đã dùng lúc Y» / «hết hạn lúc Y, chưa dùng» / «còn hiệu lực
    // tới Y, chưa dùng» — kèm câu nói việc phải làm khi một link «đã dùng» không phải do mình. Lỗi hay
    // 401 ⇒ khối ẩn, các bước vẫn mở (khối là một trợ giúp, không phải một cổng). Về bước 1 (đăng xuất,
    // hashchange) ⇒ khối ẩn và rỗng; một phản hồi về MUỘN sau đó bị bỏ. ~~Cùng ranh giới với khoản 193:
    // CHỈ `mo-thau`; ba trang người mua kia — khoản 282.~~ [S1.240 / khoản 282] Khối nay ở `/lib/dang-nhap.js`, nên ba ca dưới
    // chạy trên cả bốn trang người mua; đo trước trên cây cũ: ba trang kia đỏ ở cả ba ca. [S1.249 / khoản 291] Năm trang: `/du-lieu`
    // chưa có khối cho tới vòng này.
    // ==========================================================================================
    describe("[S1.216 / khoản 195 · S1.240 / khoản 282 · S1.249 / khoản 291] link đăng nhập gần đây của chính mình — năm trang người mua", () => {
      const BA_LINK = {
        status: 200,
        body: {
          loginLinks: [
            { createdAt: "2026-09-30T08:00:00Z", expiresAt: "2026-09-30T08:15:00Z", consumedAt: null, purpose: "LOGIN", status: "PENDING" },
            { createdAt: "2026-09-30T07:00:00Z", expiresAt: "2026-09-30T07:15:00Z", consumedAt: "2026-09-30T07:03:00Z", purpose: "LOGIN", status: "CONSUMED" },
            { createdAt: "2026-09-29T07:00:00Z", expiresAt: "2026-09-29T07:15:00Z", consumedAt: null, purpose: "LOGIN", status: "EXPIRED" },
          ],
          truncated: false,
        },
      };
      const coLink = (l: string) => (l === "GET /auth/login-links" ? Promise.resolve(BA_LINK) : undefined);

      for (const trang of NAM_TRANG) {
        it(`${trang}: đăng nhập bằng link ⇒ sau /me trang hỏi /auth/login-links; ba link ra ba dòng nói đúng trạng thái; khối mở kèm câu «không phải bạn thì báo»`, async () => {
          const p = await dungTrang(trang, { hash: `#${ORG}:maCu`, cookie: null, thay: coLink });
          await p.bam("nut-ghi-danh");
          p.el("ma").value = "123456";
          await p.bam("nut-vao");
          expect(p.trangThai.goi).toEqual(["POST /auth/redeem", "POST /auth/totp", "GET /me", ...(SAU_MO[trang] ?? [])]);
          expect(p.buocMo()).toEqual(BUOC[trang]);
          expect(p.el("khoi-link-gan-day").hidden).toBe(false);
          const hang = capLink(p);
          expect(hang).toHaveLength(3);
          for (const [k] of hang) expect(k).toMatch(/^Link lúc /u);
          expect(hang[0]?.[1]).toMatch(/còn hiệu lực/u);
          expect(hang[0]?.[1]).toMatch(/chưa dùng/u);
          expect(hang[1]?.[1]).toMatch(/^đã dùng lúc /u);
          expect(hang[2]?.[1]).toMatch(/hết hạn/u);
          expect(hang[2]?.[1]).toMatch(/chưa dùng/u);
          // Không dòng nào mang một chuỗi ISO thô: giờ hiện cho người đọc, không phải cho máy.
          for (const [k, v] of hang) expect(`${k} ${v}`).not.toMatch(/T\d\d:\d\d:\d\dZ/u);
          expect(p.el("ghi-link-gan-day").textContent).toMatch(/không phải bạn/u);
          expect(p.el("ghi-link-gan-day").textContent).toMatch(/đã dùng/u);
          expect(p.el("ghi-link-gan-day").textContent).toMatch(/báo/u);
        });

        it(`${trang}: «Tiếp tục với phiên này» cũng hỏi; danh sách rỗng ⇒ khối mở nói «chưa có»; 401 hay mất mạng ⇒ khối ẩn, các bước VẪN mở`, async () => {
          const p = await dungTrang(trang, { hash: "", cookie: A });
          await p.bam("nut-dung-phien");
          expect(p.trangThai.goi).toEqual(["GET /me", ...(SAU_MO[trang] ?? [])]);
          expect(p.el("khoi-link-gan-day").hidden).toBe(false);
          expect(capLink(p)).toEqual([["Link đăng nhập gần đây", "chưa có"]]);

          const q = await dungTrang(trang, { hash: "", cookie: A, thay: (l) => (l === "GET /auth/login-links" ? Promise.resolve({ status: 401, body: { error: "x" } }) : undefined) });
          await q.bam("nut-dung-phien");
          expect(q.buocMo(), "khối là một trợ giúp, không phải một cổng").toEqual(BUOC[trang]);
          expect(q.el("khoi-link-gan-day").hidden).toBe(true);
          expect(q.el("loi1").hidden).toBe(true);

          const r = await dungTrang(trang, { hash: "", cookie: A, thay: (l) => (l === "GET /auth/login-links" ? Promise.reject(new Error("mat mang")) : undefined) });
          await r.bam("nut-dung-phien");
          expect(r.buocMo()).toEqual(BUOC[trang]);
          expect(r.el("khoi-link-gan-day").hidden).toBe(true);
        });

        it(`${trang}: đăng xuất hay hashchange ⇒ khối ẩn và RỖNG; /auth/login-links về MUỘN sau hashchange thì bị bỏ`, async () => {
          const p = await dungTrang(trang, { hash: "", cookie: A, thay: coLink });
          await p.bam("nut-dung-phien");
          expect(capLink(p)).toHaveLength(3);
          await p.bam("nut-dang-xuat");
          expect(p.el("khoi-link-gan-day").hidden).toBe(true);
          expect(capLink(p)).toEqual([]);

          const q = await dungTrang(trang, { hash: "", cookie: A, thay: coLink });
          await q.bam("nut-dung-phien");
          expect(capLink(q)).toHaveLength(3);
          await q.doiFragment(`#${ORG}:maCuaB`);
          expect(q.el("khoi-link-gan-day").hidden).toBe(true);
          expect(capLink(q)).toEqual([]);

          let tha: () => void = () => undefined;
          const m = await dungTrang(trang, {
            hash: "", cookie: A,
            thay: (l) => (l === "GET /auth/login-links" ? new Promise((r) => { tha = () => { r(BA_LINK); }; }) : undefined),
          });
          await m.bam("nut-dung-phien");
          expect(m.el("khoi-link-gan-day").hidden).toBe(true);
          await m.doiFragment(`#${ORG}:maCuaB`);
          tha();
          await cho();
          expect(m.el("khoi-link-gan-day").hidden, "phản hồi về muộn sau khi đã về bước 1 không được mở khối").toBe(true);
          expect(capLink(m)).toEqual([]);
        });
      }
    });

    // ==========================================================================================
    // [S1.240 / khoản 268 / ADR-126] DANH SÁCH LINK GẦN ĐÂY NÓI KHI NÓ BỊ CẮT
    //
    // `GET /auth/login-links` nay trả link trong 7 ngày, tối đa 100 hàng, cộng `truncated: boolean` — đúng khi còn hàng TRONG cửa
    // sổ mà trần cắt đi (chủ dự án chốt câu 6, ngày 2026-09-30). Trang nói «còn nữa»: danh sách đang hiện bao nhiêu link mới nhất,
    // và chừng ấy link trong một tuần là điều bất thường — báo. Chỉ `true` đúng nghĩa mới là cắt: thiếu trường (API cũ, lệch phiên
    // bản), `false` hay một giá trị lạ ⇒ không câu nào — một danh sách không được nói rộng hơn thân mang. Câu nói cả cửa sổ 7 ngày ở
    // mọi lần, để người đọc biết một link cũ hơn thế không hiện ở đây. Đo trước trên cây cũ: đỏ ở cả bốn trang (`/login` chưa có
    // câu nào; ba trang kia không có khối). [S1.249 / khoản 291] Và ở `/du-lieu`, trang thứ năm.
    // ==========================================================================================
    describe("[S1.240 / khoản 268 · S1.249 / khoản 291] danh sách link gần đây nói khi nó bị cắt — năm trang người mua", () => {
      const MOT = { createdAt: "2026-09-30T08:00:00Z", expiresAt: "2026-09-30T08:15:00Z", consumedAt: "2026-09-30T08:03:00Z", purpose: "LOGIN", status: "CONSUMED" };
      const voi = (than: unknown) => (l: string) => (l === "GET /auth/login-links" ? Promise.resolve({ status: 200, body: than }) : undefined);

      for (const trang of NAM_TRANG) {
        it(`${trang}: \`truncated: true\` ⇒ câu nói «Còn nữa», số link đang hiện và cửa sổ 7 ngày; \`false\`, thiếu (API cũ) hay giá trị lạ ⇒ không «còn nữa»`, async () => {
          const cat = await dungTrang(trang, { hash: "", cookie: A, thay: voi({ loginLinks: [MOT, MOT], truncated: true }) });
          await cat.bam("nut-dung-phien");
          expect(cat.el("khoi-link-gan-day").hidden).toBe(false);
          expect(capLink(cat)).toHaveLength(2);
          const cau = cat.el("ghi-link-gan-day").textContent;
          expect(cau).toMatch(/Còn nữa/u);
          expect(cau, "câu phải nói trang đang hiện bao nhiêu link").toMatch(/2 link mới nhất/u);
          expect(cau).toMatch(/7 ngày/u);
          expect(cau).toMatch(/không phải bạn/u);
          for (const than of [{ loginLinks: [MOT], truncated: false }, { loginLinks: [MOT] }, { loginLinks: [MOT], truncated: "true" }, { loginLinks: [MOT], truncated: 1 }]) {
            const du = await dungTrang(trang, { hash: "", cookie: A, thay: voi(than) });
            await du.bam("nut-dung-phien");
            expect(du.el("khoi-link-gan-day").hidden, JSON.stringify(than)).toBe(false);
            expect(du.el("ghi-link-gan-day").textContent, JSON.stringify(than)).not.toMatch(/Còn nữa/u);
            expect(du.el("ghi-link-gan-day").textContent, JSON.stringify(than)).toMatch(/7 ngày/u);
          }
        });
      }
    });

    // [S1.231 / khoản 232 / ADR-133] Nút «Rút đề xuất» ở bước 7 của `/login`: chỉ hiện khi đề xuất mới nhất đang PROPOSED
    // và chưa có chữ ký (đọc từ `GET /award`), và bấm thì gọi đúng `POST /rfqs/:id/award/withdraw` mang lý do. Trang không
    // phải lớp có thẩm quyền — trigger `094` là — nên ca này đo trang NÓI đúng và GỌI đúng, không đo luật.
    describe("[S1.231 / khoản 232] mo-thau: nút «Rút đề xuất» chỉ hiện khi đề xuất PROPOSED chưa chữ ký, và gọi đúng route", () => {
      const RFQ = "22222222-2222-4222-8222-222222222222";
      const award = (status: string, approvals: readonly unknown[]) => ({
        awardId: "aw-1", rfqId: RFQ, evaluationId: "e-1", bidVersionId: "bv-1", status, reason: "gia thap",
        actedBy: A.userId, actedAt: "2026-09-30T00:00:00Z", approvals,
      });
      /** Trang đã vào phiên A, đọc gói `RFQ` (bước 2), và mọi lời gọi của bước 7 có stub. */
      const dung = async (traAward: () => { status: number; body: unknown }, rut?: { status: number; body: unknown }) => {
        const p = await dungTrang("mo-thau", {
          hash: "", cookie: A,
          thay: (l) => {
            if (l === `GET /rfqs/${RFQ}`) return Promise.resolve({ status: 200, body: { rfq: { title: "Mua thép", status: "AWARDED", deadlineAt: "2099-01-01T00:00:00Z", requiresDualApproval: false } } });
            if (l === `GET /rfqs/${RFQ}/bid-count`) return Promise.resolve({ status: 200, body: { bidCount: { disclosed: true, count: 3 } } });
            if (l === `GET /rfqs/${RFQ}/unseal`) return Promise.resolve({ status: 200, body: { unsealRequest: null } });
            if (l === `POST /rfqs/${RFQ}/award`) return Promise.resolve({ status: 201, body: { award: award("PROPOSED", []) } });
            if (l === `GET /rfqs/${RFQ}/award`) return Promise.resolve(traAward());
            if (l === `POST /rfqs/${RFQ}/award/withdraw`) return Promise.resolve(rut ?? { status: 201, body: { award: award("WITHDRAWN", []) } });
            return undefined;
          },
        });
        await p.bam("nut-dung-phien");
        p.el("rfq").value = RFQ;
        await p.bam("nut-doc");
        return p;
      };
      const daGoiRut = (p: Awaited<ReturnType<typeof dung>>) => p.trangThai.than.filter((t) => t.lenh === `POST /rfqs/${RFQ}/award/withdraw`).map((t) => t.than);

      it("PROPOSED, 0 chữ ký ⇒ nút hiện sau khi trang đọc đề xuất; bấm ⇒ POST /award/withdraw mang lý do; đọc lại thấy WITHDRAWN ⇒ nút ẩn", async () => {
        let lan = 0;
        const p = await dung(() => ({ status: 200, body: { award: award((lan += 1) === 1 ? "PROPOSED" : "WITHDRAWN", []) } }));
        expect(p.el("nut-rut-de-xuat").hidden, "chưa đọc đề xuất nào: ẩn như HTML khai").toBe(true);
        p.el("bao-gia-thang").value = "bv-1";
        p.el("ly-do-award").value = "gia thap";
        await p.bam("nut-de-xuat");
        expect(p.el("nut-rut-de-xuat").hidden, "PROPOSED chưa chữ ký ⇒ rút được").toBe(false);
        p.el("ly-do-award").value = "bam nham bao gia";
        await p.bam("nut-rut-de-xuat");
        expect(daGoiRut(p)).toEqual([{ reason: "bam nham bao gia" }]);
        expect(p.el("ok7").textContent).toMatch(/^Đã rút đề xuất/u);
        expect(p.el("loi7").hidden).toBe(true);
        expect(p.el("nut-rut-de-xuat").hidden, "đọc lại thấy WITHDRAWN ⇒ không còn gì để rút").toBe(true);
      });

      it("PROPOSED ĐÃ CÓ chữ ký ⇒ nút ẩn; APPROVED ⇒ ẩn; chưa có đề xuất ⇒ ẩn — trang không mời một hành động mà CSDL sẽ từ chối", async () => {
        for (const [ten, tra] of [
          ["có chữ ký", { status: 200, body: { award: award("PROPOSED", [{ approverUserId: B.userId, approvedAt: "2026-09-30T01:00:00Z" }]) } }],
          ["APPROVED", { status: 200, body: { award: award("APPROVED", [{ approverUserId: B.userId, approvedAt: "2026-09-30T01:00:00Z" }]) } }],
          ["chưa có", { status: 200, body: { award: null } }],
        ] as const) {
          const p = await dung(() => tra);
          p.el("bao-gia-thang").value = "bv-1";
          p.el("ly-do-award").value = "gia thap";
          await p.bam("nut-de-xuat");
          expect(p.el("nut-rut-de-xuat").hidden, ten).toBe(true);
        }
      });

      it("lý do trống ⇒ câu nói lý do bắt buộc và KHÔNG gọi máy chủ; máy chủ từ chối 422 có tên ⇒ câu của máy chủ ở ô lỗi, nút vẫn hiện", async () => {
        const p = await dung(() => ({ status: 200, body: { award: award("PROPOSED", []) } }), { status: 422, body: { error: "Chỉ người đã đề xuất mới rút được đề xuất của mình; người khác thì huỷ qua cổng po.approve." } });
        p.el("bao-gia-thang").value = "bv-1";
        p.el("ly-do-award").value = "gia thap";
        await p.bam("nut-de-xuat");
        p.el("ly-do-award").value = "   ";
        await p.bam("nut-rut-de-xuat");
        expect(daGoiRut(p), "lý do trống thì không một lời gọi nào").toEqual([]);
        expect(p.el("loi7").textContent).toMatch(/Lý do là BẮT BUỘC/u);
        p.el("ly-do-award").value = "rut ho";
        await p.bam("nut-rut-de-xuat");
        expect(daGoiRut(p)).toEqual([{ reason: "rut ho" }]);
        expect(p.el("loi7").textContent).toBe("Chỉ người đã đề xuất mới rút được đề xuất của mình; người khác thì huỷ qua cổng po.approve.");
        expect(p.el("ok7").hidden).toBe(true);
        expect(p.el("nut-rut-de-xuat").hidden, "từ chối thì trạng thái đề xuất không đổi, nút vẫn hiện").toBe(false);
      });
    });

    // [S1.260 / S4.5c1] Benchmark theo dòng ở bước 4 và cột Benchmark của bảng xếp hạng (spec S4 §4.6; ADR-143). Đo đúng thứ trang
    // GỌI (không tự gọi khi nạp gói; Đọc benchmark đọc benchmark TRƯỚC rồi bảng so sánh, mỗi lần, chỉ khi có nhãn — rà soát S4.5c1), chữ
    // trang IN (nhãn theo spec, độ phủ, dải khi bấm Xem dải), và tư thế ở vòng chào lại (không nhãn nào, không lời gọi dải nào).
    describe("[S1.260 / S4.5c1] mo-thau: benchmark theo dòng, Xem dải, cột Benchmark của bảng xếp hạng", () => {
      const RFQ = "44444444-4444-4444-8444-444444444444";
      const SO_SANH = {
        rows: [
          { bidVersionId: "bv-1", supplierLegalName: "Công ty Thép Một", totalAmount: "1000.00", currency: "VND", version: 1, bafoRoundNo: null,
            isLatestForBid: true, payload: { lines: [{ lineNo: 1, unitPrice: "100", amount: "600.00" }, { lineNo: 2, unitPrice: "40", amount: "400.00" }] } },
          { bidVersionId: "bv-2", supplierLegalName: "Công ty Thép Hai", totalAmount: "900.00", currency: "VND", version: 1, bafoRoundNo: null,
            isLatestForBid: true, payload: { lines: [{ lineNo: 1, unitPrice: "90", amount: "540.00" }, { lineNo: 2, unitPrice: "36", amount: "360.00" }] } },
        ],
        aggregates: { parsed: 2, unparsed: 0, min: "900.00", max: "1000.00", average: "950.00", currencyMismatch: false },
      };
      const dongBm = (bidVersionId: string, lineNo: number, nhan: string, chieu: string | null = null) => ({
        bidVersionId, lineNo, canonicalItemId: nhan === "KHONG_DO_DUOC" ? null : "ci-1", anhXaId: null, nhan, chieu,
        lyDo: nhan === "KHONG_DO_DUOC" ? "CHUA_ANH_XA" : null, tienTe: "VND", cuaSoTu: null,
        soQuanSat: 9, soGoi: 3, soNcc: 5, soGoiCungNguoiTao: 1, soQuanSatHoiTo: 9, soLoaiTienTe: 0, soLoaiGia0: 0, hoiTo: [],
      });
      const BM_CO = {
        trangThai: "CO", nguon: "TINH_MOI", snapshotId: "s-1", unsealRequestId: "u-1", bafoRoundId: null, policyId: "p-1", policyVersion: 1,
        phuongPhap: "TRUNG_VI_THEO_GOI_V1", mocMoGia: "2026-10-01T00:00:00Z", tinhLuc: "2026-10-01T01:00:00Z",
        dong: [dongBm("bv-1", 1, "BINH_THUONG"), dongBm("bv-2", 1, "LECH_CAO", "TREN"), dongBm("bv-1", 2, "KHONG_DO_DUOC"), dongBm("bv-2", 2, "KHONG_DO_DUOC")],
      };
      const DAI = {
        trangThai: "CO", snapshotId: "s-1", lineNo: 1, mocMoGia: "2026-10-01T00:00:00Z", tinhLuc: "2026-10-01T01:00:00Z", donViGoc: "kg",
        dai: [{ canonicalItemId: "ci-1", tienTe: "VND", cuaSoTu: "2025-10-01T00:00:00Z", duSan: true, q1: "18000", trungVi: "18500", q3: "19000",
          soQuanSat: 9, soGoi: 3, soNcc: 5, soGoiCungNguoiTao: 1, soQuanSatHoiTo: 9, soLoaiTienTe: 0, soLoaiGia0: 0, sauMoc: { ANH_XA: 1 }, khopBanLuu: true }],
        giaCuaGoi: [{ bidVersionId: "bv-1", trangThai: "HOP_LE", donGiaQuyDoi: "18600", tienTe: "VND" },
          { bidVersionId: "bv-2", trangThai: "HOP_LE", donGiaQuyDoi: "25000.125", tienTe: "VND" }],
      };
      const XEP_HANG = {
        evaluationId: "e-1", policyVersion: 1, currency: "VND", evaluatedAt: "2026-10-01T02:00:00Z",
        rows: [
          { rank: 1, supplierName: "Công ty Thép Hai", effectiveCost: "900.00", bidVersionId: "bv-2", components: [] },
          { rank: 2, supplierName: "Công ty Thép Một", effectiveCost: "1000.00", bidVersionId: "bv-1", components: [] },
        ],
      };
      const dung = async (bm: unknown, soSanh: unknown = SO_SANH, dai: unknown = DAI) => {
        const p = await dungTrang("mo-thau", {
          hash: "", cookie: B,
          thay: (l) => {
            if (l === `GET /rfqs/${RFQ}`) return Promise.resolve({ status: 200, body: { rfq: { title: "Mua thép", status: "UNSEALED", deadlineAt: "2099-01-01T00:00:00Z", requiresDualApproval: false } } });
            if (l === `GET /rfqs/${RFQ}/bid-count`) return Promise.resolve({ status: 200, body: { bidCount: { disclosed: true, count: 2 } } });
            if (l === `GET /rfqs/${RFQ}/unseal`) return Promise.resolve({ status: 200, body: { unsealRequest: null } });
            if (l === `GET /rfqs/${RFQ}/comparison`) return Promise.resolve({ status: 200, body: { comparison: soSanh } });
            if (l === `GET /rfqs/${RFQ}/benchmark`) return Promise.resolve({ status: 200, body: { benchmark: bm } });
            if (l === `GET /rfqs/${RFQ}/items/1/benchmark`) return Promise.resolve({ status: 200, body: { dai } });
            if (l === `GET /rfqs/${RFQ}/ranking`) return Promise.resolve({ status: 200, body: { ranking: XEP_HANG } });
            return undefined;
          },
        });
        await p.bam("nut-dung-phien");
        p.el("rfq").value = RFQ;
        await p.bam("nut-doc");
        return p;
      };
      const chuHang = (p: Awaited<ReturnType<typeof dung>>, id: string) =>
        p.el(id).querySelector("tbody").con.map((tr) => tr.con.map((td) => td.textContent).join("|"));
      const ttChu = (p: Awaited<ReturnType<typeof dung>>, id: string) => p.el(id).con.map((x) => x.textContent).join("|");

      it("nạp gói KHÔNG tự đọc benchmark; Đọc benchmark đọc benchmark rồi bảng so sánh — LẠI mỗi lần bấm — vẽ nhãn theo chữ spec, thành phần và độ phủ", async () => {
        const p = await dung(BM_CO);
        expect(p.trangThai.goi.filter((g) => g.includes("benchmark"))).toEqual([]);
        await p.bam("nut-benchmark");
        expect(p.trangThai.goi.filter((g) => g.includes("/comparison") || g.includes("benchmark"))).toEqual([
          `GET /rfqs/${RFQ}/benchmark`, `GET /rfqs/${RFQ}/comparison`,
        ]);
        const hang = chuHang(p, "bang-benchmark");
        expect(hang).toHaveLength(4);
        expect(p.el("bang-benchmark").querySelector("tbody").con[0]?.con[0]?.con.map((x) => x.textContent)).toEqual(["Dòng 1 ", "Xem dải"]);
        expect(hang[0]).toMatch(/^\|Công ty Thép Một\|.*\|trong dải lịch sử nội bộ \(3 gói, 5 nhà cung cấp\)\|3 gói · 5 nhà cung cấp · 1 gói do chính người tạo gói này lập · 9 quan sát ánh xạ hồi tố$/u);
        expect(hang[1]).toMatch(/^\|Công ty Thép Hai\|.*\|Giá bất thường — nên xem xét\|/u);
        expect(p.el("bang-benchmark").querySelector("tbody").con[1]?.className).toBe("lech");
        expect(hang[2]).toMatch(/không đo được — dòng chưa ánh xạ về hàng chuẩn nào/u);
        const tt = ttChu(p, "tt-benchmark");
        expect(tt).toMatch(/Độ phủ của gói\|2\/4 \(báo giá × dòng\) đo được/u);
        expect(tt).toMatch(/Độ phủ — Công ty Thép Một\|1\/2 dòng · 60,0% giá trị/u);
        expect(tt).toMatch(/Tính lúc\|.* — lần đọc này vừa tính/u);
        await p.bam("nut-benchmark");
        expect(p.trangThai.goi.filter((g) => g.includes("/comparison")), "bấm lần hai đọc bảng so sánh lần hai").toHaveLength(2);
      });

      it("[rà soát S4.5c1] phong bì mang `amount` dạng SỐ và một dòng `null` ⇒ bảng benchmark và cột Benchmark vẫn vẽ, độ phủ đọc số", async () => {
        const hong = {
          ...SO_SANH,
          rows: [
            { ...SO_SANH.rows[0], payload: { lines: [{ lineNo: 1, unitPrice: 100, amount: 600 }, null, { lineNo: 2, unitPrice: "40", amount: "400.00" }] } },
            { ...SO_SANH.rows[1], payload: { lines: [null, { lineNo: 1, unitPrice: "90", amount: { x: 1 } }] } },
          ],
        };
        const p = await dung(BM_CO, hong);
        await p.bam("nut-benchmark");
        expect(p.el("loi4b").hidden).toBe(true);
        const hang = chuHang(p, "bang-benchmark");
        expect(hang).toHaveLength(4);
        expect(hang[0]).toMatch(/^\|Công ty Thép Một\|.*\|trong dải lịch sử nội bộ/u);
        const tt = ttChu(p, "tt-benchmark");
        expect(tt, "600 dạng số đọc như \"600\"").toMatch(/Độ phủ — Công ty Thép Một\|1\/2 dòng · 60,0% giá trị/u);
        expect(tt, "thành tiền là đối tượng ⇒ không phần trăm").toMatch(/Độ phủ — Công ty Thép Hai\|1\/2 dòng(\||$)/u);
        await p.bam("nut-xep-hang");
        expect(chuHang(p, "bang-hang").map((h) => h.split("|")[4])).toEqual([
          "1 bất thường (cao) · 1 không đo được · phủ 1/2 dòng",
          "1 trong dải · 1 không đo được · phủ 1/2 dòng",
        ]);
      });

      it("[rà soát S4.5c1] đọc gói KHÁC xoá benchmark của gói trước — bảng, khối thông tin, cột Benchmark", async () => {
        const p = await dung(BM_CO);
        await p.bam("nut-xep-hang");
        await p.bam("nut-benchmark");
        expect(chuHang(p, "bang-benchmark")).toHaveLength(4);
        await p.bam("nut-doc");
        expect(chuHang(p, "bang-benchmark")).toEqual([]);
        expect(ttChu(p, "tt-benchmark")).toBe("");
        expect(chuHang(p, "bang-hang").map((h) => h.split("|")[4])).toEqual(["—", "—"]);
      });

      it("[rà soát S4.5c1] THU_LAI in câu đọc lại, không hàng nào, không đọc bảng so sánh", async () => {
        const p = await dung({ trangThai: "THU_LAI", rfqStatus: "BAFO_UNSEALED" });
        await p.bam("nut-benchmark");
        expect(ttChu(p, "tt-benchmark")).toMatch(/^Benchmark\|Gói vừa đổi trạng thái .* Bấm đọc lại\.$/u);
        expect(chuHang(p, "bang-benchmark")).toEqual([]);
        expect(p.trangThai.goi.filter((g) => g.includes("/comparison"))).toEqual([]);
      });

      it("[rà soát S4.5c1] dải của một bản lưu KHÁC bảng đang hiện ⇒ nói ra, vẫn in dải", async () => {
        const p = await dung(BM_CO, SO_SANH, { ...DAI, snapshotId: "s-2" });
        await p.bam("nut-benchmark");
        const nut = p.el("bang-benchmark").querySelector("tbody").con[0]?.con[0]?.con[1];
        for (const f of nut?.nghe["click"] ?? []) await f();
        const tt = ttChu(p, "tt-dai");
        expect(tt).toMatch(/^Lưu ý\|Dải này của lần mở thầu MỚI hơn bảng benchmark đang hiện/u);
        expect(tt).toContain("Q1 18.000,00 · trung vị 18.500,00 · Q3 19.000,00 VND/kg");
      });

      it("Xem dải gọi đúng route của dòng và in Q1/trung vị/Q3 theo đơn vị gốc, SAU_MOC, đơn giá quy đổi của từng báo giá", async () => {
        const p = await dung(BM_CO);
        await p.bam("nut-benchmark");
        const nut = p.el("bang-benchmark").querySelector("tbody").con[0]?.con[0]?.con[1];
        expect(nut?.textContent).toBe("Xem dải");
        for (const f of nut?.nghe["click"] ?? []) await f();
        expect(p.trangThai.goi.at(-1)).toBe(`GET /rfqs/${RFQ}/items/1/benchmark`);
        expect(p.el("khoi-dai").hidden).toBe(false);
        const tt = ttChu(p, "tt-dai");
        expect(tt).toContain("Q1 18.000,00 · trung vị 18.500,00 · Q3 19.000,00 VND/kg (3 gói, 5 nhà cung cấp)");
        expect(tt).toContain("1 ánh xạ");
        expect(tt).toContain("Đơn giá quy đổi — Công ty Thép Hai|25.000,13 VND/kg");
        expect(p.el("bang-benchmark").querySelector("tbody").con[1]?.con[0]?.con, "chỉ hàng đầu của một dòng mang nút").toEqual([]);
      });

      it("vòng chào lại đang mở: in câu có tên, không hàng nào, cột Benchmark của bảng xếp hạng là gạch", async () => {
        const p = await dung({ trangThai: "VONG_CHAO_LAI_DANG_MO", rfqStatus: "BAFO_OPEN" });
        await p.bam("nut-benchmark");
        expect(ttChu(p, "tt-benchmark")).toMatch(/^Benchmark\|Vòng chào lại đang mở/u);
        expect(chuHang(p, "bang-benchmark")).toEqual([]);
        await p.bam("nut-xep-hang");
        expect(chuHang(p, "bang-hang").map((h) => h.split("|")[4])).toEqual(["—", "—"]);
        expect(p.trangThai.goi.filter((g) => g.includes("/items/"))).toEqual([]);
      });

      it("[đi thử 375×812] gói AWARDED ⇒ hỏi benchmark, in câu trạng thái của nó, KHÔNG hỏi bảng so sánh (rà soát S4.5c1: không một lần từ chối mỗi cú bấm); ô của bảng benchmark mang nhãn cột cho màn hẹp", async () => {
        const p = await dungTrang("mo-thau", {
          hash: "", cookie: B,
          thay: (l) => {
            if (l === `GET /rfqs/${RFQ}`) return Promise.resolve({ status: 200, body: { rfq: { title: "Mua thép", status: "AWARDED", deadlineAt: "2099-01-01T00:00:00Z", requiresDualApproval: false } } });
            if (l === `GET /rfqs/${RFQ}/bid-count`) return Promise.resolve({ status: 200, body: { bidCount: { disclosed: true, count: 2 } } });
            if (l === `GET /rfqs/${RFQ}/unseal`) return Promise.resolve({ status: 200, body: { unsealRequest: null } });
            if (l === `GET /rfqs/${RFQ}/comparison`) return Promise.resolve({ status: 422, body: { error: "Bảng so sánh chỉ tồn tại sau khi mở thầu; RFQ đang ở AWARDED (A4)." } });
            if (l === `GET /rfqs/${RFQ}/benchmark`) return Promise.resolve({ status: 200, body: { benchmark: { trangThai: "KHONG_HIEN", rfqStatus: "AWARDED" } } });
            return undefined;
          },
        });
        await p.bam("nut-dung-phien");
        p.el("rfq").value = RFQ;
        await p.bam("nut-doc");
        await p.bam("nut-benchmark");
        expect(p.trangThai.goi.filter((g) => g.includes("/comparison") || g.includes("benchmark"))).toEqual([`GET /rfqs/${RFQ}/benchmark`]);
        expect(ttChu(p, "tt-benchmark")).toBe("Benchmark|Benchmark chỉ hiện khi bảng so sánh mở — gói đang ở trạng thái AWARDED.");
        const q = await dung(BM_CO);
        await q.bam("nut-benchmark");
        expect(q.el("bang-benchmark").querySelector("tbody").con[0]?.con.slice(1).map((td) => td.dataset["nhan"])).toEqual([
          "Nhà cung cấp", "Đơn giá chào", "Benchmark", "Thành phần dải",
        ]);
      });

      it("cột Benchmark của bảng xếp hạng: gạch trước khi đọc benchmark, tóm tắt nhãn và độ phủ sau — kể cả khi bảng xếp hạng vẽ TRƯỚC", async () => {
        const p = await dung(BM_CO);
        await p.bam("nut-xep-hang");
        expect(chuHang(p, "bang-hang").map((h) => h.split("|")[4])).toEqual(["—", "—"]);
        await p.bam("nut-benchmark");
        expect(chuHang(p, "bang-hang").map((h) => h.split("|")[4])).toEqual([
          "1 bất thường (cao) · 1 không đo được · phủ 1/2 dòng",
          "1 trong dải · 1 không đo được · phủ 1/2 dòng",
        ]);
      });
    });

    // [S1.254 / khoản 320, 321, 323] Bước 5 và 7 của `/mo-thau` — đo ở diễn tập §11 trên Chromium: bảng xếp hạng không in id
    // phiên bản mà bước 7 đòi gõ (người mua thật không đề xuất trao thầu được bằng giao diện), nút Phê duyệt ký lên một khối
    // trống, và một lần thiếu quyền hiện nguyên chuỗi `khong co quyen`.
    describe("[S1.254] mo-thau: Chọn ở bảng xếp hạng, đọc đề xuất trước khi ký, câu 403", () => {
      const RFQ = "33333333-3333-4333-8333-333333333333";
      const XEP_HANG = {
        evaluationId: "e-7", policyVersion: 1, currency: "VND", evaluatedAt: "2026-10-01T00:00:00Z",
        rows: [
          { rank: 1, supplierName: "Công ty Thép Một", effectiveCost: "379570212.00", bidVersionId: "bv-1", components: [] },
          { rank: null, supplierName: "Công ty Không Đọc Được", effectiveCost: null, bidVersionId: "bv-2", components: [] },
        ],
      };
      const deXuat = (awardId: string, evaluationId = "e-7") => ({
        awardId, rfqId: RFQ, evaluationId, bidVersionId: "bv-1", status: "PROPOSED", reason: "chi phí hiệu dụng thấp nhất",
        actedBy: A.userId, actedAt: "2026-10-01T01:00:00Z", approvals: [],
      });
      const dung = async (traAward: () => { status: number; body: unknown }, duyet: { status: number; body: unknown } = { status: 201, body: {} }) => {
        const p = await dungTrang("mo-thau", {
          hash: "", cookie: B,
          thay: (l) => {
            if (l === `GET /rfqs/${RFQ}`) return Promise.resolve({ status: 200, body: { rfq: { title: "Mua thép", status: "AWARDED", deadlineAt: "2099-01-01T00:00:00Z", requiresDualApproval: false } } });
            if (l === `GET /rfqs/${RFQ}/bid-count`) return Promise.resolve({ status: 200, body: { bidCount: { disclosed: true, count: 3 } } });
            if (l === `GET /rfqs/${RFQ}/unseal`) return Promise.resolve({ status: 200, body: { unsealRequest: null } });
            if (l === `GET /rfqs/${RFQ}/ranking`) return Promise.resolve({ status: 200, body: { ranking: XEP_HANG } });
            if (l === `GET /rfqs/${RFQ}/award`) return Promise.resolve(traAward());
            if (l.startsWith(`POST /rfqs/${RFQ}/award/`)) return Promise.resolve(duyet);
            return undefined;
          },
        });
        await p.bam("nut-dung-phien");
        p.el("rfq").value = RFQ;
        await p.bam("nut-doc");
        return p;
      };
      const daKy = (p: Awaited<ReturnType<typeof dung>>) => p.trangThai.goi.filter((g) => g.startsWith(`POST /rfqs/${RFQ}/award/`));
      const ttAward = (p: Awaited<ReturnType<typeof dung>>) => p.el("tt-award").con.map((x) => x.textContent).join("|");

      it("khoản 320: hàng có hạng mang nút Chọn, bấm thì id phiên bản điền vào ô của bước 7; hàng không hạng thì không có nút", async () => {
        const p = await dung(() => ({ status: 200, body: { award: null } }));
        expect(p.trangThai.goi.filter((g) => g.includes("/ranking") || g.includes("/award")), "nạp gói KHÔNG tự đọc bước 5 hay 7").toEqual([]);
        await p.bam("nut-xep-hang");
        const hang = p.el("bang-hang").querySelector("tbody").con;
        expect(hang).toHaveLength(2);
        const nut = hang[0]?.con.at(-1)?.con[0];
        expect(nut?.textContent).toBe("Chọn");
        expect(hang[1]?.con.at(-1)?.con, "báo giá không có chi phí hiệu dụng đọc được thì không chọn được").toEqual([]);
        for (const f of nut?.nghe["click"] ?? []) await f();
        expect(p.el("bao-gia-thang").value).toBe("bv-1");
        expect(p.el("ok5").textContent).toMatch(/Đã chọn Công ty Thép Một \(hạng 1\)/u);
      });

      it("khoản 321: Phê duyệt lần đầu chỉ HIỆN đề xuất (tên nhà cung cấp, chi phí, lý do) — lần hai mới ký, đúng đề xuất đã hiện", async () => {
        const p = await dung(() => ({ status: 200, body: { award: deXuat("aw-1") } }));
        await p.bam("nut-duyet-award");
        expect(daKy(p), "lần bấm đầu không ký").toEqual([]);
        expect(ttAward(p)).toMatch(/Nhà cung cấp\|Công ty Thép Một/u);
        // `/lib/so-tien.js` của trang là hàm giả trả chuỗi rỗng ở đây (THU_VIEN) — đo nhãn và nguồn, không đo định dạng.
        expect(ttAward(p)).toMatch(/Chi phí hiệu dụng\|.*\|Hạng ở lượt chấm\|1\|/u);
        expect(ttAward(p)).toMatch(/Lý do\|chi phí hiệu dụng thấp nhất/u);
        expect(p.el("ok7").textContent).toMatch(/bấm Phê duyệt lần nữa/u);
        await p.bam("nut-duyet-award");
        expect(daKy(p)).toEqual([`POST /rfqs/${RFQ}/award/aw-1/approve`]);
        expect(p.el("ok7").textContent).toMatch(/^Đã phê duyệt trao thầu/u);
      });

      it("khoản 321: đề xuất đổi giữa lần đọc và lần bấm ⇒ không ký, hiện đề xuất mới; Đọc đề xuất rồi Phê duyệt thì ký một lần", async () => {
        let lan = 0;
        // Lần đọc thứ nhất (nút Đọc đề xuất) thấy aw-1; từ lần thứ hai máy chủ đã có aw-2.
        const p = await dung(() => ({ status: 200, body: { award: deXuat((lan += 1) <= 1 ? "aw-1" : "aw-2") } }));
        await p.bam("nut-doc-award");
        expect(ttAward(p)).toMatch(/Công ty Thép Một/u);
        await p.bam("nut-duyet-award");
        expect(daKy(p), "đề xuất lúc bấm khác đề xuất đã đọc").toEqual([]);
        await p.bam("nut-duyet-award");
        expect(daKy(p)).toEqual([`POST /rfqs/${RFQ}/award/aw-2/approve`]);
      });

      it("khoản 321: đề xuất dựa trên một lượt chấm KHÁC lượt của bảng xếp hạng ⇒ chỉ hiện id, không gọi tên từ lượt khác", async () => {
        const p = await dung(() => ({ status: 200, body: { award: deXuat("aw-1", "e-cu") } }));
        await p.bam("nut-doc-award");
        expect(ttAward(p)).not.toMatch(/Nhà cung cấp/u);
        expect(ttAward(p)).toMatch(/Báo giá được chọn\|bv-1/u);
      });

      it("khoản 323: 403 hằng của api ⇒ câu đọc được mang tên việc; thân 403 khác và lỗi khác in nguyên văn", async () => {
        const p = await dung(() => ({ status: 200, body: { award: deXuat("aw-1") } }), { status: 403, body: { error: "khong co quyen" } });
        await p.bam("nut-doc-award");
        await p.bam("nut-duyet-award");
        expect(p.el("loi7").textContent).toMatch(/^Không duyệt được: tài khoản đang đăng nhập không có quyền làm việc này/u);
        expect(p.el("loi7").textContent).not.toMatch(/khong co quyen/u);
        for (const [than, mong] of [
          [{ status: 403, body: { error: "nguon khong duoc phep" } }, "nguon khong duoc phep"],
          [{ status: 422, body: { error: "Người đề xuất trao thầu không được tự duyệt đề xuất của mình (J3)." } }, "Người đề xuất trao thầu không được tự duyệt đề xuất của mình (J3)."],
        ] as const) {
          const q = await dung(() => ({ status: 200, body: { award: deXuat("aw-1") } }), than);
          await q.bam("nut-doc-award");
          await q.bam("nut-duyet-award");
          expect(q.el("loi7").textContent).toBe(mong);
        }
      });

      // [S1.255 / khoản 327] Khoản 321 làm đề xuất ĐỌC ĐƯỢC trước khi ký — và từ đó người DUYỆT cũng thấy nút «Rút đề xuất»
      // cạnh «Phê duyệt» (đo trên trình duyệt thật: Tổng Giám đốc ở XD-04). Rút là đường của CHÍNH người đề xuất (khoản 232,
      // trigger `094` từ chối người khác); trước S1.254 nút không bao giờ hiện cho người duyệt chỉ vì đề xuất không được đọc.
      it("khoản 327: người xem KHÔNG phải người đề xuất ⇒ nút «Rút đề xuất» ẩn; chính người đề xuất ⇒ hiện", async () => {
        const p = await dung(() => ({ status: 200, body: { award: deXuat("aw-1") } }));
        await p.bam("nut-doc-award");
        expect(ttAward(p), "đối chứng: đề xuất của A đã hiện cho B").toMatch(/PROPOSED/u);
        expect(p.el("nut-rut-de-xuat").hidden, "B (người duyệt) thấy nút rút đề xuất của A").toBe(true);
        await p.bam("nut-duyet-award");
        expect(p.el("nut-rut-de-xuat").hidden, "sau lần bấm Phê duyệt đầu (chỉ hiện đề xuất) cũng vậy").toBe(true);
        const q = await dung(() => ({ status: 200, body: { award: { ...deXuat("aw-1"), actedBy: B.userId } } }));
        await q.bam("nut-doc-award");
        expect(q.el("nut-rut-de-xuat").hidden, "chính người đề xuất (B) mở lại trang ⇒ rút được").toBe(false);
      });

      // [S1.259 / khoản 333] «Huỷ trao thầu» gọi `POST …/award/cancel` theo GÓI, không cần trao thầu nào đang hiện — đo trên
      // trình duyệt thật: Tổng Giám đốc nạp XD-04, bước 7 trống, gõ lý do, bấm Huỷ ⇒ `CANCELLED`, và thứ vừa huỷ chỉ hiện SAU đó.
      // Khuôn khoản 321 của «Phê duyệt»: lần bấm đầu — hay khi trao thầu đã đổi từ lúc đọc — chỉ vẽ nó ra.
      it("khoản 333: «Huỷ trao thầu» khi chưa đọc ⇒ lần bấm đầu chỉ HIỆN trao thầu sắp huỷ; lần hai mới huỷ; đổi giữa chừng ⇒ không huỷ; lý do trống ⇒ không gọi gì", async () => {
        // [S1.261 / khoản 335] Route huỷ mang id trao thầu: `…/award/<id>/cancel`.
        const daHuy = (p: Awaited<ReturnType<typeof dung>>) => p.trangThai.goi.filter((g) => g.startsWith(`POST /rfqs/${RFQ}/award/`) && g.endsWith("/cancel"));
        const p = await dung(() => ({ status: 200, body: { award: deXuat("aw-1") } }));
        p.el("ly-do-award").value = "nha cung cap rut bao gia";
        await p.bam("nut-huy-award");
        expect(daHuy(p), "huỷ một trao thầu chưa hiện trên màn").toEqual([]);
        expect(ttAward(p)).toMatch(/Nhà cung cấp\|Công ty Thép Một/u);
        expect(p.el("ok7").textContent).toMatch(/bấm Huỷ trao thầu lần nữa/u);
        await p.bam("nut-huy-award");
        expect(daHuy(p)).toEqual([`POST /rfqs/${RFQ}/award/aw-1/cancel`]);
        expect(p.el("ok7").textContent).toMatch(/^Đã huỷ trao thầu/u);

        let lan = 0;
        const q = await dung(() => ({ status: 200, body: { award: deXuat((lan += 1) <= 1 ? "aw-1" : "aw-2") } }));
        q.el("ly-do-award").value = "x";
        await q.bam("nut-doc-award");
        await q.bam("nut-huy-award");
        expect(daHuy(q), "trao thầu lúc bấm khác trao thầu đã đọc").toEqual([]);

        const r = await dung(() => ({ status: 200, body: { award: deXuat("aw-1") } }));
        await r.bam("nut-doc-award");
        r.el("ly-do-award").value = "   ";
        await r.bam("nut-huy-award");
        expect(r.trangThai.goi.filter((g) => g.endsWith("/cancel")), "lý do trống").toEqual([]);
        expect(r.el("loi7").textContent).toMatch(/Lý do là BẮT BUỘC/u);

        // Đọc lại trao thầu bị từ chối (người không giữ `bid.view`) hay gói chưa có trao thầu nào ⇒ nói ra, không huỷ.
        for (const [ten, tra, cau] of [
          ["403", { status: 403, body: { error: "khong co quyen" } }, /^Chưa đọc được trao thầu sắp huỷ: tài khoản đang đăng nhập không có quyền/u],
          ["chưa có", { status: 200, body: { award: null } }, /chưa có trao thầu nào để huỷ/u],
        ] as const) {
          const s = await dung(() => tra);
          s.el("ly-do-award").value = "ly do";
          await s.bam("nut-huy-award");
          expect(s.trangThai.goi.filter((g) => g.endsWith("/cancel")), ten).toEqual([]);
          expect(s.el("loi7").textContent, ten).toMatch(cau);
        }
      });

      // [S1.261 / khoản 335] Giữa lần đọc lại của trang và lần huỷ, trao thầu đổi được (rút rồi đề xuất lại, hay được duyệt);
      // máy chủ nay từ chối theo id thay vì huỷ thứ mới. Thân 422 là `{ error: <câu> }` — hình dạng thật của `TraoThauTuChoiError`.
      it("[S1.261 / khoản 335] «Huỷ trao thầu» gửi id của trao thầu ĐANG HIỆN; máy chủ từ chối vì nó không còn mới nhất ⇒ in nguyên câu, không báo đã huỷ", async () => {
        const cau = "Trao thầu được nêu không phải trao thầu mới nhất của gói này — gói đã đổi từ lúc đọc (hàng mới nhất đang ở APPROVED), " +
          "hoặc id thuộc gói khác. Lần huỷ này không được ghi nhận; đọc lại trao thầu của gói rồi mới huỷ.";
        const p = await dung(() => ({ status: 200, body: { award: deXuat("aw-7") } }), { status: 422, body: { error: cau } });
        await p.bam("nut-doc-award");
        p.el("ly-do-award").value = "ly do";
        await p.bam("nut-huy-award");
        expect(p.trangThai.goi.filter((g) => g.endsWith("/cancel"))).toEqual([`POST /rfqs/${RFQ}/award/aw-7/cancel`]);
        expect(p.el("loi7").textContent).toBe(cau);
        expect(p.el("ok7").textContent).toBe("");
      });
    });

    // [S1.259 / khoản 332] Bước 3: câu báo sau mỗi chữ ký mở thầu là MỘT hằng — *"Thiếu người thứ hai thì điều phối sẽ bị từ chối"* —
    // kể cả khi chính chữ ký ấy làm yêu cầu đủ (đo trên trình duyệt ở §S1.255: Phó Tổng Giám đốc ký XD-03 ⇒ `APPROVED 2 / 2`, câu
    // vẫn nói thiếu). Câu nay đọc yêu cầu vừa nạp lại: đủ ⇒ nói đủ và chỉ sang «Điều phối giải mã»; chưa đủ ⇒ nói thiếu, kèm số.
    it("[S1.259 / khoản 332] mo-thau bước 3: chữ ký làm yêu cầu ĐỦ ⇒ câu báo nói đủ và chỉ sang Điều phối; chưa đủ ⇒ nói chưa đủ, kèm số", async () => {
      const RFQ = "55555555-5555-4555-8555-555555555555";
      const yc = (status: string, dem: number) => ({ id: "yc-1", status, approvalCount: dem, requiredApprovals: 2, breakGlass: false });
      // Cột cuối: lần nạp lại SAU khi ký hỏng (500) — câu dựa vào `status` của phản hồi lần ký, không đoán "chưa đủ".
      for (const [ten, sau, phai, khong, napLaiHong] of [
        ["đủ", yc("APPROVED", 2), /đã đủ 2 \/ 2 chữ ký.*Điều phối giải mã/u, /Thiếu|Chưa đủ/u, false],
        ["chưa đủ", yc("PENDING", 1), /Chưa đủ chữ ký \(1 \/ 2\)/u, /đã đủ/u, false],
        ["đủ, nạp lại hỏng", yc("APPROVED", 2), /đã đủ chữ ký.*Điều phối giải mã/u, /Thiếu|Chưa đủ/u, true],
      ] as const) {
        let daKy = false;
        const p = await dungTrang("mo-thau", {
          hash: "", cookie: B,
          thay: (l) => {
            if (l === `GET /rfqs/${RFQ}`) return Promise.resolve({ status: 200, body: { rfq: { title: "Bê tông", status: "CLOSED", deadlineAt: "2099-01-01T00:00:00Z", requiresDualApproval: true } } });
            if (l === `GET /rfqs/${RFQ}/bid-count`) return Promise.resolve({ status: 200, body: { bidCount: { disclosed: true, count: 3 } } });
            if (l === `GET /rfqs/${RFQ}/unseal` && daKy && napLaiHong) return Promise.resolve({ status: 500, body: { error: "loi noi bo" } });
            if (l === `GET /rfqs/${RFQ}/unseal`) return Promise.resolve({ status: 200, body: { unsealRequest: daKy ? sau : yc("PENDING", sau.approvalCount - 1) } });
            // Hình dạng THẬT (đo trên trình duyệt): phản hồi của lần ký không mang hai con số — chỉ `GET …/unseal` mang.
            if (l === "POST /unseal/yc-1/approve") { daKy = true; return Promise.resolve({ status: 200, body: { unsealRequest: { id: sau.id, status: sau.status } } }); }
            return undefined;
          },
        });
        await p.bam("nut-dung-phien");
        p.el("rfq").value = RFQ;
        await p.bam("nut-doc");
        await p.bam("nut-duyet");
        expect(p.trangThai.goi, `${ten}: đối chứng — lần ký thật sự đã đi`).toContain("POST /unseal/yc-1/approve");
        expect(p.el("ok3").textContent, ten).toMatch(phai);
        expect(p.el("ok3").textContent, ten).not.toMatch(khong);
      }
    });

    it("[S1.254 / khoản 323] tao-thau: 403 hằng của api ở «Tạo nhà cung cấp» (vai BUYER) ⇒ câu đọc được; lỗi khác in nguyên văn", async () => {
      for (const [than, mong] of [
        [{ status: 403, body: { error: "khong co quyen" } }, /^Không tạo được nhà cung cấp: tài khoản đang đăng nhập không có quyền làm việc này/u],
        [{ status: 422, body: { error: "Mã số thuế đã có trong tổ chức" } }, /^Mã số thuế đã có trong tổ chức$/u],
      ] as const) {
        const p = await dungTrang("tao-thau", { hash: "", cookie: A, thay: (l) => (l === "POST /suppliers" ? Promise.resolve(than) : undefined) });
        await p.bam("nut-dung-phien");
        p.el("ncc-ten").value = "Thép Đông Anh";
        p.el("ncc-mst").value = "0301234567";
        await p.bam("nut-tao-ncc");
        expect(p.el("loi5").textContent).toMatch(mong);
      }
    });

    it("[S1.254 / khoản 322] nop-thau: mỗi ô của hàng hạng mục mang nhãn cho màn hẹp; bảng mang lớp `hang-gia` mà luật CSS dưới 480px đọc", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true });
      await p.bam("nut-dung-phien");
      const o = p.el("bang-hang").querySelector("tbody").con[0]?.con ?? [];
      expect(o.map((x) => x.dataset["nhan"] ?? "")).toEqual(["", "SL", "ĐVT", "Đơn giá"]);
      expect(o.map((x) => x.className)).toEqual(["", "so sl", "dvt", "so gia"]);
      const doc = (tep: string) => readFileSync(new URL(`../trang/${tep}`, import.meta.url), "utf8").replace(/\r\n/gu, "\n");
      expect(doc("nop-thau.html")).toContain('<table id="bang-hang" class="hang-gia">');
      expect(doc("mo-thau.html"), "bảng xếp hạng của /mo-thau cùng id — không được ăn luật màn hẹp").not.toContain('class="hang-gia"');
      const css = doc("chung.css");
      const khoi = css.slice(css.indexOf("@media (max-width: 480px) {"));
      expect(khoi).toMatch(/table\.hang-gia thead \{ display: none; \}/u);
      expect(khoi).toMatch(/table\.hang-gia td\[data-nhan\]::before \{ content: attr\(data-nhan\)/u);
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

    // [S1.178] Trang nộp thầu hỏi lại phiên khách lúc tải — mã lời mời đã bị tiêu thụ ở lần xác minh, nên
    // trước vòng này tải lại trang là mất đường vào tới khi bên mua mời lại.
    const moBuoc3 = (p: Awaited<ReturnType<typeof dungTrang>>) => p.el("b3").hidden === false;
    const REDEEM = (l: string) => (l === "POST /guest/redeem" ? Promise.resolve({ status: 200, body: { linkChannel: "EMAIL", otpChannels: ["SMS"] } }) : undefined);
    /** Giữ lần gọi thứ `lan` của `lenh` tới khi `tha()`; mọi lời gọi khác theo mặc định (hay theo `khac`). */
    const giu = (lenh: string, lan: number, khac?: (l: string) => Promise<{ status: number; body: unknown }> | undefined) => {
      const g = { tha: () => undefined as void, dem: 0 };
      const thay = (l: string) => {
        if (l === lenh && ++g.dem === lan) return new Promise<{ status: number; body: unknown }>((r) => { g.tha = () => { r({ status: 200, body: lenh === "GET /guest/rfq" ? GOI_THAU_KHACH : {} }); }; });
        return khac?.(l);
      };
      return { g, thay };
    };

    it("[S1.178] nop-thau: có phiên khách còn hạn ⇒ HỎI, nêu tên gói thầu, không tự mở; Tiếp tục ⇒ bước 3", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true });
      expect(p.trangThai.goi).toEqual(["GET /guest/rfq"]);
      expect(moBuoc3(p), "bảng giá không được tự mở dưới một phiên chưa ai nhận").toBe(false);
      expect(p.el("hoi-phien").hidden).toBe(false);
      expect(p.el("hoi-phien").textContent).toContain("«Mua thép tấm quý IV»");
      // ~~tên gói không nói phiên của ai — câu hỏi phải nói thẳng~~ [S1.181 / ADR-109] câu hỏi nêu tên doanh nghiệp được mời.
      expect(p.el("hoi-phien").textContent).toContain("«Công ty Thép Miền Bắc»");
      expect(p.el("nut-dung-phien").hidden).toBe(false);
      await p.bam("nut-dung-phien");
      expect(p.trangThai.goi).toEqual(["GET /guest/rfq", "GET /guest/rfq"]);
      expect(moBuoc3(p)).toBe(true);
      expect(p.el("b1").lop.has("xong")).toBe(true);
      expect(p.el("b2").hidden, "không bắt nhập lại OTP").toBe(true);
      expect(p.el("hoi-phien").hidden).toBe(true);
      expect(p.el("nut-dung-phien").hidden).toBe(true);
      expect(p.el("ok1").textContent).toMatch(/Đang dùng phiên nộp thầu còn hạn của «Công ty Thép Miền Bắc»/u);
    });

    it("[S1.178] nop-thau: link mời mang mã ⇒ KHÔNG hỏi phiên khách — thứ tự docLink() rồi thuPhienKhach() ở cấp tệp", async () => {
      const p = await dungTrang("nop-thau", { hash: `#${ORG}:maLoiMoiMoi`, cookie: null, khach: true });
      expect(p.el("token").value).toBe("maLoiMoiMoi");
      expect(p.trangThai.goi).toEqual([]);
      expect(p.el("hoi-phien").hidden).toBe(true);
      expect(moBuoc3(p)).toBe(false);
    });

    it("[S1.178] nop-thau: không phiên khách (401), mất mạng, 200 thiếu tên gói hay 403 ⇒ không hỏi, và Tiếp tục không mở gì", async () => {
      const lay = (r: Promise<{ status: number; body: unknown }>) => (l: string) => (l === "GET /guest/rfq" ? r : undefined);
      const cacCa = [
        await dungTrang("nop-thau", { hash: "", cookie: null }),
        await dungTrang("nop-thau", { hash: "", cookie: null, khach: true, thay: (l) => (l === "GET /guest/rfq" ? Promise.reject(new Error("mat mang")) : undefined) }),
        // [S1.181 / lượt soi] Thân có tên doanh nghiệp, CHỈ thiếu tên gói: bản trước dùng `{ items: [] }`, thiếu cả hai, nên từ
        // khi câu hỏi đòi thêm tên doanh nghiệp thì bỏ vế `title` vẫn xanh.
        await dungTrang("nop-thau", { hash: "", cookie: null, khach: true, thay: lay(Promise.resolve({ status: 200, body: { ...GOI_THAU_KHACH, rfq: { ...GOI_THAU_KHACH.rfq, title: undefined } } })) }),
        await dungTrang("nop-thau", { hash: "", cookie: null, khach: true, thay: lay(Promise.resolve({ status: 403, body: GOI_THAU_KHACH })) }),
      ];
      for (const [i, p] of cacCa.entries()) {
        expect(p.trangThai.goi, `ca ${i}`).toEqual(["GET /guest/rfq"]);
        expect(p.el("hoi-phien").hidden, `ca ${i}`).toBe(true);
        await p.bam("nut-dung-phien");
        expect(moBuoc3(p), `ca ${i}`).toBe(false);
        expect(p.trangThai.goi, `ca ${i}: Tiếp tục không được gọi gì`).toEqual(["GET /guest/rfq"]);
      }
    });

    it("[S1.178] nop-thau: phiên chết trong lúc khối hỏi nằm chờ ⇒ Tiếp tục báo ở bước 1, KHÔNG mở bước 3 rỗng", async () => {
      let lan = 0;
      const p = await dungTrang("nop-thau", {
        hash: "", cookie: null, khach: true,
        thay: (l) => (l === "GET /guest/rfq" && ++lan === 2 ? Promise.resolve({ status: 401, body: { error: "phien khong hop le" } }) : undefined),
      });
      expect(p.el("hoi-phien").hidden).toBe(false);
      await p.bam("nut-dung-phien");
      expect(moBuoc3(p)).toBe(false);
      expect(p.el("b1").lop.has("xong")).toBe(false);
      expect(p.el("ok1").textContent).toBe("");
      expect(p.el("loi3").hidden).toBe(true);
      expect(p.el("loi1").textContent).toMatch(/hết hạn hoặc lời mời đã bị thu hồi/u);
    });

    it("[S1.178] nop-thau: khối hỏi đang hiện rồi nhà cung cấp khác mở link của mình trong CÙNG thẻ ⇒ khối hỏi biến mất", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true });
      expect(p.el("hoi-phien").hidden).toBe(false);
      await p.doiFragment(`#${ORG}:maCuaNhaCungCapKhac`);
      expect(p.el("hoi-phien").hidden).toBe(true);
      expect(p.el("nut-dung-phien").hidden).toBe(true);
      await p.bam("nut-dung-phien");
      expect(moBuoc3(p)).toBe(false);
      expect(p.trangThai.goi).toEqual(["GET /guest/rfq"]);
    });

    it("[S1.178] nop-thau: bước 3 và 4 đang mở rồi hashchange sang link khác ⇒ bước 2–4 đóng, bỏ \"xong\", dừng đếm ngược, xoá biên nhận", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true });
      await p.bam("nut-dung-phien");
      expect(moBuoc3(p)).toBe(true);
      // Giả như vừa nộp xong: biên nhận (bước 4) đang hiện, bước 3 đã "xong".
      p.el("b4").hidden = false;
      p.el("b3").lop.add("xong");
      p.el("tt-bn").textContent = "biên nhận của người trước";
      // [S1.181 / lượt soi] Câu đếm ngược và hai dòng lỗi mang chữ của phiên trước. Đường này KHÔNG đi qua nút Thoát (nút ấy
      // tự xoá `loi4`), nên chỉ `dongCacBuoc` giữ được chúng.
      for (const id of ["dem-nguoc", "loi3", "loi4"]) {
        p.el(id).textContent = `${id} của phiên trước`;
        p.el(id).hidden = false;
      }
      await p.doiFragment(`#${ORG}:maCuaNhaCungCapKhac`);
      for (const b of ["b2", "b3", "b4"]) expect(p.el(b).hidden, b).toBe(true);
      for (const b of ["b1", "b2", "b3"]) expect(p.el(b).lop.has("xong"), b).toBe(false);
      expect(p.trangThai.xoaHen, "đếm ngược của gói trước phải dừng").toEqual([1]);
      expect(p.el("tt-bn").textContent, "biên nhận của người trước phải bị xoá").toBe("");
      for (const id of ["dem-nguoc", "loi3", "loi4"]) {
        expect(p.el(id).textContent, id).toBe("");
        expect(p.el(id).hidden, id).toBe(true);
      }
      expect(p.el("token").value).toBe("maCuaNhaCungCapKhac");
      expect(p.trangThai.goi).toEqual(["GET /guest/rfq", "GET /guest/rfq"]);
    });

    it("[S1.178] nop-thau: đường link — Mở lời mời, rồi hashchange ⇒ bước 2 đóng, bước 1 hết \"xong\"", async () => {
      const p = await dungTrang("nop-thau", { hash: `#${ORG}:maA`, cookie: null, thay: REDEEM });
      await p.bam("nut-mo");
      expect(p.el("b2").hidden).toBe(false);
      expect(p.el("b1").lop.has("xong")).toBe(true);
      await p.doiFragment(`#${ORG}:maB`);
      expect(p.el("b2").hidden).toBe(true);
      expect(p.el("b1").lop.has("xong")).toBe(false);
    });

    it("[S1.178] nop-thau: trọn đường link — xác minh ⇒ bước 3; fragment bị xoá (hashchange không mã) ⇒ ô mã rỗng, đóng bước, HỎI lại", async () => {
      const p = await dungTrang("nop-thau", { hash: `#${ORG}:maA`, cookie: null, thay: REDEEM });
      await p.bam("nut-mo");
      p.el("ma").value = "123456";
      await p.bam("nut-xac");
      expect(p.trangThai.khach, "xác minh xong thì trình duyệt có cookie khách").toBe(true);
      expect(moBuoc3(p)).toBe(true);
      expect(p.el("token").value, "ô vẫn giữ mã đã tiêu thụ").toBe("maA");
      await p.doiFragment("");
      expect(p.el("token").value).toBe("");
      expect(moBuoc3(p)).toBe(false);
      expect(p.el("hoi-phien").hidden).toBe(false);
      expect(p.trangThai.goi).toEqual(["POST /guest/redeem", "POST /guest/otp/verify", "GET /guest/rfq", "GET /guest/rfq"]);
    });

    it("[S1.178] nop-thau: đang ở bước 3 mà Mở một lời mời khác ⇒ bước 3 của cookie cũ đóng trước khi mở bước 2", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true, thay: REDEEM });
      await p.bam("nut-dung-phien");
      expect(moBuoc3(p)).toBe(true);
      p.el("org").value = ORG;
      p.el("token").value = "maGoTay";
      await p.bam("nut-mo");
      expect(moBuoc3(p)).toBe(false);
      expect(p.el("b2").hidden).toBe(false);
      expect(p.el("hoi-phien").hidden).toBe(true);
    });

    it("[S1.178] nop-thau: Mở lời mời từ khối hỏi đang hiện ⇒ khối hỏi biến mất và không mở lại được phiên cũ", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true, thay: REDEEM });
      expect(p.el("hoi-phien").hidden).toBe(false);
      p.el("org").value = ORG;
      p.el("token").value = "maGoTay";
      await p.bam("nut-mo");
      expect(p.el("hoi-phien").hidden).toBe(true);
      expect(p.el("nut-dung-phien").hidden).toBe(true);
      await p.bam("nut-dung-phien");
      expect(moBuoc3(p)).toBe(false);
    });

    it("[S1.178] nop-thau: /guest/rfq của khối hỏi về muộn SAU khi fragment đã đổi sang link mời khác ⇒ bị bỏ", async () => {
      const { g, thay } = giu("GET /guest/rfq", 1);
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true, thay });
      await p.doiFragment(`#${ORG}:maLoiMoiKhac`);
      g.tha();
      await cho();
      expect(p.el("hoi-phien").hidden).toBe(true);
      expect(p.el("nut-dung-phien").hidden).toBe(true);
    });

    it("[S1.178] nop-thau: gói thầu của Tiếp tục về muộn SAU khi fragment đã đổi ⇒ bị bỏ, bước 3 không mở lại", async () => {
      const { g, thay } = giu("GET /guest/rfq", 2);
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true, thay });
      const bam = p.bam("nut-dung-phien");
      await cho();
      await p.doiFragment(`#${ORG}:maCuaB`);
      g.tha();
      await bam;
      expect(moBuoc3(p)).toBe(false);
      expect(p.el("b1").lop.has("xong")).toBe(false);
      expect(p.el("ok1").textContent).toBe("");
      expect(p.el("loi1").textContent).toBe("");
    });

    it("[S1.178] nop-thau: xác minh OTP về muộn SAU khi fragment đã đổi ⇒ không xoá fragment mới, không nạp gói thầu", async () => {
      const { g, thay } = giu("POST /guest/otp/verify", 1, REDEEM);
      const p = await dungTrang("nop-thau", { hash: `#${ORG}:maA`, cookie: null, thay });
      await p.bam("nut-mo");
      p.el("ma").value = "123456";
      const bam = p.bam("nut-xac");
      await cho();
      await p.doiFragment(`#${ORG}:maB`);
      g.tha();
      await bam;
      expect(p.trangThai.thayUrl).toEqual([]);
      expect(p.loc.hash).toBe(`#${ORG}:maB`);
      expect(moBuoc3(p)).toBe(false);
      expect(p.trangThai.goi).not.toContain("GET /guest/rfq");
    });

    // [S1.181 / ADR-109] Tên doanh nghiệp được mời trong câu hỏi và ở bước 3; nút Thoát phiên nộp thầu.
    const bangGoiThau = (p: Awaited<ReturnType<typeof dungTrang>>) => p.el("tt-rfq").con.map((x) => x.textContent);

    it("[S1.181] nop-thau: khối hỏi nêu tên doanh nghiệp VÀ tên gói; nút Thoát hiện cùng khối hỏi; Tiếp tục ⇒ bảng gói thầu có dòng doanh nghiệp", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true });
      expect(p.el("hoi-phien").textContent).toContain("của «Công ty Thép Miền Bắc» cho gói thầu «Mua thép tấm quý IV»");
      expect(p.el("nut-thoat-khach").hidden).toBe(false);
      await p.bam("nut-dung-phien");
      expect(moBuoc3(p)).toBe(true);
      const bang = bangGoiThau(p);
      expect(bang.slice(0, 4)).toEqual(["Gói thầu", "Mua thép tấm quý IV", "Doanh nghiệp được mời", "Công ty Thép Miền Bắc"]);
      expect(p.el("nut-thoat-khach").hidden, "đang dùng phiên thì phải thoát được").toBe(false);
      expect(p.el("ok1").textContent).toMatch(/Thoát phiên nộp thầu/u);
    });

    it("[S1.181] nop-thau: /guest/rfq 200 mà thiếu tên doanh nghiệp ⇒ KHÔNG hỏi, không nút Thoát, Tiếp tục không mở gì", async () => {
      const thieu = { ...GOI_THAU_KHACH, supplier: undefined };
      const saiKieu = { ...GOI_THAU_KHACH, supplier: { legalName: 42 } };
      for (const body of [thieu, saiKieu]) {
        const p = await dungTrang("nop-thau", {
          hash: "", cookie: null, khach: true,
          thay: (l) => (l === "GET /guest/rfq" ? Promise.resolve({ status: 200, body }) : undefined),
        });
        expect(p.el("hoi-phien").hidden).toBe(true);
        expect(p.el("nut-thoat-khach").hidden).toBe(true);
        await p.bam("nut-dung-phien");
        expect(moBuoc3(p)).toBe(false);
        expect(p.trangThai.goi).toEqual(["GET /guest/rfq"]);
      }
    });

    it("[S1.181] nop-thau: Thoát ở khối hỏi ⇒ POST /guest/logout, về bước 1, câu báo nói phải xin link mới; Tiếp tục cũ không mở lại được", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true });
      await p.bam("nut-thoat-khach");
      expect(p.trangThai.goi).toEqual(["GET /guest/rfq", "POST /guest/logout"]);
      expect(p.el("hoi-phien").hidden).toBe(true);
      expect(p.el("nut-dung-phien").hidden).toBe(true);
      expect(p.el("nut-thoat-khach").hidden).toBe(true);
      expect(p.el("ok1").textContent).toMatch(/Đã thoát phiên nộp thầu/u);
      // [S1.181 / ADR-110] Đường quay lại là link bên mua GỬI LẠI cho chính lời mời — không phải "lời mời mới".
      expect(p.el("ok1").textContent).toMatch(/xin bên mua gửi lại link mời/u);
      expect(p.el("ok1").textContent).toMatch(/đúng báo giá đã nộp/u);
      await p.bam("nut-dung-phien");
      expect(moBuoc3(p)).toBe(false);
      expect(p.trangThai.goi).toEqual(["GET /guest/rfq", "POST /guest/logout"]);
    });

    it("[S1.181] nop-thau: Thoát từ bước 3 ⇒ bước 2–4 đóng; bảng giá, dòng tổng, ô mã OTP và gói thầu bị xoá; tiền tệ về VND; đếm ngược dừng và câu đếm ngược, lỗi bước 3–4 bị xoá", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true });
      await p.bam("nut-dung-phien");
      expect(moBuoc3(p)).toBe(true);
      const tbody = p.el("bang-hang").querySelector("tbody");
      expect(tbody.con, "đối chứng: bảng giá có một hàng trước khi thoát").toHaveLength(1);
      p.el("tong").textContent = "Tổng: 1.234.567.891 VND";
      p.el("ma").value = "654321";
      p.el("tien-te").value = "USD";
      // [lượt soi] Ba dòng mang chữ của phiên trước: câu đếm ngược (hạn của gói ấy) và hai dòng lỗi.
      for (const id of ["dem-nguoc", "loi3", "loi4"]) {
        p.el(id).textContent = `${id} của phiên trước`;
        p.el(id).hidden = false;
      }
      await p.bam("nut-thoat-khach");
      for (const id of ["dem-nguoc", "loi3", "loi4"]) {
        expect(p.el(id).textContent, id).toBe("");
        expect(p.el(id).hidden, id).toBe(true);
      }
      expect(tbody.con, "bảng giá của phiên đã thoát phải bị xoá").toEqual([]);
      expect(p.el("tong").textContent, "tổng giá dạng rõ của người trước").toBe("");
      expect(p.el("ma").value, "mã OTP của người trước").toBe("");
      expect(p.el("tien-te").value).toBe("VND");
      for (const b of ["b2", "b3", "b4"]) expect(p.el(b).hidden, b).toBe(true);
      expect(p.el("b1").lop.has("xong")).toBe(false);
      expect(bangGoiThau(p), "gói thầu của phiên đã thoát phải bị xoá").toEqual([]);
      expect(p.trangThai.xoaHen).toEqual([1]);
      expect(p.el("nut-thoat-khach").hidden).toBe(true);
    });

    it("[S1.181] nop-thau: nút Thoát ở bước 4 cùng việc — biên nhận của phiên đã thoát bị xoá", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true });
      await p.bam("nut-dung-phien");
      p.el("b4").hidden = false;
      for (const id of ["tt-bn", "mo-ta-pb", "van-ban", "chu-ky"]) p.el(id).textContent = `${id} của lần nộp vừa rồi`;
      await p.bam("nut-thoat-bn");
      expect(p.trangThai.goi).toEqual(["GET /guest/rfq", "GET /guest/rfq", "POST /guest/logout"]);
      expect(p.el("b4").hidden).toBe(true);
      for (const id of ["tt-bn", "mo-ta-pb", "van-ban", "chu-ky"]) expect(p.el(id).textContent, id).toBe("");
      expect(p.el("ok1").textContent).toMatch(/Đã thoát phiên nộp thầu/u);
    });

    it("[S1.181] nop-thau: Thoát khi phiên đã chết (401) ⇒ vẫn về bước 1; 500 hay mất mạng ⇒ báo lỗi ở bước 1, KHÔNG đóng bước", async () => {
      const p401 = await dungTrang("nop-thau", {
        hash: "", cookie: null, khach: true,
        thay: (l) => (l === "POST /guest/logout" ? Promise.resolve({ status: 401, body: { error: "x" } }) : undefined),
      });
      await p401.bam("nut-dung-phien");
      await p401.bam("nut-thoat-khach");
      expect(moBuoc3(p401)).toBe(false);
      expect(p401.el("ok1").textContent).toMatch(/Đã thoát phiên nộp thầu/u);
      for (const [ten, tl] of [
        ["500", () => Promise.resolve({ status: 500, body: { error: "loi noi bo" } })],
        ["mất mạng", () => Promise.reject(new Error("mat mang"))],
      ] as const) {
        // [S1.181 / lượt soi] Lỗi hiện CẠNH nút đã bấm: nút ở bước 4 nằm cuối trang, xa `#loi1`.
        for (const [nut, oLoi] of [["nut-thoat-khach", "loi1"], ["nut-thoat-bn", "loi4"]] as const) {
          const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true, thay: (l) => (l === "POST /guest/logout" ? tl() : undefined) });
          await p.bam("nut-dung-phien");
          p.el("b4").hidden = false;
          await p.bam(nut);
          const ca = `${ten} / ${nut}`;
          expect(moBuoc3(p), ca).toBe(true);
          expect(p.el(oLoi).hidden, ca).toBe(false);
          expect(p.el(oLoi === "loi1" ? "loi4" : "loi1").hidden, ca).toBe(true);
          expect(p.el("ok1").textContent, ca).not.toMatch(/Đã thoát/u);
          expect(p.el("nut-thoat-khach").hidden, ca).toBe(false);
          for (const id of ["nut-thoat-khach", "nut-thoat-bn"]) expect(p.el(id).disabled, `${ca}: ${id} phải bấm lại được`).toBe(false);
        }
      }
    });

    it("[S1.181] nop-thau: OTP sai ⇒ chưa có nút Thoát; xác minh OTP xong ⇒ nút Thoát hiện; Mở lời mời khác hay hashchange ⇒ nút Thoát ẩn", async () => {
      let lanXac = 0;
      const p = await dungTrang("nop-thau", {
        hash: `#${ORG}:maA`, cookie: null,
        thay: (l) => (l === "POST /guest/otp/verify" && ++lanXac === 1 ? Promise.resolve({ status: 422, body: { error: "ma khong dung" } }) : REDEEM(l)),
      });
      expect(p.el("nut-thoat-khach").hidden).toBe(true);
      await p.bam("nut-mo");
      expect(p.el("nut-thoat-khach").hidden, "chưa xác minh thì chưa có phiên để thoát").toBe(true);
      p.el("ma").value = "000000";
      await p.bam("nut-xac");
      expect(p.el("loi2").hidden).toBe(false);
      expect(p.el("nut-thoat-khach").hidden, "OTP sai: vẫn chưa có phiên — mã lời mời CHƯA bị tiêu thụ").toBe(true);
      p.el("ma").value = "123456";
      await p.bam("nut-xac");
      expect(p.el("nut-thoat-khach").hidden).toBe(false);
      expect(bangGoiThau(p)).toContain("Công ty Thép Miền Bắc");
      await p.doiFragment(`#${ORG}:maB`);
      expect(p.el("nut-thoat-khach").hidden).toBe(true);
      const q = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true, thay: REDEEM });
      await q.bam("nut-dung-phien");
      expect(q.el("nut-thoat-khach").hidden).toBe(false);
      q.el("org").value = ORG;
      q.el("token").value = "maGoTay";
      await q.bam("nut-mo");
      expect(q.el("nut-thoat-khach").hidden, "lời mời mới đang mở: nút Thoát của phiên cũ phải ẩn").toBe(true);
    });

    it("[S1.181] nop-thau: Tiếp tục mà phiên đã chết ⇒ nút Thoát ẩn cùng lúc báo ở bước 1", async () => {
      let lan = 0;
      const p = await dungTrang("nop-thau", {
        hash: "", cookie: null, khach: true,
        thay: (l) => (l === "GET /guest/rfq" && ++lan === 2 ? Promise.resolve({ status: 401, body: { error: "x" } }) : undefined),
      });
      expect(p.el("nut-thoat-khach").hidden).toBe(false);
      await p.bam("nut-dung-phien");
      expect(p.el("nut-thoat-khach").hidden).toBe(true);
      expect(p.el("loi1").textContent).toMatch(/hết hạn hoặc lời mời đã bị thu hồi/u);
    });

    it("[S1.181] nop-thau: Thoát về muộn SAU khi fragment đã đổi sang link khác ⇒ không đụng màn của người sau", async () => {
      const { g, thay } = giu("POST /guest/logout", 1);
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true, thay });
      const bam = p.bam("nut-thoat-khach");
      await cho();
      expect(p.el("nut-dung-phien").disabled, "Tiếp tục bị khoá trong lúc lời gọi thoát còn bay").toBe(true);
      await p.doiFragment(`#${ORG}:maCuaB`);
      p.el("ok1").textContent = "câu của người sau";
      g.tha();
      await bam;
      expect(p.el("ok1").textContent).toBe("câu của người sau");
      expect(p.el("token").value).toBe("maCuaB");
      expect(p.el("nut-thoat-khach").disabled).toBe(false);
    });
    it("[S1.181 / ADR-110] nop-thau: câu nói TRƯỚC hậu quả của việc thoát — lúc Tiếp tục và ở bước 4 — chỉ đường gửi lại link", async () => {
      const p = await dungTrang("nop-thau", { hash: "", cookie: null, khach: true });
      await p.bam("nut-dung-phien");
      expect(p.el("ok1").textContent).toMatch(/muốn vào lại thì xin bên mua gửi lại link mời/u);
      const html = readFileSync(new URL("../trang/nop-thau.html", import.meta.url), "utf8");
      const b4 = html.slice(html.indexOf('id="b4"'), html.indexOf("</section>", html.indexOf('id="b4"')));
      expect(b4).toMatch(/muốn sửa báo giá thì xin bên mua gửi lại\s+link mời — link gửi lại đưa về đúng báo giá này/u);
      expect(b4).toContain('id="loi4"');
    });

    it("[S1.181] nop-thau: đường OTP mà /guest/rfq không mang tên doanh nghiệp (API cũ) ⇒ bảng gói thầu KHÔNG có dòng doanh nghiệp, không chữ 'undefined'", async () => {
      const khongTen = { ...GOI_THAU_KHACH, supplier: undefined };
      const p = await dungTrang("nop-thau", {
        hash: `#${ORG}:maA`, cookie: null,
        thay: (l) => (l === "GET /guest/rfq" ? Promise.resolve({ status: 200, body: khongTen }) : REDEEM(l)),
      });
      await p.bam("nut-mo");
      p.el("ma").value = "123456";
      await p.bam("nut-xac");
      expect(moBuoc3(p)).toBe(true);
      const bang = bangGoiThau(p);
      expect(bang).toContain("Mua thép tấm quý IV");
      expect(bang).not.toContain("Doanh nghiệp được mời");
      expect(bang.join(" ")).not.toContain("undefined");
    });

    /** Gói thầu có một khoá công khai khớp thuật toán mà thư viện giả chọn — đủ để "Niêm phong và nộp" đi tới POST /guest/bids. */
    const GOI_NOP = { ...GOI_THAU_KHACH, publicKeys: [{ algorithm: "ECDH_P256", publicKey: "", keyVersion: "k1" }] };
    const BIEN_NHAN = { status: 201, body: { receipt: { bidVersionId: "bv-1", version: 1, submittedAt: "2026-09-27T00:00:00Z", canonicalText: "van ban", signature: "ky" } } };

    it("[S1.181 / lượt soi] nop-thau: trước khi niêm phong trang hỏi lại phiên — thẻ khác đã đổi cookie sang doanh nghiệp khác ⇒ DỪNG, không POST /guest/bids", async () => {
      let lanRfq = 0;
      const p = await dungTrang("nop-thau", {
        hash: "", cookie: null, khach: true,
        thay: (l) => {
          if (l === "GET /guest/rfq") {
            lanRfq += 1;
            return Promise.resolve({ status: 200, body: lanRfq <= 2 ? GOI_NOP : { ...GOI_NOP, supplier: { legalName: "Công ty Khác" } } });
          }
          return l === "POST /guest/bids" ? Promise.resolve(BIEN_NHAN) : undefined;
        },
      });
      await p.bam("nut-dung-phien");
      await p.bam("nut-nop");
      expect(p.trangThai.goi).toEqual(["GET /guest/rfq", "GET /guest/rfq", "GET /guest/rfq"]);
      expect(p.el("loi3").textContent).toMatch(/đã đổi sang «Công ty Khác»/u);
      expect(p.el("loi3").textContent).toMatch(/CHƯA được gửi/u);
      expect(p.el("b4").hidden).toBe(true);
      expect(p.el("nut-nop").disabled, "nút nộp bấm lại được").toBe(false);
      // Đối chứng: cùng phiên ⇒ đi tới POST /guest/bids và vẽ biên nhận.
      const q = await dungTrang("nop-thau", {
        hash: "", cookie: null, khach: true,
        thay: (l) => (l === "GET /guest/rfq" ? Promise.resolve({ status: 200, body: GOI_NOP }) : l === "POST /guest/bids" ? Promise.resolve(BIEN_NHAN) : undefined),
      });
      await q.bam("nut-dung-phien");
      await q.bam("nut-nop");
      expect(q.trangThai.goi).toEqual(["GET /guest/rfq", "GET /guest/rfq", "GET /guest/rfq", "POST /guest/bids"]);
      expect(q.el("b4").hidden).toBe(false);
    });

    it("[S1.181 / lượt soi] nop-thau: lần hỏi lại phiên trước khi niêm phong — CÙNG doanh nghiệp KHÁC gói ⇒ dừng; 401 ⇒ 'hết hạn'; 500 hay 503 không JSON ⇒ lỗi máy chủ, KHÔNG bảo đi xin link mới; không lần nào POST /guest/bids", async () => {
      const chayVoi = async (lan3: { status: number; body: unknown }) => {
        let lanRfq = 0;
        const p = await dungTrang("nop-thau", {
          hash: "", cookie: null, khach: true,
          thay: (l) => {
            if (l === "GET /guest/rfq") {
              lanRfq += 1;
              return Promise.resolve(lanRfq <= 2 ? { status: 200, body: GOI_NOP } : lan3);
            }
            return l === "POST /guest/bids" ? Promise.resolve(BIEN_NHAN) : undefined;
          },
        });
        await p.bam("nut-dung-phien");
        await p.bam("nut-nop");
        expect(p.trangThai.goi).not.toContain("POST /guest/bids");
        expect(p.el("nut-nop").disabled).toBe(false);
        expect(p.el("loi3").textContent).toMatch(/CHƯA được gửi/u);
        return p.el("loi3").textContent;
      };
      // Cùng tên doanh nghiệp, gói KHÁC: phong bì niêm cho gói r-1 không được đi vào luồng của gói r-2.
      expect(await chayVoi({ status: 200, body: { ...GOI_NOP, rfq: { ...GOI_NOP.rfq, id: "r-2" } } })).toMatch(/Phiên nộp thầu trên trình duyệt này đã đổi sang «Công ty Thép Miền Bắc»/u);
      expect(await chayVoi({ status: 401, body: { error: "phien khong hop le" } })).toMatch(/Phiên nộp thầu đã hết hạn hoặc đã thoát — báo giá CHƯA được gửi\. Xin bên mua gửi lại link mời\./u);
      for (const loi of [{ status: 500, body: { error: "loi may chu" } }, { status: 503, body: null }]) {
        const cau = await chayVoi(loi);
        expect(cau, String(loi.status)).toMatch(/Thử lại sau ít phút/u);
        expect(cau, String(loi.status)).not.toMatch(/hết hạn|gửi lại link/u);
      }
    });

    it("[S1.181 / lượt soi] nop-thau: lời hỏi lại phiên, hay lần nộp mất mạng, về muộn SAU khi đã Thoát ⇒ bị bỏ — không câu lỗi nào của phiên trước ở bước 3", async () => {
      for (const ca of ["hỏi lại phiên về muộn", "POST /guest/bids ném sau khi thoát"] as const) {
        const g = { tha: () => undefined as void };
        let lanRfq = 0;
        const p = await dungTrang("nop-thau", {
          hash: "", cookie: null, khach: true,
          thay: (l) => {
            if (l === "GET /guest/rfq") {
              lanRfq += 1;
              if (ca === "hỏi lại phiên về muộn" && lanRfq === 3) return new Promise((r) => { g.tha = () => { r({ status: 401, body: { error: "x" } }); }; });
              return Promise.resolve({ status: 200, body: GOI_NOP });
            }
            if (l === "POST /guest/bids") return new Promise((_r, tuChoi) => { g.tha = () => { tuChoi(new Error("mat mang")); }; });
            return undefined;
          },
        });
        await p.bam("nut-dung-phien");
        const nop = p.bam("nut-nop");
        await cho();
        await p.bam("nut-thoat-khach");
        expect(p.el("ok1").textContent, ca).toMatch(/Đã thoát phiên nộp thầu/u);
        g.tha();
        await nop;
        expect(p.el("loi3").textContent, ca).toBe("");
        expect(p.el("loi3").hidden, ca).toBe(true);
        expect(p.el("b3").hidden, ca).toBe(true);
      }
    });

    it("[S1.181 / lượt soi] nop-thau: biên nhận về muộn SAU khi đã Thoát ⇒ bị bỏ, bước 4 không mở lại dưới câu 'Đã thoát'", async () => {
      const g = { tha: () => undefined as void };
      const p = await dungTrang("nop-thau", {
        hash: "", cookie: null, khach: true,
        thay: (l) => {
          if (l === "GET /guest/rfq") return Promise.resolve({ status: 200, body: GOI_NOP });
          if (l === "POST /guest/bids") return new Promise((r) => { g.tha = () => { r(BIEN_NHAN); }; });
          return undefined;
        },
      });
      await p.bam("nut-dung-phien");
      const nop = p.bam("nut-nop");
      await cho();
      expect(p.trangThai.goi.at(-1)).toBe("POST /guest/bids");
      await p.bam("nut-thoat-khach");
      expect(p.el("ok1").textContent).toMatch(/Đã thoát phiên nộp thầu/u);
      g.tha();
      await nop;
      expect(p.el("b4").hidden).toBe(true);
      expect(p.el("tt-bn").con).toEqual([]);
      expect(p.el("ok1").textContent).toMatch(/Đã thoát phiên nộp thầu/u);
    });

    // [S1.181 / ADR-110] `/tao-thau`: nút Gửi lại link ở mỗi lời mời còn sống.
    const moDanhSachLoiMoi = async (thay: (l: string) => Promise<{ status: number; body: unknown }> | undefined) => {
      const p = await dungTrang("tao-thau", {
        hash: "", cookie: A,
        thay: (l) =>
          thay(l) ??
          (l === "GET /rfqs/r-1" ? Promise.resolve({ status: 200, body: { rfq: { id: "r-1", title: "Gói", status: "OPEN" } } })
            : l === "GET /rfqs/r-1/items" ? Promise.resolve({ status: 200, body: { items: [] } })
            : l === "GET /rfqs/r-1/invitations"
              ? Promise.resolve({ status: 200, body: { invitations: [{ id: "i-1", supplierName: "Công ty Thép", contactName: "Chị Lan", linkChannel: "EMAIL", status: "SENT", revokedAt: null }] } })
              : undefined),
      });
      await p.bam("nut-dung-phien");
      p.el("rfq").value = "r-1";
      await p.bam("nut-doc");
      await p.bam("nut-doc-moi");
      const tr = p.el("bang-moi").querySelector("tbody").con[0];
      const nut = tr?.con[4]?.con ?? [];
      return { p, nut };
    };

    it("[S1.181 / ADR-110] tao-thau: lời mời còn sống có HAI nút — Gửi lại link (POST /invitations/:id/reissue) và Thu hồi; 200, 429, lỗi khác", async () => {
      const { p, nut } = await moDanhSachLoiMoi(() => undefined);
      expect(nut.map((x) => x.textContent)).toEqual(["Gửi lại link", "Thu hồi"]);
      for (const f of nut[0]?.nghe["click"] ?? []) await f();
      expect(p.trangThai.goi.at(-1)).toBe("POST /invitations/i-1/reissue");
      // Bộ fetch giả trả 401 cho route lạ: lỗi hiện ở bước 5.
      expect(p.el("loi5").hidden).toBe(false);

      const ok = await moDanhSachLoiMoi((l) => (l === "POST /invitations/i-1/reissue" ? Promise.resolve({ status: 200, body: { reissued: true } }) : undefined));
      for (const f of ok.nut[0]?.nghe["click"] ?? []) await f();
      expect(ok.p.el("ok5").textContent).toMatch(/Đã gửi link mới tới Chị Lan qua EMAIL/u);
      expect(ok.p.el("ok5").textContent).toMatch(/đúng báo giá đã nộp/u);
      expect(ok.nut[0]?.disabled).toBe(false);

      const tran = await moDanhSachLoiMoi((l) => (l === "POST /invitations/i-1/reissue" ? Promise.resolve({ status: 429, body: { error: "da gui qua nhieu link cho loi moi nay" } }) : undefined));
      for (const f of tran.nut[0]?.nghe["click"] ?? []) await f();
      expect(tran.p.el("loi5").textContent).toMatch(/đủ số link cho phép trong một giờ/u);
    });

    it("[S1.181 / lượt soi] tao-thau: Gửi lại link TẮT trong lúc lời gọi còn bay (bấm đúp không tiêu hai chỗ của trần); mất mạng ⇒ câu báo, nút bật lại; 502 ⇒ nói link cũ đã hết hiệu lực và lần hỏng vẫn tính vào trần", async () => {
      const g = { tha: () => undefined as void };
      const bay = await moDanhSachLoiMoi((l) =>
        l === "POST /invitations/i-1/reissue" ? new Promise((r) => { g.tha = () => { r({ status: 200, body: { reissued: true } }); }; }) : undefined,
      );
      const lan1 = Promise.all((bay.nut[0]?.nghe["click"] ?? []).map((f) => f()));
      await cho();
      expect(bay.nut[0]?.disabled, "nút tắt ngay khi bấm — trình duyệt không phát click thứ hai cho nút tắt").toBe(true);
      g.tha();
      await lan1;
      expect(bay.nut[0]?.disabled).toBe(false);
      expect(bay.p.trangThai.goi.filter((x) => x === "POST /invitations/i-1/reissue")).toHaveLength(1);

      const matMang = await moDanhSachLoiMoi((l) => (l === "POST /invitations/i-1/reissue" ? Promise.reject(new Error("mat mang")) : undefined));
      for (const f of matMang.nut[0]?.nghe["click"] ?? []) await f();
      expect(matMang.nut[0]?.disabled, "mất mạng không được để nút kẹt ở trạng thái tắt").toBe(false);
      expect(matMang.p.el("loi5").textContent).toMatch(/mất kết nối tới máy chủ/u);
      expect(matMang.p.el("loi5").hidden).toBe(false);

      const hong = await moDanhSachLoiMoi((l) =>
        l === "POST /invitations/i-1/reissue"
          ? Promise.resolve({ status: 502, body: { error: "khong gui duoc link moi; link moi da thu hoi, link cu chua dung da het hieu luc" } })
          : undefined,
      );
      for (const f of hong.nut[0]?.nghe["click"] ?? []) await f();
      expect(hong.p.el("loi5").textContent).toMatch(/Link cũ chưa dùng của lời mời này đã hết hiệu lực/u);
      expect(hong.p.el("loi5").textContent).toMatch(/kể cả lần gửi hỏng/u);
      expect(hong.p.el("ok5").hidden).toBe(true);
    });

    // [S1.240 / khoản 276 / ADR-128] Thu hồi LOẠI báo giá của lời mời ấy khỏi lượt mở thầu, bảng so sánh và xếp hạng (S1.217) — câu báo
    // ~~nói báo giá cũ vẫn nằm trong gói~~ nói thẳng báo giá ấy không dự thầu nữa, và vẫn chỉ đường Gửi lại link thay cho mời lại.
    it("[S1.181 / ADR-110 · S1.240 / khoản 276] tao-thau: Thu hồi xong ⇒ câu báo nói báo giá đã nộp theo lời mời ấy KHÔNG dự thầu nữa và chỉ đường Gửi lại link, không khuyên mời lại", async () => {
      const { p, nut } = await moDanhSachLoiMoi((l) => (l === "POST /invitations/i-1/revoke" ? Promise.resolve({ status: 200, body: { revoked: true } }) : undefined));
      for (const f of nut[1]?.nghe["click"] ?? []) await f();
      expect(p.el("ok5").textContent).toMatch(/Báo giá đã nộp theo lời mời này \(nếu có\) không dự thầu nữa/u);
      expect(p.el("ok5").textContent, "ngữ nghĩa cũ của thu hồi (trước ADR-128) không được đứng lại").not.toMatch(/vẫn nằm trong gói thầu/u);
      expect(p.el("ok5").textContent).toMatch(/«Gửi lại link»/u);
      expect(p.el("ok5").textContent).not.toMatch(/Mời lại/u);
    });

    // [S1.240 / khoản 276 / ADR-128] Sau lần mở thầu đầu tiên thu hồi bị CHẶN ở máy chủ (`RFQ_STATUSES_AFTER_UNSEAL` của
    // `packages/invitation`) — ở tổ chức chưa bật S3 nút *Thu hồi* từng hiện ở mọi trạng thái và bấm là nhận 422. Nay nó ẩn ở sáu trạng
    // thái sau mở thầu; trước đó (OPEN, CLOSED) vẫn hiện — máy chủ nhận.
    it("[S1.240 / khoản 276] tao-thau: tổ chức chưa bật, gói đã mở thầu ⇒ dòng lời mời KHÔNG có nút Thu hồi; gói OPEN hay CLOSED ⇒ vẫn có", async () => {
      const voiTrangThai = (status: string) => (l: string) =>
        l === "GET /rfqs/r-1" ? Promise.resolve({ status: 200, body: { rfq: { id: "r-1", title: "Gói", status } } }) : undefined;
      for (const status of ["UNSEALED", "EVALUATING", "BAFO_OPEN", "BAFO_CLOSED", "BAFO_UNSEALED", "AWARDED"]) {
        const { nut } = await moDanhSachLoiMoi(voiTrangThai(status));
        expect(nut.map((x) => x.textContent), status).toEqual(["Gửi lại link"]);
      }
      for (const status of ["OPEN", "CLOSED"]) {
        const { nut } = await moDanhSachLoiMoi(voiTrangThai(status));
        expect(nut.map((x) => x.textContent), status).toEqual(["Gửi lại link", "Thu hồi"]);
      }
    });

    // ==========================================================================================
    // [S1.191 / S3.2c2] MÀN TẠO GÓI Ở TỔ CHỨC ĐÃ BẬT: bước mời lên trước, lời mời «chưa gửi», lần mở gói nói link nào chưa
    // đi, nút theo trạng thái gói, và trả về soạn thảo có lý do. Luồng lấy từ `GET /policy/versions` (`daBat`).
    // ==========================================================================================
    const moTaoThau = async (daBat: boolean, trangThaiGoi: string, thay: (l: string) => Promise<{ status: number; body: unknown }> | undefined = () => undefined) => {
      const p = await dungTrang("tao-thau", {
        hash: "", cookie: A,
        thay: (l) =>
          thay(l) ??
          (l === "GET /policy/versions" ? Promise.resolve({ status: 200, body: { phienBan: [], daBat, choKy: false } })
            // [S1.9101 / S3.3e1] Người xem giữ quyền mời (`coQuyenMoi`) — hai danh sách tự nạp; cả ba thân cùng lần nộp 1.
            : l === "GET /rfqs/r-1" ? Promise.resolve({ status: 200, body: { rfq: { id: "r-1", title: "Gói", status: trangThaiGoi, lanNop: 1 }, coQuyenMoi: true } })
            : l === "GET /rfqs/r-1/items" ? Promise.resolve({ status: 200, body: { items: [] } })
            : l === "GET /rfqs/r-1/invitations"
              ? Promise.resolve({ status: 200, body: { invitations: [{ id: "i-1", supplierName: "Công ty Thép", contactName: "Chị Lan", linkChannel: "EMAIL", status: "UNSENT", revokedAt: null }], lanNop: 1, trangThai: trangThaiGoi, canhTranh: null } })
            : l === "GET /rfqs/r-1/exceptions" ? Promise.resolve({ status: 200, body: { exceptions: [], lanNop: 1, trangThai: trangThaiGoi } })
              : undefined),
      });
      await p.bam("nut-dung-phien");
      p.el("rfq").value = "r-1";
      await p.bam("nut-doc");
      const dongMoi = () => p.el("bang-moi").querySelector("tbody").con[0];
      return { p, dongMoi };
    };

    it("[S1.234 / S4.3b] tao-thau: gói đã nộp ⇒ đọc trạng thái ánh xạ và vẽ cột hàng chuẩn; gói còn soạn ⇒ không đọc", async () => {
      const MOT_DONG = (coHangChuan: boolean, trangThai: string) => (l: string) =>
        l === "GET /rfqs/r-1/items" ? Promise.resolve({ status: 200, body: { items: [{ lineNo: 1, description: "Thép D10", quantity: "10", unit: "kg" }] } })
        : l === "GET /rfqs/r-1/mappings"
          ? Promise.resolve({ status: 200, body: { dong: [{ lineNo: 1, trangThai, hangChuan: trangThai === "TU_DONG" ? { id: "h-10", ma: "THEP-D10" } : null, lyDo: null }], coHangChuan } })
        : undefined;
      const oDong = (p: Awaited<ReturnType<typeof moTaoThau>>["p"]) => p.el("bang-hm").querySelector("tbody").con[0]?.con.map((o) => o.textContent);
      const nop = await moTaoThau(false, "PENDING_APPROVAL", MOT_DONG(true, "TU_DONG"));
      expect(nop.p.trangThai.goi).toContain("GET /rfqs/r-1/mappings");
      expect(oDong(nop.p)).toEqual(["1", "Thép D10", "10", "kg", "Tự động — THEP-D10"]);
      expect(nop.p.el("th-hang-chuan").hidden).toBe(false);
      const soan = await moTaoThau(false, "DRAFT", MOT_DONG(true, "TU_DONG"));
      expect(soan.p.trangThai.goi).not.toContain("GET /rfqs/r-1/mappings");
      expect(oDong(soan.p), "gói còn soạn: bảng bốn cột của hôm nay").toEqual(["1", "Thép D10", "10", "kg"]);
      expect(soan.p.el("th-hang-chuan").hidden).toBe(true);
      // [lượt soi L3] Tổ chức chưa khai hàng chuẩn nào: đọc, nhưng cột không hiện (spec §2.3).
      const mvp1 = await moTaoThau(false, "PENDING_APPROVAL", MOT_DONG(false, "CHUA_CHUAN_HOA"));
      expect(mvp1.p.trangThai.goi).toContain("GET /rfqs/r-1/mappings");
      expect(oDong(mvp1.p)).toEqual(["1", "Thép D10", "10", "kg"]);
      expect(mvp1.p.el("th-hang-chuan").hidden).toBe(true);
    });

    // ~~lớp `moi-truoc`~~ [S1.193 / S3.2c2] Bước mời dời THẬT trong DOM, không bằng CSS `order`: phím Tab và trình đọc màn
    // hình đi theo thứ tự DOM.
    const THU_TU_MVP1 = ["b1", "b2", "b3", "b4", "b5"];
    const THU_TU_S3 = ["b1", "b2", "b3", "b5", "b4"];
    it("[S1.191 / S3.2c2 · S1.193] tao-thau: tổ chức đã bật ⇒ bước mời đứng TRƯỚC bước phê duyệt TRONG DOM (số 4 và 5 đổi chỗ), hai đoạn ghi hiện; chưa bật ⇒ nguyên MVP1", async () => {
      const bat = await moTaoThau(true, "DRAFT");
      expect(bat.p.thuTuSection(), "thứ tự THẬT trong DOM — Tab và trình đọc màn hình đi theo nó").toEqual(THU_TU_S3);
      expect([bat.p.el("so-b5").textContent, bat.p.el("so-b4").textContent]).toEqual(["4", "5"]);
      expect([bat.p.el("ghi-s3-b4").hidden, bat.p.el("ghi-s3-b5").hidden]).toEqual([false, false]);
      const chua = await moTaoThau(false, "DRAFT");
      expect(chua.p.thuTuSection()).toEqual(THU_TU_MVP1);
      expect(chua.p.soLanDoi(), "tổ chức chưa bật: không dời gì").toBe(0);
      expect([chua.p.el("so-b4").textContent, chua.p.el("so-b5").textContent]).toEqual(["4", "5"]);
      expect([chua.p.el("ghi-s3-b4").hidden, chua.p.el("ghi-s3-b5").hidden]).toEqual([true, true]);
      // Đổi người (hashchange) đưa màn về luồng MVP1 tới khi người mới đăng nhập và màn hỏi lại.
      await bat.p.doiFragment(`#${ORG}:maCuaB`);
      expect(bat.p.thuTuSection()).toEqual(THU_TU_MVP1);
    });

    it("[S1.193 / S3.2c2] tao-thau: màn chỉ dời bước khi luồng đổi — nạp lại gói không dời lần nữa (dời một phần tử đang giữ tiêu điểm làm mất tiêu điểm)", async () => {
      const { p } = await moTaoThau(true, "DRAFT");
      expect(p.soLanDoi()).toBe(1);
      await p.bam("nut-doc");
      await p.bam("nut-doc");
      expect(p.thuTuSection()).toEqual(THU_TU_S3);
      expect(p.soLanDoi(), "hai lần nạp gói, không lần dời nào").toBe(1);
      // Đăng xuất đưa màn về MVP1: dời lại đúng một lần.
      await p.bam("nut-dang-xuat");
      expect(p.thuTuSection()).toEqual(THU_TU_MVP1);
      expect(p.soLanDoi()).toBe(2);
    });

    it("[S1.193 / S3.2c2 · K6] tao-thau: dòng lời mời mang nhãn «mời sau khi ký» khi `GET …/invitations` trả `moiSauKhiKy: true`; không thì chỉ trạng thái", async () => {
      const dong = (o: Record<string, unknown>) => ({ id: "i-1", supplierName: "Công ty Thép", contactName: "Chị Lan", linkChannel: "EMAIL", revokedAt: null, ...o });
      const { p, dongMoi } = await moTaoThau(true, "OPEN", (l) =>
        l === "GET /rfqs/r-1/invitations"
          ? Promise.resolve({ status: 200, body: { invitations: [dong({ status: "SENT", moiSauKhiKy: true }), dong({ id: "i-2", status: "UNSENT", moiSauKhiKy: true }), dong({ id: "i-3", status: "SENT", moiSauKhiKy: false })] } })
          : undefined);
      const bang = p.el("bang-moi").querySelector("tbody").con;
      expect(dongMoi()?.con[3]?.textContent).toBe("đã gửi · mời sau khi ký");
      expect(bang.map((tr) => tr.con[3]?.textContent)).toEqual(["đã gửi · mời sau khi ký", "chưa gửi · mời sau khi ký", "đã gửi"]);
    });

    it("[S1.193 / S3.2c2] tao-thau: nút và câu báo nói «Mở gói» ở cả hai luồng — mở THẦU là CLOSED→UNSEALED (spec S3 §3.3)", async () => {
      const html = readFileSync(new URL("../trang/tao-thau.html", import.meta.url), "utf8");
      expect(html).toContain('<button id="nut-mo">Mở gói</button>');
      expect(html).not.toMatch(/<button id="nut-mo">Mở thầu/u);
      const mo = (l: string) => (l === "POST /rfqs/r-1/open" ? Promise.resolve({ status: 200, body: { rfq: { id: "r-1", status: "OPEN" }, unsentInvitationIds: [] } }) : undefined);
      for (const daBat of [false, true]) {
        const { p } = await moTaoThau(daBat, "PENDING_APPROVAL", mo);
        await p.bam("nut-mo");
        expect(p.el("ok4").textContent, String(daBat)).toMatch(/^Đã mở gói\. /u);
        expect(p.el("ok4").textContent, String(daBat)).not.toMatch(/mở thầu/iu);
      }
    });

    it("[S1.191 / S3.2c2 · K4a · K6] tao-thau: tổ chức đã bật, gói DRAFT ⇒ dòng lời mời «chưa gửi», chỉ nút Thu hồi; gói OPEN ⇒ chỉ Gửi lại link; MVP1 ⇒ cả hai", async () => {
      const draft = await moTaoThau(true, "DRAFT");
      expect(draft.dongMoi()?.con[3]?.textContent).toBe("chưa gửi");
      // [S1.9101 / S3.3e1] Tổ chức đã bật: hai cột *Đã xác minh*, *Đếm được* đứng trước cột nút — thân không mang cờ ⇒ «—».
      expect(draft.dongMoi()?.con.slice(4, 6).map((x) => x.textContent)).toEqual(["—", "—"]);
      expect((draft.dongMoi()?.con.at(-1)?.con ?? []).map((x) => x.textContent)).toEqual(["Thu hồi"]);
      const mo = await moTaoThau(true, "OPEN");
      expect((mo.dongMoi()?.con.at(-1)?.con ?? []).map((x) => x.textContent)).toEqual(["Gửi lại link"]);
      const choDuyet = await moTaoThau(true, "PENDING_APPROVAL");
      expect(choDuyet.dongMoi()?.con.at(-1)?.con ?? []).toEqual([]);
      const mvp1 = await moTaoThau(false, "OPEN");
      await mvp1.p.bam("nut-doc-moi");
      expect((mvp1.dongMoi()?.con.at(-1)?.con ?? []).map((x) => x.textContent)).toEqual(["Gửi lại link", "Thu hồi"]);
    });

    // ==========================================================================================
    // [S1.9101 / S3.3e1] Tự nạp theo cờ (khoản 340), cùng lần nộp (lượt soi CAO-1), chỉ dẫn theo mã, ngoại lệ, ô chọn nhà cung cấp.
    // ==========================================================================================
    const ok200 = (body: unknown) => Promise.resolve({ status: 200, body });
    const dem = (p: Awaited<ReturnType<typeof moTaoThau>>["p"], lenh: string) => p.trangThai.goi.filter((l) => l === lenh).length;
    const thanCua = (p: Awaited<ReturnType<typeof moTaoThau>>["p"], lenh: string) => p.trangThai.than.filter((t) => t.lenh === lenh).at(-1)?.than;
    const doiChon = async (p: Awaited<ReturnType<typeof moTaoThau>>["p"], id: string, giaTri: string) => {
      p.el(id).value = giaTri;
      for (const f of p.el(id).nghe["change"] ?? []) await f();
      await cho();
    };

    it("[S1.9101 / S3.3e1 · khoản 340] tao-thau: người không giữ quyền mời đọc gói KHÔNG gọi hai danh sách; người giữ quyền gọi cả hai; nút cố ý vẫn gọi", async () => {
      const khong = await moTaoThau(true, "DRAFT", (l) =>
        l === "GET /rfqs/r-1" ? ok200({ rfq: { id: "r-1", title: "Gói", status: "DRAFT", lanNop: 1 }, coQuyenMoi: false }) : undefined);
      expect(khong.p.trangThai.goi).not.toContain("GET /rfqs/r-1/invitations");
      expect(khong.p.trangThai.goi).not.toContain("GET /rfqs/r-1/exceptions");
      await khong.p.bam("nut-xem-ngoai-le");
      expect(khong.p.trangThai.goi, "thao tác cố ý vẫn hỏi").toContain("GET /rfqs/r-1/exceptions");
      const co = await moTaoThau(true, "DRAFT");
      expect(co.p.trangThai.goi).toContain("GET /rfqs/r-1/invitations");
      expect(co.p.trangThai.goi).toContain("GET /rfqs/r-1/exceptions");
      // Tổ chức chưa bật: không ngoại lệ nào, bảng lời mời theo luồng MVP1 (người mua bấm Đọc danh sách lời mời).
      const mvp1 = await moTaoThau(false, "DRAFT");
      expect(mvp1.p.trangThai.goi).not.toContain("GET /rfqs/r-1/exceptions");
    });

    it("[S1.9101 / S3.3e1 · lượt soi CAO-1] tao-thau: danh sách của lần nộp khác ⇒ đọc lại TRỌN gói; vẫn lệch ⇒ Phê duyệt không gửi; khớp ⇒ gửi đúng lần nộp", async () => {
      const lech = await moTaoThau(true, "PENDING_APPROVAL", (l) =>
        l === "GET /rfqs/r-1/exceptions" ? ok200({ exceptions: [], lanNop: 2, trangThai: "PENDING_APPROVAL" }) : undefined);
      expect(dem(lech.p, "GET /rfqs/r-1"), "một lần đọc gói, một lần đọc lại trọn").toBe(2);
      expect(lech.p.el("loi4").textContent).toMatch(/chưa chắc là của lần nộp này/u);
      await lech.p.bam("nut-duyet");
      expect(lech.p.trangThai.goi).not.toContain("POST /rfqs/r-1/approve");
      const khop = await moTaoThau(true, "PENDING_APPROVAL", (l) => (l === "POST /rfqs/r-1/approve" ? ok200({}) : undefined));
      expect(dem(khop.p, "GET /rfqs/r-1")).toBe(1);
      await khop.p.bam("nut-duyet");
      expect(thanCua(khop.p, "POST /rfqs/r-1/approve")).toEqual({ lanNop: 1 });
    });

    it("[S1.9101 / S3.3e1 · lượt soi CAO-1] tao-thau: lần duyệt hỏng ⇒ đọc lại trọn gói, câu của máy chủ ở lại", async () => {
      const { p } = await moTaoThau(true, "PENDING_APPROVAL", (l) =>
        l === "POST /rfqs/r-1/approve" ? Promise.resolve({ status: 422, body: { error: "Gói đã được nộp lại sau lần bạn đọc" } }) : undefined);
      const truoc = dem(p, "GET /rfqs/r-1");
      await p.bam("nut-duyet");
      expect(dem(p, "GET /rfqs/r-1")).toBe(truoc + 1);
      expect(p.el("loi4").textContent).toBe("Gói đã được nộp lại sau lần bạn đọc");
    });

    it("[S1.9101 / S3.3e1] tao-thau: lời từ chối có mã ⇒ câu máy chủ rồi MỘT câu chỉ dẫn; không mã ⇒ chỉ câu máy chủ", async () => {
      const coMa = await moTaoThau(true, "DRAFT", (l) =>
        l === "POST /rfqs/r-1/submit" ? Promise.resolve({ status: 422, body: { error: "Gói chưa đủ cạnh tranh.", ma: "K2_THIEU_CANH_TRANH" } }) : undefined);
      await coMa.p.bam("nut-nop-duyet");
      expect(coMa.p.el("loi4").textContent).toMatch(/^Gói chưa đủ cạnh tranh\. Trên màn: chọn nhà cung cấp ở «Chọn nhà cung cấp có sẵn»/u);
      const khongMa = await moTaoThau(true, "DRAFT", (l) =>
        l === "POST /rfqs/r-1/submit" ? Promise.resolve({ status: 422, body: { error: "Gói thiếu hạng mục." } }) : undefined);
      await khongMa.p.bam("nut-nop-duyet");
      expect(khongMa.p.el("loi4").textContent).toBe("Gói thiếu hạng mục.");
    });

    it("[S1.9101 / S3.3e1] tao-thau: lập ngoại lệ — OTHER dưới sàn không gửi; loại chọn sẵn theo số lời mời; thân đúng ba trường", async () => {
      const { p } = await moTaoThau(true, "DRAFT", (l) =>
        l === "POST /rfqs/r-1/exceptions" ? Promise.resolve({ status: 201, body: { exception: {} } }) : undefined);
      expect(p.el("khoi-lap-ngoai-le").hidden).toBe(false);
      expect(p.el("loai-ngoai-le").value, "một lời mời còn sống ⇒ một nguồn duy nhất").toBe("SINGLE_SOURCE");
      p.el("ma-ly-do").value = "OTHER";
      p.el("giai-trinh").value = "ngắn quá";
      await p.bam("nut-lap-ngoai-le");
      expect(p.trangThai.goi).not.toContain("POST /rfqs/r-1/exceptions");
      expect(p.el("loi-nl").textContent).toMatch(/từ 100 byte/u);
      p.el("ma-ly-do").value = "EMERGENCY";
      p.el("giai-trinh").value = "  Đường ống vỡ, cần thay trong ngày  ";
      await p.bam("nut-lap-ngoai-le");
      expect(thanCua(p, "POST /rfqs/r-1/exceptions")).toEqual({ loai: "SINGLE_SOURCE", maLyDo: "EMERGENCY", giaiTrinh: "Đường ống vỡ, cần thay trong ngày" });
      expect(p.el("ok-nl").textContent).toMatch(/không còn là người ký độc lập/u);
    });

    it("[S1.9101 / S3.3e1] tao-thau: rút ngoại lệ chỉ ở DRAFT và đòi lý do; ở PENDING_APPROVAL bảng chỉ đọc", async () => {
      const NL = { exceptions: [{ id: "e-1", loai: "SINGLE_SOURCE", maLyDo: "EMERGENCY", giaiTrinh: "Vỡ ống", lapLuc: "2026-10-06T00:00:00Z", rut: null }], lanNop: 1, trangThai: "DRAFT" };
      const { p } = await moTaoThau(true, "DRAFT", (l) =>
        l === "GET /rfqs/r-1/exceptions" ? ok200(NL)
        : l === "POST /rfqs/r-1/exceptions/e-1/withdraw" ? ok200({ exception: {} })
        : undefined);
      const dong = p.el("bang-ngoai-le").querySelector("tbody").con[0];
      expect(dong?.con.slice(0, 5).map((x) => x.textContent)).toEqual(["Một nguồn duy nhất", "Khẩn cấp", "Vỡ ống", expect.any(String), "còn hiệu lực"]);
      const rut = dong?.con[5]?.con[0];
      expect(rut?.textContent).toBe("Rút");
      for (const f of rut?.nghe["click"] ?? []) await f();
      expect(p.trangThai.goi).not.toContain("POST /rfqs/r-1/exceptions/e-1/withdraw");
      p.el("ly-do-rut").value = "Tìm được nhà cung cấp thứ hai";
      for (const f of rut?.nghe["click"] ?? []) await f();
      expect(thanCua(p, "POST /rfqs/r-1/exceptions/e-1/withdraw")).toEqual({ reason: "Tìm được nhà cung cấp thứ hai" });
      const cho = await moTaoThau(true, "PENDING_APPROVAL", (l) =>
        l === "GET /rfqs/r-1/exceptions" ? ok200({ ...NL, trangThai: "PENDING_APPROVAL" }) : undefined);
      expect(cho.p.el("khoi-lap-ngoai-le").hidden).toBe(true);
      expect(cho.p.el("bang-ngoai-le").querySelector("tbody").con[0]?.con[5]?.con).toEqual([]);
    });

    it("[S1.9101 / S3.3e1 · lượt soi TRUNG-1] tao-thau: chọn nhà cung cấp có sẵn ⇒ người liên hệ và trạng thái xác minh; không thêm người liên hệ vào hồ sơ có sẵn; mời đúng cặp", async () => {
      const { p } = await moTaoThau(true, "DRAFT", (l) =>
        l === "GET /suppliers" ? ok200({ suppliers: [{ id: "s-1", legalName: "Thép A", taxCode: "0101010101", status: "ACTIVE" }, { id: "s-2", legalName: "Ngừng", taxCode: null, status: "SUSPENDED" }] })
        : l === "GET /suppliers/s-1/contacts" ? ok200({ contacts: [{ id: "c-1", fullName: "Chị Lan", email: "lan@thep.vn", phone: "0901", status: "ACTIVE" }, { id: "c-0", fullName: "Cũ", email: "cu@thep.vn", phone: null, status: "SUSPENDED" }] })
        : l === "GET /suppliers/s-1/verification" ? ok200({ verification: { loai: "VERIFIED", conHieuLuc: true, hetHanAt: "2027-01-01T00:00:00Z" } })
        : l === "POST /rfqs/r-1/invitations" ? Promise.resolve({ status: 201, body: { invitation: { status: "UNSENT" } } })
        : undefined);
      expect(p.el("chon-ncc").con.map((o) => o.textContent)).toEqual(["— chọn nhà cung cấp —", "Thép A — MST 0101010101"]);
      await doiChon(p, "chon-ncc", "s-1");
      expect(p.el("chon-lh").con.map((o) => o.value)).toEqual(["c-1"]);
      expect(p.el("xac-minh-ncc").textContent).toMatch(/^Đã xác minh, còn hiệu lực tới /u);
      expect(p.el("ghi-them-lh").hidden).toBe(false);
      await p.bam("nut-them-lh");
      expect(p.trangThai.goi).not.toContain("POST /suppliers/s-1/contacts");
      expect(p.el("loi5").textContent).toMatch(/^Chỉ thêm người liên hệ được cho nhà cung cấp vừa tạo/u);
      await p.bam("nut-moi");
      expect(thanCua(p, "POST /rfqs/r-1/invitations")).toEqual({ supplierId: "s-1", contactId: "c-1" });
    });

    it("[S1.9101 / S3.3e1 · lượt soi TRUNG-2] tao-thau: câu số nhóm của K2 trên bảng lời mời, và hai cột cờ", async () => {
      const { p, dongMoi } = await moTaoThau(true, "DRAFT", (l) =>
        l === "GET /rfqs/r-1/invitations"
          ? ok200({ invitations: [{ id: "i-1", supplierName: "Công ty Thép", contactName: "Chị Lan", linkChannel: "EMAIL", status: "UNSENT", revokedAt: null, demDuoc: true, xacMinhConHieuLuc: true }], lanNop: 1, trangThai: "DRAFT", canhTranh: { soNhomDemDuoc: 1, toiThieu: 2 } })
          : undefined);
      expect(p.el("tom-tat-canh-tranh").textContent).toMatch(/^Đếm được 1\/2 nhóm/u);
      expect(dongMoi()?.con.slice(4, 6).map((x) => x.textContent)).toEqual(["có", "có"]);
      expect(dongMoi()?.con.slice(0, 6).map((x) => x.dataset["nhan"])).toEqual(["Nhà cung cấp", "Người liên hệ", "Kênh", "Trạng thái", "Đã xác minh", "Đếm được"]);
    });

    // [S1.9101 / S3.3e1 · lượt soi CAO-2] `/nha-cung-cap`: người xác minh thấy mọi người liên hệ; lần xác minh gửi băm đã thấy.
    const BAM_A = "a".repeat(64);
    const HO_SO = {
      hoSo: [{
        supplierId: "s-1", legalName: "Thép A", taxCode: "0101010101", status: "ACTIVE", bamHoSo: BAM_A, doiSauXacMinh: true, boiTen: "TC hai",
        xacMinh: { supplierId: "s-1", loai: "VERIFIED", conHieuLuc: false, hetHanAt: "2027-01-01T00:00:00Z", boi: "u", luc: "2026-10-01T00:00:00Z", lyDo: null },
        contacts: [
          { id: "c-1", fullName: "Chị Lan", email: "lan@thep.vn", phone: "0901", status: "ACTIVE", createdAt: "2026-09-01T00:00:00Z", themBoiTen: "Người nhập" },
          { id: "c-2", fullName: "Người lạ", email: "la@khac.vn", phone: null, status: "ACTIVE", createdAt: "2026-10-03T00:00:00Z", themBoiTen: "PM hai" },
        ],
      }],
    };
    const moNhaCungCap = async (thay: (l: string) => Promise<{ status: number; body: unknown }> | undefined) => {
      const p = await dungTrang("nha-cung-cap", { hash: "", cookie: A, thay: (l) => thay(l) ?? (l === "GET /supplier-verifications" ? ok200(HO_SO) : undefined) });
      await p.bam("nut-dung-phien");
      const dong = () => p.el("bang-ho-so").querySelector("tbody").con[0];
      return { p, dong };
    };

    it("[S1.9101 / S3.3e1 · lượt soi CAO-2] nha-cung-cap: bảng nói hồ sơ đổi sau xác minh, đánh dấu người liên hệ thêm sau, và Xác minh gửi ĐÚNG băm đang hiện", async () => {
      const { p, dong } = await moNhaCungCap((l) => (l === "POST /suppliers/s-1/verify" ? Promise.resolve({ status: 201, body: { verification: {} } }) : undefined));
      expect(dong()?.con[0]?.textContent).toBe("Thép A — MST 0101010101");
      expect(dong()?.con[1]?.textContent).toMatch(/^Hết hiệu lực: hồ sơ đã đổi sau lần xác minh/u);
      const lh = dong()?.con[2]?.con[0]?.con.map((li) => li.textContent) ?? [];
      expect(lh).toHaveLength(2);
      expect(lh[1]).toMatch(/^Người lạ — la@khac\.vn, không số điện thoại · thêm bởi PM hai, .* · ⚠ thêm SAU lần xác minh gần nhất$/u);
      const nut = dong()?.con[3]?.con ?? [];
      expect(nut.map((x) => x.textContent)).toEqual(["Xác minh lại", "Thu hồi"]);
      for (const f of nut[0]?.nghe["click"] ?? []) await f();
      expect(p.trangThai.than.filter((t) => t.lenh === "POST /suppliers/s-1/verify").at(-1)?.than).toEqual({ bamDaXem: BAM_A });
    });

    it("[S1.9101 / S3.3e1 · lượt soi CAO-2] nha-cung-cap: máy chủ từ chối (hồ sơ vừa đổi) ⇒ câu của máy chủ và bảng đọc lại; thu hồi đòi lý do", async () => {
      const { p, dong } = await moNhaCungCap((l) =>
        l === "POST /suppliers/s-1/verify" ? Promise.resolve({ status: 422, body: { error: "Hồ sơ nhà cung cấp đã đổi từ lúc bạn xem" } })
        : l === "POST /suppliers/s-1/verification/revoke" ? ok200({ verification: {} })
        : undefined);
      const truoc = p.trangThai.goi.filter((l) => l === "GET /supplier-verifications").length;
      const nut = dong()?.con[3]?.con ?? [];
      for (const f of nut[0]?.nghe["click"] ?? []) await f();
      expect(p.el("loi2").textContent).toBe("Hồ sơ nhà cung cấp đã đổi từ lúc bạn xem");
      expect(p.trangThai.goi.filter((l) => l === "GET /supplier-verifications").length).toBe(truoc + 1);
      const thuHoi = dong()?.con[3]?.con[1];
      for (const f of thuHoi?.nghe["click"] ?? []) await f();
      expect(p.trangThai.goi).not.toContain("POST /suppliers/s-1/verification/revoke");
      p.el("ly-do-thu-hoi").value = "MST không khớp đăng ký kinh doanh";
      for (const f of thuHoi?.nghe["click"] ?? []) await f();
      expect(p.trangThai.than.filter((t) => t.lenh === "POST /suppliers/s-1/verification/revoke").at(-1)?.than).toEqual({ reason: "MST không khớp đăng ký kinh doanh" });
    });

    it("[S1.191 / S3.2c2 · ADR-113] tao-thau: mời ở DRAFT (UNSENT) ⇒ câu nói link CHƯA đi; mời thêm ở OPEN gửi hỏng ⇒ lỗi chỉ đường Gửi lại link", async () => {
      const moi = (loi: unknown) => (l: string) =>
        l === "POST /rfqs/r-1/invitations" ? Promise.resolve({ status: 201, body: { invitation: loi } })
          : l === "POST /suppliers" ? Promise.resolve({ status: 201, body: { supplier: { id: "s-1" } } })
          : l === "POST /suppliers/s-1/contacts" ? Promise.resolve({ status: 201, body: { contact: { id: "c-1" } } })
          : undefined;
      for (const [trangThai, loiMoi, o, mau] of [
        ["DRAFT", { id: "i-2", status: "UNSENT", moiSauKhiKy: false }, "ok5", /Link CHƯA đi/u],
        ["OPEN", { id: "i-2", status: "UNSENT", moiSauKhiKy: true }, "loi5", /Gửi lại link/u],
      ] as const) {
        const { p } = await moTaoThau(true, trangThai, moi(loiMoi));
        p.el("ncc-ten").value = "x";
        // Màn giữ id nhà cung cấp và liên hệ trong phiên — dựng qua hai route giả ở trên.
        await p.bam("nut-tao-ncc");
        await p.bam("nut-them-lh");
        await p.bam("nut-moi");
        expect(p.trangThai.goi, trangThai).toContain("POST /rfqs/r-1/invitations");
        expect(p.el(o).textContent, trangThai).toMatch(mau);
      }
    });

    it("[S1.191 / S3.2c2 · ADR-113] tao-thau: mở gói trả `unsentInvitationIds` không rỗng ⇒ LỖI nói đúng số link chưa đi; rỗng ⇒ ok nói mọi link đã đi", async () => {
      const mo = (ds: string[]) => (l: string) => (l === "POST /rfqs/r-1/open" ? Promise.resolve({ status: 200, body: { rfq: { id: "r-1", status: "OPEN" }, unsentInvitationIds: ds } }) : undefined);
      const hong = await moTaoThau(true, "PENDING_APPROVAL", mo(["i-1"]));
      await hong.p.bam("nut-mo");
      expect(hong.p.el("loi4").textContent).toMatch(/Nhưng 1 link mời CHƯA gửi được/u);
      const du = await moTaoThau(true, "PENDING_APPROVAL", mo([]));
      await du.p.bam("nut-mo");
      expect(du.p.el("ok4").textContent).toMatch(/mọi nhà cung cấp trong danh sách/u);
    });

    it("[S1.191 / S3.2c2 · 077] tao-thau: «Trả về soạn thảo» chỉ hiện ở PENDING_APPROVAL của tổ chức đã bật; lý do rỗng ⇒ không gọi máy chủ; có lý do ⇒ POST return-to-draft", async () => {
      expect((await moTaoThau(true, "DRAFT")).p.el("khoi-tra-ve").hidden).toBe(true);
      expect((await moTaoThau(false, "PENDING_APPROVAL")).p.el("khoi-tra-ve").hidden).toBe(true);
      const { p } = await moTaoThau(true, "PENDING_APPROVAL", (l) => (l === "POST /rfqs/r-1/return-to-draft" ? Promise.resolve({ status: 200, body: { rfq: { id: "r-1", status: "DRAFT" } } }) : undefined));
      expect(p.el("khoi-tra-ve").hidden).toBe(false);
      p.el("ly-do-tra-ve").value = "   ";
      await p.bam("nut-tra-ve");
      expect(p.trangThai.goi).not.toContain("POST /rfqs/r-1/return-to-draft");
      expect(p.el("loi4").textContent).toMatch(/Cần ghi lý do/u);
      p.el("ly-do-tra-ve").value = "Them nha cung cap thu nam";
      await p.bam("nut-tra-ve");
      expect(p.trangThai.goi).toContain("POST /rfqs/r-1/return-to-draft");
      expect(p.el("ok4").textContent).toMatch(/Đã trả gói về soạn thảo/u);
      expect(p.el("ly-do-tra-ve").value).toBe("");
    });

    // [S1.199 / S4.2b] Màn dữ liệu nền — spec S4 §8.10: vai mới là một NGƯỜI MỚI, và màn nói ra điều ấy trước khi tổ chức dùng.
    const moDuLieu = async (danhSach: Record<string, unknown>, thay?: (l: string) => Promise<{ status: number; body: unknown }> | undefined) => {
      const p = await dungTrang("du-lieu", {
        hash: "", cookie: A,
        thay: (l) => thay?.(l) ?? (l === "GET /items" ? Promise.resolve({ status: 200, body: danhSach }) : undefined),
      });
      await p.bam("nut-dung-phien");
      return p;
    };
    const PHAN_GHI = ["khoi-phien-ban", "khoi-bi-danh", "khoi-quy-doi", "khoi-bi-danh-dv"];

    it("[S1.199 / S4.2b · §8.10] du-lieu: tổ chức chưa ai giữ vai quản lý dữ liệu ⇒ câu đòi một NGƯỜI MỚI, không bước tạo, không khối ghi nào", async () => {
      const p = await moDuLieu({ hangChuan: [], conNua: false, choGhi: false, soNguoiQuanLy: 0 });
      expect(p.el("vai-quan-ly").hidden).toBe(false);
      expect(p.el("vai-quan-ly").textContent).toMatch(/NGƯỜI MỚI/u);
      expect(p.el("vai-quan-ly").textContent).toMatch(/Tài chính/u);
      expect(p.el("b3").hidden).toBe(true);
      for (const id of PHAN_GHI) expect(p.el(id).hidden, id).toBe(true);
      const q = await moDuLieu({ hangChuan: [], conNua: false, choGhi: false, soNguoiQuanLy: 2 });
      expect(q.el("vai-quan-ly").textContent).toMatch(/2 người giữ vai này; bạn chỉ xem được/u);
      const r = await moDuLieu({ hangChuan: [], conNua: false, choGhi: true, soNguoiQuanLy: 1 });
      expect(r.el("vai-quan-ly").hidden).toBe(true);
      expect(r.el("b3").hidden).toBe(false);
      for (const id of PHAN_GHI) expect(r.el(id).hidden, id).toBe(false);
    });

    it("[S1.199 / S4.2b] du-lieu: `conNua` ⇒ màn nói nó chỉ hiện phần đầu; mã sai hình dạng hay thuộc tính sai ⇒ báo, KHÔNG gọi máy chủ", async () => {
      const p = await moDuLieu({ hangChuan: [{ id: "h-1", ma: "THEP-D10", ten: "Thép D10", donViGoc: "kg", trangThai: "DANG_DUNG" }], conNua: true, choGhi: true, soNguoiQuanLy: 1 });
      expect(p.el("con-nua").textContent).toMatch(/1 hàng chuẩn đầu tiên/u);
      p.el("tao-ma").value = "thep-d12";
      await p.bam("nut-tao");
      expect(p.el("loi3").textContent).toMatch(/Mã viết hoa/u);
      p.el("tao-ma").value = "THEP-D12";
      p.el("tao-thuoc-tinh").value = "Mac: CB300";
      await p.bam("nut-tao");
      expect(p.el("loi3").textContent).toMatch(/dòng 1/u);
      expect(p.trangThai.goi).not.toContain("POST /items");
      p.el("tao-thuoc-tinh").value = "mac: CB300";
      p.el("tao-trong-yeu").value = "mac";
      await p.bam("nut-tao");
      expect(p.trangThai.goi).toContain("POST /items");
    });

    it("[S1.199 / S4.2b · lượt đi thử T4] du-lieu: bấm đúp một nút ghi ⇒ ĐÚNG một lời gọi; nhập sai sau một lần thành công ⇒ câu thành công cũ biến mất", async () => {
      let tha: () => void = () => undefined;
      const p = await moDuLieu({ hangChuan: [], conNua: false, choGhi: true, soNguoiQuanLy: 1 }, (l) =>
        l === "POST /uom/aliases" ? new Promise((r) => { tha = () => { r({ status: 201, body: { biDanh: { biDanhSach: "mt", code: "t" } } }); }; }) : undefined);
      p.el("bdv-moi").value = "MT";
      p.el("bdv-don-vi").value = "tấn";
      const bam = p.el("nut-bi-danh-dv").nghe["click"]?.[0];
      const lan1 = bam?.();
      const lan2 = bam?.();
      expect(p.el("nut-bi-danh-dv").disabled, "nút khoá trong lúc lời gọi còn bay").toBe(true);
      tha();
      await Promise.all([lan1, lan2]);
      await cho();
      expect(p.trangThai.goi.filter((g) => g === "POST /uom/aliases")).toHaveLength(1);
      expect(p.el("nut-bi-danh-dv").disabled).toBe(false);
      expect(p.el("ok5").textContent).toMatch(/Đã khai "MT" là tấn/u);
      p.el("bdv-moi").value = "";
      await p.bam("nut-bi-danh-dv");
      expect(p.el("loi5").textContent).toMatch(/Nhập cả bí danh và đơn vị/u);
      expect(p.el("ok5").hidden, "câu thành công của lần trước không nằm cạnh câu lỗi").toBe(true);
    });

    // [S1.234 / S4.3b] Bước 6 — hàng đợi ánh xạ.
    const HANG_DOI = {
      dong: [
        {
          rfqId: "r-9", tieuDe: "Mua thep", lineNo: 2, moTa: "Thép vằn D12", donVi: "kg", soLuong: "10.0000", bam: "ab".repeat(32),
          goiY: { ketQua: "GOI_Y", doTinCay: "0.9400", phienBan: 1, ungVien: [{ hangChuanId: "h-12", ma: "THEP-D12", diem: 0.94 }], tacGia: "Tran Nguoi Mua" },
        },
      ],
      conNua: false,
    };
    const HANG_D12 = { hangChuan: [{ id: "h-12", ma: "THEP-D12", ten: "Thép vằn D12", donViGoc: "kg", trangThai: "DANG_DUNG" }], conNua: false, choGhi: true, soNguoiQuanLy: 1 };
    const nutXuLy = (p: Awaited<ReturnType<typeof moDuLieu>>) => p.el("bang-hang-doi").querySelector("tbody").con[0]?.con.at(-1)?.con[0];

    it("[S1.234 / S4.3b] du-lieu: hàng đợi — «Xử lý» chỉ khi ghi được; duyệt gửi ứng viên đầu, bí danh và lý do; bấm đúp một lời gọi; xong ⇒ khối đóng, hàng đợi đọc lại", async () => {
      const chiXem = await moDuLieu({ ...HANG_D12, choGhi: false, soNguoiQuanLy: 1 }, (l) => (l === "GET /mapping-queue" ? Promise.resolve({ status: 200, body: HANG_DOI }) : undefined));
      expect(chiXem.el("bang-hang-doi").querySelector("tbody").con).toHaveLength(1);
      expect(nutXuLy(chiXem), "người chỉ xem không có nút xử lý").toBeUndefined();

      let tha: () => void = () => undefined;
      const p = await moDuLieu(HANG_D12, (l) => {
        if (l === "GET /mapping-queue") return Promise.resolve({ status: 200, body: HANG_DOI });
        if (l === "POST /rfqs/r-9/items/2/mapping") return new Promise((r) => { tha = () => { r({ status: 201, body: { seq: "7" } }); }; });
        return undefined;
      });
      await nutXuLy(p)?.nghe["click"]?.[0]?.();
      expect(p.el("khoi-xu-ly").hidden).toBe(false);
      expect(p.el("xl-hang").con.map((x) => x.textContent)).toEqual(["THEP-D12 — Thép vằn D12 (94%)"]);
      p.el("xl-hang").value = "h-12";
      p.el("xl-ly-do").value = "  ";
      const bam = p.el("nut-duyet").nghe["click"]?.[0];
      const lan1 = bam?.();
      const lan2 = bam?.();
      // [lượt soi L4] Nút khác của khối cũng khoá trong lúc lần duyệt còn bay: bác không gửi được song song.
      const lanBac = p.el("nut-bac").nghe["click"]?.[0]?.();
      tha();
      await Promise.all([lan1, lan2, lanBac]);
      await cho();
      const gui = p.trangThai.than.filter((t) => t.lenh === "POST /rfqs/r-9/items/2/mapping");
      expect(gui).toEqual([{ lenh: "POST /rfqs/r-9/items/2/mapping", than: { hangChuanId: "h-12", lyDo: null, taoBiDanh: true, bam: "ab".repeat(32) } }]);
      expect(p.el("khoi-xu-ly").hidden).toBe(true);
      expect(p.el("ok6").textContent).toMatch(/Đã duyệt dòng 2/u);
      expect(p.trangThai.goi.filter((g) => g === "GET /mapping-queue")).toHaveLength(2);
    });

    it("[S1.234 / S4.3b] du-lieu: máy chủ từ chối ⇒ in câu của máy chủ, khối giữ dòng; bác gửi hàng chuẩn null kèm lý do; mã sai hình dạng ⇒ không gọi", async () => {
      let lan = 0;
      const p = await moDuLieu(HANG_D12, (l) => {
        if (l === "GET /mapping-queue") return Promise.resolve({ status: 200, body: HANG_DOI });
        if (l === "POST /rfqs/r-9/items/2/mapping") {
          lan += 1;
          return Promise.resolve(lan === 1 ? { status: 422, body: { error: "Bác một dòng đã từng có gợi ý cần lý do (CAN_LY_DO)" } } : { status: 201, body: { seq: "8" } });
        }
        return undefined;
      });
      await nutXuLy(p)?.nghe["click"]?.[0]?.();
      await p.bam("nut-bac");
      expect(p.el("loi6").textContent).toMatch(/CAN_LY_DO/u);
      expect(p.el("khoi-xu-ly").hidden).toBe(false);
      p.el("xl-ly-do").value = "hang nhap khau";
      await p.bam("nut-bac");
      expect(p.trangThai.than.filter((t) => t.lenh === "POST /rfqs/r-9/items/2/mapping").map((t) => t.than)).toEqual([
        { hangChuanId: null, lyDo: null, bam: "ab".repeat(32) },
        { hangChuanId: null, lyDo: "hang nhap khau", bam: "ab".repeat(32) },
      ]);
      expect(p.el("ok6").textContent).toMatch(/không có hàng chuẩn tương ứng/u);
      await nutXuLy(p)?.nghe["click"]?.[0]?.();
      p.el("xl-ma").value = "gach-the";
      await p.bam("nut-tao-duyet");
      expect(p.el("loi6").textContent).toMatch(/Mã viết hoa/u);
      expect(p.trangThai.goi).not.toContain("POST /rfqs/r-9/items/2/mapping/new-item");
    });

    it("[S1.199 / S4.2b · lượt đi thử T4] du-lieu: mở chi tiết hỏng ⇒ bước 4 không giữ hàng trước, nút ghi không ghi vào hàng trước", async () => {
      const CHI_TIET = { hangChuan: { id: "h-1", ma: "THEP-D10", ten: "Thép D10", donViGoc: "kg", thuocTinh: {}, thuocTinhTrongYeu: [], trangThai: "DANG_DUNG" }, phienBan: [], biDanh: [], quyDoi: [] };
      let lanTao = 0;
      const p = await moDuLieu({ hangChuan: [], conNua: false, choGhi: true, soNguoiQuanLy: 1 }, (l) => {
        if (l === "POST /items") { lanTao += 1; return Promise.resolve({ status: 201, body: { hangChuan: { id: `h-${String(lanTao)}`, ma: "X", donViGoc: "kg" } } }); }
        if (l === "GET /items/h-1") return Promise.resolve({ status: 200, body: CHI_TIET });
        if (l === "GET /items/h-2") return Promise.resolve({ status: 500, body: { error: "loi noi bo" } });
        return undefined;
      });
      p.el("tao-ma").value = "THEP-D10";
      await p.bam("nut-tao");
      expect(p.el("b4").hidden).toBe(false);
      expect(p.el("tt-hang").con.length).toBeGreaterThan(0);
      p.el("tao-ma").value = "THEP-D12";
      await p.bam("nut-tao");
      expect(p.el("loi4").textContent).toMatch(/loi noi bo/u);
      expect(p.el("tt-hang").con).toHaveLength(0);
      p.el("bd-moi").value = "thep d10 hp";
      await p.bam("nut-bi-danh");
      expect(p.trangThai.goi).not.toContain("POST /items/h-1/aliases");
      expect(p.el("loi4").textContent).toMatch(/Chưa mở hàng chuẩn nào/u);
    });

    // ==========================================================================================
    // [S1.201 / S3.6a] NHÓM HÀNG: ô chọn ở màn tạo gói — chỉ ở tổ chức đã bật —, lần tạo mang nhóm đã chọn, «Đặt nhóm hàng»
    // chỉ ở DRAFT; và màn `/nhom-hang` của người giữ `category.manage`. Nhóm đã ngừng dùng không được chọn MỚI, trừ khi gói đang
    // giữ nó (ngừng dùng chỉ chặn lần gán mới).
    // ==========================================================================================
    const DS_NHOM = {
      nhomHang: [
        { id: "c-thep", ma: "THEP", ten: "Thép", conDung: true },
        { id: "c-cu", ma: "CU", ten: "Nhóm cũ", conDung: false },
        { id: "c-vpp", ma: "VPP", ten: "Văn phòng phẩm", conDung: true },
      ],
    };
    const moTaoThauNhom = async (
      daBat: boolean,
      trangThaiGoi: string,
      categoryId: string | null,
      thay: (l: string) => Promise<{ status: number; body: unknown }> | undefined = () => undefined,
    ) =>
      moTaoThau(daBat, trangThaiGoi, (l) =>
        thay(l) ??
        (l === "GET /categories" ? Promise.resolve({ status: 200, body: DS_NHOM })
          : l === "GET /rfqs/r-1" ? Promise.resolve({ status: 200, body: { rfq: { id: "r-1", title: "Gói", status: trangThaiGoi, categoryId } } })
          : undefined));
    const cho5 = () => new Promise((r) => { setTimeout(r, 5); });

    it("[S1.201 / S3.6a] tao-thau: tổ chức đã bật ⇒ ô chọn nhóm hàng hiện với nhóm còn dùng (và nhóm gói đang giữ); chưa bật ⇒ ẩn, không hỏi /categories", async () => {
      const bat = await moTaoThauNhom(true, "DRAFT", "c-cu");
      expect(bat.p.el("khoi-nhom-hang").hidden).toBe(false);
      expect(bat.p.el("nhom-hang").con.map((o) => [o.value, o.textContent])).toEqual([
        ["", "— chọn nhóm hàng —"],
        ["c-thep", "THEP — Thép"],
        ["c-cu", "CU — Nhóm cũ (đã ngừng dùng)"],
        ["c-vpp", "VPP — Văn phòng phẩm"],
      ]);
      expect(bat.p.el("nhom-hang").value).toBe("c-cu");
      expect(bat.p.el("nut-nhom-hang").hidden).toBe(false);
      const tt = bat.p.el("tt-rfq").con.map((x) => x.textContent);
      expect(tt).toContain("Nhóm hàng");
      expect(tt).toContain("CU — Nhóm cũ (đã ngừng dùng)");
      const chua = await moTaoThauNhom(false, "DRAFT", null);
      expect(chua.p.el("khoi-nhom-hang").hidden).toBe(true);
      expect(chua.p.el("nut-nhom-hang").hidden).toBe(true);
      expect(chua.p.trangThai.goi).not.toContain("GET /categories");
      expect(chua.p.el("tt-rfq").con.map((x) => x.textContent)).not.toContain("Nhóm hàng");
      // Gói đã rời DRAFT: nhóm hàng khoá — không nút đặt.
      expect((await moTaoThauNhom(true, "PENDING_APPROVAL", "c-thep")).p.el("nut-nhom-hang").hidden).toBe(true);
    });

    it("[S1.201 / S3.6a] tao-thau: «Tạo gói thầu» ở tổ chức đã bật mang nhóm đã chọn; chưa chọn ⇒ không mang; chưa bật ⇒ không bao giờ mang", async () => {
      const taoVoi = async (daBat: boolean, chon: string): Promise<unknown> => {
        const { p } = await moTaoThauNhom(daBat, "DRAFT", null, (l) => (l === "POST /rfqs" ? Promise.resolve({ status: 201, body: { rfq: { id: "r-1" } } }) : undefined));
        p.el("tieu-de").value = "Mua thep";
        p.el("han").value = "2099-01-01T10:00";
        p.el("nhom-hang").value = chon;
        await p.bam("nut-tao");
        return p.trangThai.than.find((t) => t.lenh === "POST /rfqs")?.than;
      };
      expect(await taoVoi(true, "c-thep")).toMatchObject({ title: "Mua thep", categoryId: "c-thep" });
      expect(await taoVoi(true, "")).not.toHaveProperty("categoryId");
      expect(await taoVoi(false, "c-thep")).not.toHaveProperty("categoryId");
    });

    // [S1.258 / khoản 329] Màn `/chinh-sach` là giao diện DUY NHẤT của `POST /policy`; trước vòng này thân nó gửi không mang
    // `evalComponents`/`bafoTopN`, nên mọi phiên bản tạo trên màn không chấm được. Đo đúng thân trang GỬI, ở ba đường: mẫu, chép,
    // bỏ chọn — và bảng phiên bản hiện trọng số.
    const moChinhSach = async (phienBan: unknown[]) => {
      const p = await dungTrang("chinh-sach", {
        hash: "", cookie: A,
        thay: (l) =>
          l === "GET /policy/versions" ? Promise.resolve({ status: 200, body: { phienBan, daBat: false, choKy: false } })
            : l === "POST /policy" ? Promise.resolve({ status: 201, body: { policy: { version: 9 } } })
            : undefined,
      });
      await p.bam("nut-dung-phien");
      const gui = async () => {
        await p.bam("nut-tao-pb");
        return p.trangThai.than.filter((t) => t.lenh === "POST /policy").at(-1)?.than as Record<string, unknown> | undefined;
      };
      const doiO = async (id: string, chon: boolean) => {
        p.el(id).checked = chon;
        for (const f of p.el(id).nghe["change"] ?? []) await f();
      };
      return { p, gui, doiO };
    };
    const PHIEN_BAN_CO = {
      id: "p-1", version: 1, effectiveFrom: "2026-10-01T00:00:00Z", dualApprovalThreshold: "500000000.00", currency: "VND",
      tiers: null, chiaNhoCuaSoNgay: null, thamDinhHieuLucThang: null, benchmark: null,
      evalComponents: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }], bafoTopN: 3,
      createdBy: "u-1", signedBy: null, signedAt: null, hieuLuc: true,
    };

    it("[S1.258 / khoản 329] chinh-sach: mẫu mặc định gửi trọng số gia/TIEN/1.0000 và BAFO top-2; không cảnh báo trọng số", async () => {
      const { p, gui } = await moChinhSach([]);
      expect(p.el("co-trong-so").checked).toBe(true);
      expect(p.el("khoi-trong-so").hidden).toBe(false);
      expect(p.el("bafo-top-n").value).toBe("2");
      expect(p.el("tt-trong-so").con.map((x) => x.textContent)).toEqual(["Thành phần gia", "đơn vị TIEN, hệ số 1.0000"]);
      expect(await gui()).toMatchObject({ version: 1, evalComponents: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }], bafoTopN: 2 });
      expect(p.el("canh-bao").textContent).not.toContain("trọng số");
    });

    it("[S1.258 / khoản 329] chinh-sach: «Chép phiên bản mới nhất» mang trọng số và top-N; bảng phiên bản hiện chúng", async () => {
      const { p, gui } = await moChinhSach([PHIEN_BAN_CO]);
      const hang = p.el("bang-pb").querySelector("tbody").con[0];
      expect(hang?.con.map((x) => x.textContent)).toContain("gia/TIEN ×1.0000 · BAFO top-3");
      await p.bam("nut-chep");
      expect(p.el("bafo-top-n").value).toBe("3");
      expect(await gui()).toMatchObject({ version: 2, evalComponents: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }], bafoTopN: 3 });
      // Phiên bản chép không có trọng số ⇒ ô bỏ chọn, thân gửi cặp `null`, và màn nói hậu quả.
      const { p: q, gui: guiQ } = await moChinhSach([{ ...PHIEN_BAN_CO, evalComponents: null, bafoTopN: null }]);
      expect(q.el("bang-pb").querySelector("tbody").con[0]?.con.map((x) => x.textContent)).toContain("chưa khai");
      await q.bam("nut-chep");
      expect(q.el("co-trong-so").checked).toBe(false);
      expect(q.el("khoi-trong-so").hidden).toBe(true);
      expect(await guiQ()).toMatchObject({ evalComponents: null, bafoTopN: null });
      expect(q.el("canh-bao").textContent).toContain("KHÔNG khai trọng số chấm");
    });

    it("[S1.258 / khoản 329] chinh-sach: bỏ chọn ⇒ gửi cặp null và cảnh báo; chọn lại khi top-N trống ⇒ ô nhận mẫu; trọng số ngoài vế hẹp chép nguyên văn kèm cảnh báo", async () => {
      const { p, gui, doiO } = await moChinhSach([]);
      await doiO("co-trong-so", false);
      expect(p.el("khoi-trong-so").hidden).toBe(true);
      expect(p.el("canh-bao").textContent).toContain("KHÔNG khai trọng số chấm");
      expect(await gui()).toMatchObject({ evalComponents: null, bafoTopN: null });
      p.el("bafo-top-n").value = "";
      await doiO("co-trong-so", true);
      expect(p.el("bafo-top-n").value).toBe("2");
      p.el("bafo-top-n").value = "0";
      expect(await gui()).toMatchObject({ evalComponents: [{ ma: "gia", don_vi: "TIEN", he_so: "1.0000" }], bafoTopN: 0 });
      const LA = [{ ma: "gia", don_vi: "TIEN", he_so: "1" }, { ma: "ky_thuat", don_vi: "DIEM", he_so: "0.5" }];
      const { p: q, gui: guiQ } = await moChinhSach([{ ...PHIEN_BAN_CO, evalComponents: LA }]);
      await q.bam("nut-chep");
      expect(q.el("canh-bao").textContent).toContain("bị từ chối khi chấm");
      expect(await guiQ()).toMatchObject({ evalComponents: LA, bafoTopN: 3 });
    });

    it("[S1.201 / S3.6a] tao-thau: «Đặt nhóm hàng» gửi PUT /rfqs/r-1/category với nhóm đã chọn; chưa chọn ⇒ lỗi, không gọi; máy chủ từ chối ⇒ in đúng câu của máy chủ", async () => {
      const { p } = await moTaoThauNhom(true, "DRAFT", null, (l) => (l === "PUT /rfqs/r-1/category" ? Promise.resolve({ status: 200, body: { rfq: { id: "r-1" } } }) : undefined));
      p.el("nhom-hang").value = "";
      await p.bam("nut-nhom-hang");
      expect(p.trangThai.goi).not.toContain("PUT /rfqs/r-1/category");
      expect(p.el("loi2").textContent).toBe("Chọn một nhóm hàng.");
      p.el("nhom-hang").value = "c-vpp";
      await p.bam("nut-nhom-hang");
      expect(p.trangThai.than.find((t) => t.lenh === "PUT /rfqs/r-1/category")?.than).toEqual({ categoryId: "c-vpp" });
      expect(p.el("ok2").textContent).toBe("Đã đặt nhóm hàng cho gói.");
      const cau = "Nhóm hàng này đã ngừng dùng — chọn một nhóm hàng khác.";
      const tu = await moTaoThauNhom(true, "DRAFT", null, (l) => (l === "PUT /rfqs/r-1/category" ? Promise.resolve({ status: 422, body: { error: cau } }) : undefined));
      tu.p.el("nhom-hang").value = "c-thep";
      await tu.p.bam("nut-nhom-hang");
      expect(tu.p.el("loi2").textContent).toBe(cau);
    });

    it("[S1.201 / S3.6a] nhom-hang: bảng vẽ mã, tên, trạng thái và một nút mỗi dòng; «Ngừng dùng» ⇒ PUT …/status {conDung: false}; «Dùng lại» ⇒ {conDung: true}", async () => {
      const p = await dungTrang("nhom-hang", {
        hash: "", cookie: A,
        thay: (l) => (l === "GET /categories" ? Promise.resolve({ status: 200, body: DS_NHOM })
          : l.startsWith("PUT /categories/") ? Promise.resolve({ status: 200, body: { nhomHang: {} } })
          : undefined),
      });
      await p.bam("nut-dung-phien");
      const dong = [...p.el("bang-nhom").querySelector("tbody").con];
      expect(dong.map((tr) => tr.con.slice(0, 3).map((td) => td.textContent))).toEqual([
        ["THEP", "Thép", "đang dùng"],
        ["CU", "Nhóm cũ", "đã ngừng dùng"],
        ["VPP", "Văn phòng phẩm", "đang dùng"],
      ]);
      const nut = dong.map((tr) => tr.con[3]!.con[0]!);
      expect(nut.map((n) => n.textContent)).toEqual(["Ngừng dùng", "Dùng lại", "Ngừng dùng"]);
      for (const f of nut[0]!.nghe["click"] ?? []) await f();
      await cho5();
      for (const f of nut[1]!.nghe["click"] ?? []) await f();
      await cho5();
      expect(p.trangThai.than.filter((t) => t.lenh.startsWith("PUT /categories/"))).toEqual([
        { lenh: "PUT /categories/c-thep/status", than: { conDung: false } },
        { lenh: "PUT /categories/c-cu/status", than: { conDung: true } },
      ]);
      expect(p.el("ok2").textContent).toBe("Đã dùng lại nhóm CU.");
    });

    it("[S1.201 / S3.6a] nhom-hang: mã sai hình dạng hay tên rỗng ⇒ không gọi máy chủ; mã viết thường ⇒ POST /categories với mã VIẾT HOA", async () => {
      const p = await dungTrang("nhom-hang", {
        hash: "", cookie: A,
        thay: (l) => (l === "POST /categories" ? Promise.resolve({ status: 201, body: { nhomHang: { ma: "THEP-01" } } }) : undefined),
      });
      await p.bam("nut-dung-phien");
      p.el("ma-nhom").value = "thép";
      p.el("ten-nhom").value = "Thép";
      await p.bam("nut-tao-nhom");
      expect(p.trangThai.goi).not.toContain("POST /categories");
      expect(p.el("loi3").textContent).toMatch(/^Mã gồm chữ không dấu/u);
      p.el("ma-nhom").value = " thep-01 ";
      p.el("ten-nhom").value = "  ";
      await p.bam("nut-tao-nhom");
      expect(p.el("loi3").textContent).toBe("Nhập tên nhóm hàng.");
      p.el("ten-nhom").value = "Thép xây dựng";
      await p.bam("nut-tao-nhom");
      expect(p.trangThai.than.find((t) => t.lenh === "POST /categories")?.than).toEqual({ ma: "THEP-01", ten: "Thép xây dựng" });
      expect(p.el("ok3").textContent).toBe("Đã tạo nhóm THEP-01.");
      expect(p.el("ma-nhom").value).toBe("");
    });

    // ==========================================================================================
    // [S1.200 / khoản 258] NGÂN SÁCH CHỮ KÝ RÀNG VÀO. Người tạo gói thấy nó ở lần đọc gói; người khác bấm «Xem ngân sách» — cổng
    // `rfq.approve` từ chối thì vào sổ và vào trần từ chối của phiên, nên lần từ chối phải đến từ một thao tác cố ý (lượt soi F3,
    // chủ dự án chốt ngày 2026-09-29).
    // ==========================================================================================
    const NGAN_SACH = { rfqId: "r-1", estimatedValue: "150000000.00", currency: "VND", policyVersion: 2, tierTuSoTien: "100000000.00", requiresDualApproval: true };
    const NAM_HANG = ["Giá trị ước lượng", "150000000.00", "Tiền tệ", "VND", "Phiên bản chính sách", "2", "Bậc từ", "100000000.00", "Cần hai người duyệt", "có"];
    const goiCua = (id: string, createdBy: string, status = "PENDING_APPROVAL") => (l: string) =>
      l === `GET /rfqs/${id}` ? Promise.resolve({ status: 200, body: { rfq: { id, title: "Gói", status, createdBy, lanNop: 1 } } })
        : l === `GET /rfqs/${id}/items` ? Promise.resolve({ status: 200, body: { items: [] } })
        : l === `GET /rfqs/${id}/invitations` ? Promise.resolve({ status: 200, body: { invitations: [] } })
        : undefined;
    const docNganSach = (status: number, budget: unknown = NGAN_SACH) => (l: string) =>
      l === "GET /rfqs/r-1/budget" ? Promise.resolve(status === 200 ? { status, body: { budget } } : { status, body: { error: "x" } }) : undefined;
    const soLanDocNganSach = (goi: readonly string[]) => goi.filter((g) => g === "GET /rfqs/r-1/budget").length;

    it("[S1.200 / khoản 258] tao-thau: người tạo gói ⇒ màn TỰ đọc ngân sách (năm hàng), nút «Xem ngân sách» ẩn; người khác ⇒ không tự đọc, nút hiện; bấm ⇒ đọc; 403 ⇒ nói không có quyền", async () => {
      const tao = await moTaoThau(true, "PENDING_APPROVAL", (l) => goiCua("r-1", A.userId)(l) ?? docNganSach(200)(l));
      expect(soLanDocNganSach(tao.p.trangThai.goi)).toBe(1);
      expect(tao.p.el("tt-ns").con.map((x) => x.textContent)).toEqual(NAM_HANG);
      expect(tao.p.el("nut-xem-ns").hidden).toBe(true);

      const khac = await moTaoThau(true, "PENDING_APPROVAL", (l) => goiCua("r-1", B.userId)(l) ?? docNganSach(403)(l));
      expect(soLanDocNganSach(khac.p.trangThai.goi), "người không tạo gói: đọc gói không kéo theo lần đọc ngân sách").toBe(0);
      expect(khac.p.el("tt-ns").con).toEqual([]);
      expect(khac.p.el("nut-xem-ns").hidden).toBe(false);
      await khac.p.bam("nut-xem-ns");
      expect(soLanDocNganSach(khac.p.trangThai.goi)).toBe(1);
      expect(khac.p.el("tt-ns").con.map((x) => x.textContent)).toEqual(["Ngân sách", "không có quyền đọc ngân sách của gói này"]);

      const duyet = await moTaoThau(true, "PENDING_APPROVAL", (l) => goiCua("r-1", B.userId)(l) ?? docNganSach(200)(l));
      await duyet.p.bam("nut-xem-ns");
      expect(duyet.p.el("tt-ns").con.map((x) => x.textContent), "người giữ `rfq.approve` bấm nút thì thấy đủ năm hàng").toEqual(NAM_HANG);
    });

    it("[S1.200 / khoản 258 — lượt soi F4] tao-thau: câu trả ngân sách của gói TRƯỚC tới muộn không được vẽ khi màn đã mở gói khác; thân mang mã gói khác cũng bỏ", async () => {
      let tha: () => void = () => undefined;
      const cham = new Promise<void>((r) => { tha = r; });
      const p = await dungTrang("tao-thau", {
        hash: "", cookie: A,
        thay: (l) =>
          l === "GET /policy/versions" ? Promise.resolve({ status: 200, body: { phienBan: [], daBat: true, choKy: false } })
            : l === "GET /rfqs/r-1/budget" ? cham.then(() => ({ status: 200, body: { budget: NGAN_SACH } }))
            : goiCua("r-1", A.userId)(l) ?? goiCua("r-2", B.userId)(l),
      });
      await p.bam("nut-dung-phien");
      p.el("rfq").value = "r-1";
      const docGoiMot = Promise.all((p.el("nut-doc").nghe["click"] ?? []).map((f) => f()));
      await cho();
      expect(soLanDocNganSach(p.trangThai.goi), "người tạo r-1: lần đọc ngân sách đã đi và đang chờ").toBe(1);
      p.el("rfq").value = "r-2";
      await p.bam("nut-doc");
      tha();
      await docGoiMot;
      await cho();
      expect(p.el("tt-ns").con, "màn đang mở r-2: ngân sách của r-1 không được vẽ").toEqual([]);
      expect(p.el("nut-xem-ns").hidden, "r-2 do người khác tạo").toBe(false);

      const lech = await moTaoThau(true, "PENDING_APPROVAL", (l) => goiCua("r-1", A.userId)(l) ?? docNganSach(200, { ...NGAN_SACH, rfqId: "r-9" })(l));
      expect(lech.p.el("tt-ns").con, "thân mang mã gói khác").toEqual([]);

      // Ngân sách của r-1 đang hiện; đọc r-2 mà lần đọc hạng mục mất mạng giữa chừng ⇒ bảng đã đi ngay sau lần đọc gói, không
      // đứng cạnh lần nộp của r-2 mà nút Phê duyệt sẽ gửi.
      const dut = await moTaoThau(true, "PENDING_APPROVAL", (l) =>
        l === "GET /rfqs/r-2/items" ? Promise.reject(new Error("mat mang")) : goiCua("r-1", A.userId)(l) ?? goiCua("r-2", B.userId)(l) ?? docNganSach(200)(l));
      expect(dut.p.el("tt-ns").con.map((x) => x.textContent)).toEqual(NAM_HANG);
      dut.p.el("rfq").value = "r-2";
      await dut.p.bam("nut-doc").catch(() => undefined);
      expect(dut.p.trangThai.goi).toContain("GET /rfqs/r-2/items");
      expect(dut.p.el("tt-ns").con, "lần đọc r-2 hỏng giữa chừng: ngân sách của r-1 không còn trên màn").toEqual([]);
    });

    it("[S1.200 / khoản 258 — lượt soi N1] tao-thau: đăng xuất hay đổi người ⇒ bảng ngân sách của người trước đi, nút «Xem ngân sách» ẩn", async () => {
      for (const cach of ["dang-xuat", "doi-nguoi"] as const) {
        const { p } = await moTaoThau(true, "PENDING_APPROVAL", (l) => goiCua("r-1", B.userId)(l) ?? docNganSach(200)(l));
        await p.bam("nut-xem-ns");
        expect(p.el("tt-ns").con.map((x) => x.textContent), cach).toEqual(NAM_HANG);
        if (cach === "dang-xuat") await p.bam("nut-dang-xuat");
        else await p.doiFragment(`#${ORG}:maCuaB`);
        expect(p.el("tt-ns").con, cach).toEqual([]);
        expect(p.el("nut-xem-ns").hidden, cach).toBe(true);
      }
    });

    it("[S1.200 / khoản 258 — lượt soi N4] tao-thau: đặt ngân sách xong, người tạo gói thấy lại đủ năm hàng (đọc lại); người mua khác thấy ba thứ lần đặt trả về, màn không đọc thay họ", async () => {
      const dat = (l: string) =>
        l === "PUT /rfqs/r-1/budget"
          ? Promise.resolve({ status: 200, body: { budget: { rfqId: "r-1", estimatedValue: "150000000.00", currency: "VND", policyId: "p-2", requiresDualApproval: true } } })
          : undefined;
      const tao = await moTaoThau(true, "DRAFT", (l) => goiCua("r-1", A.userId, "DRAFT")(l) ?? dat(l) ?? docNganSach(200)(l));
      expect(soLanDocNganSach(tao.p.trangThai.goi)).toBe(1);
      await tao.p.bam("nut-ns");
      expect(soLanDocNganSach(tao.p.trangThai.goi)).toBe(2);
      expect(tao.p.el("tt-ns").con.map((x) => x.textContent)).toEqual(NAM_HANG);

      const khac = await moTaoThau(true, "DRAFT", (l) => goiCua("r-1", B.userId, "DRAFT")(l) ?? dat(l) ?? docNganSach(403)(l));
      await khac.p.bam("nut-ns");
      expect(soLanDocNganSach(khac.p.trangThai.goi)).toBe(0);
      expect(khac.p.el("tt-ns").con.map((x) => x.textContent)).toEqual(["Giá trị ước lượng", "150000000.00", "Tiền tệ", "VND", "Cần hai người duyệt", "có"]);
    });

    // ==========================================================================================
    // [S3.6b2 / K10a] KHUNG TÍN HIỆU CHIA NHỎ GÓI trong `/tao-thau`. Chủ dự án chốt ngày 2026-09-30: màn tự đọc tín hiệu ở mỗi lần
    // đọc gói của tổ chức đã bật (route không cổng), mời bấm «Ghi nhận tín hiệu» chỉ khi máy chủ nói người đang xem ghi nhận được,
    // và nói vì sao không khi không.
    // ==========================================================================================
    const BC_TH = { can: 1000000000, goi: ["r-0", "r-1"], loai: "PURCHASE_SPLITTING", nhom_hang: "n1", chinh_sach: "p2", cua_so_ngay: 30 };
    const HANG_NOP = {
      id: "s1", loai: "PURCHASE_SPLITTING", nguon: "NOP_DUYET", bangChung: BC_TH, doTinCay: "XAC_DINH", giaiThich: "x",
      tinhLuc: "2026-09-30T01:00:00.000Z", nguoiGhi: "u-pm", nguoiGhiTen: "Anh Soạn", ghiNhan: [] as unknown[],
    };
    const thanTinHieu = (nguoiXem: unknown, them: Record<string, unknown> = {}) => ({
      tinHieu: {
        hienTai: BC_TH, canGhiNhan: true, tinHieu: [HANG_NOP],
        goi: { "r-0": { tieuDe: "Thép 480", trangThai: "OPEN" }, "r-1": { tieuDe: "Gói", trangThai: "PENDING_APPROVAL" } },
        nguoiXem, soNguoiGhiNhanDuoc: 1, ...them,
      },
    });
    const KHONG_TIN_HIEU = { tinHieu: { hienTai: null, canGhiNhan: false, tinHieu: [], goi: {}, nguoiXem: { ghiNhanDuoc: false, lyDo: null }, soNguoiGhiNhanDuoc: null } };
    const docTinHieu = (id: string, body: unknown) => (l: string) =>
      l === `GET /rfqs/${id}/signals` ? Promise.resolve({ status: 200, body }) : undefined;
    const soLanDocTinHieu = (goi: readonly string[], id = "r-1") => goi.filter((g) => g === `GET /rfqs/${id}/signals`).length;
    const dongGoi = (p: Awaited<ReturnType<typeof dungTrang>>) =>
      p.el("bang-tin-hieu").querySelector("tbody").con.map((tr) => tr.con.map((td) => td.textContent));
    const LY_DO_TU_GHI = "Người tạo hay người nộp một gói trong tín hiệu không ghi nhận được tín hiệu ấy.";

    it("[S3.6b2 / K10a] tao-thau: gói chờ duyệt có tín hiệu chờ ghi nhận ⇒ khung tự hiện (tóm tắt, bảng gói đánh dấu gói này, lịch sử); người xem ghi nhận được ⇒ ô lý do và nút; lý do rỗng ⇒ không gọi máy chủ; có lý do ⇒ POST acknowledge mang lý do đã cắt, rồi đọc lại gói và khung", async () => {
      let daGhiNhan = false;
      const { p } = await moTaoThau(true, "PENDING_APPROVAL", (l) =>
        l === "POST /rfqs/r-1/signals/acknowledge"
          ? ((daGhiNhan = true), Promise.resolve({ status: 201, body: { ghiNhan: { signalId: "s1", ackId: "a1", tinHieuMoi: false } } }))
          : docTinHieu("r-1", daGhiNhan
            ? thanTinHieu({ ghiNhanDuoc: false, lyDo: null }, {
              canGhiNhan: false, soNguoiGhiNhanDuoc: null,
              tinHieu: [{ ...HANG_NOP, ghiNhan: [{ id: "a1", lyDo: "Ba cong trinh", nguoi: "u-b", nguoiTen: "Chị Duyệt", luc: "2026-09-30T02:00:00.000Z" }] }],
            })
            : thanTinHieu({ ghiNhanDuoc: true, lyDo: null }))(l));
      expect(soLanDocTinHieu(p.trangThai.goi), "đọc gói kéo theo MỘT lần đọc tín hiệu").toBe(1);
      expect(p.el("khoi-tin-hieu").hidden).toBe(false);
      expect(p.el("tin-hieu-tom-tat").textContent).toContain("Gói này nằm trong 2 gói cùng nhóm hàng nộp duyệt trong 30 ngày, mỗi gói dưới cận 1.000.000.000");
      // Bảng xếp theo tên gói, không theo id của bằng chứng.
      expect(dongGoi(p)).toEqual([["Gói (gói này)", "chờ duyệt"], ["Thép 480", "đã mở"]]);
      expect(p.el("lich-su-tin-hieu").con.map((li) => li.textContent).join("|")).toContain("Anh Soạn nộp duyệt; tín hiệu được ghi lúc nộp (2 gói, cận 1.000.000.000).");
      expect([p.el("khoi-ghi-nhan").hidden, p.el("tin-hieu-khong-duoc").hidden]).toEqual([false, true]);

      p.el("ly-do-ghi-nhan").value = "   ";
      await p.bam("nut-ghi-nhan");
      expect(p.el("loi4").textContent).toBe("Cần ghi lý do ghi nhận — lý do vào sổ kiểm toán cùng tên người ghi nhận.");
      expect(p.trangThai.goi, "lý do rỗng: không một lời gọi nào").not.toContain("POST /rfqs/r-1/signals/acknowledge");

      p.el("ly-do-ghi-nhan").value = "  Ba cong trinh  ";
      await p.bam("nut-ghi-nhan");
      expect(p.trangThai.than.filter((t) => t.lenh === "POST /rfqs/r-1/signals/acknowledge").map((t) => t.than)).toEqual([{ lyDo: "Ba cong trinh" }]);
      expect(p.el("ok4").textContent).toBe("Đã ghi nhận tín hiệu. Gói mở được khi đủ chữ ký.");
      expect(p.el("ly-do-ghi-nhan").value).toBe("");
      expect(soLanDocTinHieu(p.trangThai.goi), "ghi nhận xong: đọc lại gói, kéo theo lần đọc tín hiệu thứ hai").toBe(2);
      expect(p.el("tin-hieu-tom-tat").textContent).toContain("Tín hiệu đã được ghi nhận — nó không chặn lần mở gói nữa.");
      expect(p.el("lich-su-tin-hieu").con.map((li) => li.textContent).join("|")).toContain("Chị Duyệt ghi nhận: «Ba cong trinh».");
      expect(p.el("khoi-ghi-nhan").hidden, "không còn gì để ghi nhận").toBe(true);
    });

    it("[S3.6b2 / K10a] tao-thau: người gây ra tín hiệu ⇒ khung hiện, KHÔNG mời bấm, nói đúng câu vì sao không của máy chủ; §8.10 — không ai ghi nhận được ⇒ tóm tắt nói tổ chức kẹt", async () => {
      const { p } = await moTaoThau(true, "PENDING_APPROVAL", docTinHieu("r-1", thanTinHieu({ ghiNhanDuoc: false, lyDo: LY_DO_TU_GHI }, { soNguoiGhiNhanDuoc: 0 })));
      expect(p.el("khoi-tin-hieu").hidden).toBe(false);
      expect(p.el("khoi-ghi-nhan").hidden).toBe(true);
      expect([p.el("tin-hieu-khong-duoc").hidden, p.el("tin-hieu-khong-duoc").textContent]).toEqual([false, LY_DO_TU_GHI]);
      expect(p.el("tin-hieu-tom-tat").textContent).toContain("Trong tổ chức hiện không ai ghi nhận được tín hiệu này");
      expect(p.trangThai.goi.filter((g) => g.startsWith("POST"))).toEqual([]);
    });

    it("[S3.6b2 / K10a] tao-thau: gói không tín hiệu ⇒ khung ẩn; đọc hỏng ⇒ khung ẩn; tổ chức chưa bật ⇒ không hỏi `/signals`", async () => {
      const khong = await moTaoThau(true, "PENDING_APPROVAL", docTinHieu("r-1", KHONG_TIN_HIEU));
      expect([soLanDocTinHieu(khong.p.trangThai.goi), khong.p.el("khoi-tin-hieu").hidden]).toEqual([1, true]);
      const hong = await moTaoThau(true, "PENDING_APPROVAL", (l) => (l === "GET /rfqs/r-1/signals" ? Promise.resolve({ status: 500, body: { error: "x" } }) : undefined));
      expect([soLanDocTinHieu(hong.p.trangThai.goi), hong.p.el("khoi-tin-hieu").hidden]).toEqual([1, true]);
      const mvp1 = await moTaoThau(false, "PENDING_APPROVAL", docTinHieu("r-1", thanTinHieu({ ghiNhanDuoc: true, lyDo: null })));
      expect([soLanDocTinHieu(mvp1.p.trangThai.goi), mvp1.p.el("khoi-tin-hieu").hidden]).toEqual([0, true]);
    });

    it("[S3.6b2 / K10a] tao-thau: máy chủ từ chối lần ghi nhận ⇒ in đúng câu của máy chủ, đọc lại khung; câu trả tín hiệu của gói TRƯỚC tới muộn không được vẽ; đăng xuất hay đổi người ⇒ khung đi", async () => {
      const tuChoi = await moTaoThau(true, "PENDING_APPROVAL", (l) =>
        l === "POST /rfqs/r-1/signals/acknowledge"
          ? Promise.resolve({ status: 422, body: { error: "Bằng chứng của tín hiệu vừa đổi — đọc lại rồi ghi nhận tín hiệu hiện tại." } })
          : docTinHieu("r-1", thanTinHieu({ ghiNhanDuoc: true, lyDo: null }))(l));
      tuChoi.p.el("ly-do-ghi-nhan").value = "Ba cong trinh";
      await tuChoi.p.bam("nut-ghi-nhan");
      expect(tuChoi.p.el("loi4").textContent).toBe("Bằng chứng của tín hiệu vừa đổi — đọc lại rồi ghi nhận tín hiệu hiện tại.");
      expect(soLanDocTinHieu(tuChoi.p.trangThai.goi), "lời từ chối kéo theo một lần đọc lại khung").toBe(2);

      let tha: () => void = () => undefined;
      const cham = new Promise<void>((r) => { tha = r; });
      const p = await dungTrang("tao-thau", {
        hash: "", cookie: A,
        thay: (l) =>
          l === "GET /policy/versions" ? Promise.resolve({ status: 200, body: { phienBan: [], daBat: true, choKy: false } })
            : l === "GET /rfqs/r-1/signals" ? cham.then(() => ({ status: 200, body: thanTinHieu({ ghiNhanDuoc: true, lyDo: null }) }))
            : l === "GET /rfqs/r-2/signals" ? Promise.resolve({ status: 200, body: KHONG_TIN_HIEU })
            : goiCua("r-1", A.userId)(l) ?? goiCua("r-2", B.userId)(l),
      });
      await p.bam("nut-dung-phien");
      p.el("rfq").value = "r-1";
      const docGoiMot = Promise.all((p.el("nut-doc").nghe["click"] ?? []).map((f) => f()));
      await cho();
      expect(soLanDocTinHieu(p.trangThai.goi), "lần đọc tín hiệu của r-1 đã đi và đang chờ").toBe(1);
      p.el("rfq").value = "r-2";
      await p.bam("nut-doc");
      tha();
      await docGoiMot;
      await cho();
      expect(p.el("khoi-tin-hieu").hidden, "màn đang mở r-2 (không tín hiệu): tín hiệu của r-1 không được vẽ").toBe(true);
      expect(dongGoi(p)).toEqual([]);

      // Đọc gói khác: khung của gói trước đi NGAY khi gói mới về, không đợi câu trả tín hiệu của gói mới — trong lúc chờ, màn không đặt
      // tín hiệu của r-1 cạnh thông tin của r-2.
      let tha2: () => void = () => undefined;
      const cham2 = new Promise<void>((r) => { tha2 = r; });
      const d = await dungTrang("tao-thau", {
        hash: "", cookie: A,
        thay: (l) =>
          l === "GET /policy/versions" ? Promise.resolve({ status: 200, body: { phienBan: [], daBat: true, choKy: false } })
            : l === "GET /rfqs/r-1/signals" ? Promise.resolve({ status: 200, body: thanTinHieu({ ghiNhanDuoc: true, lyDo: null }) })
            : l === "GET /rfqs/r-2/signals" ? cham2.then(() => ({ status: 200, body: KHONG_TIN_HIEU }))
            : goiCua("r-1", A.userId)(l) ?? goiCua("r-2", B.userId)(l),
      });
      await d.bam("nut-dung-phien");
      d.el("rfq").value = "r-1";
      await d.bam("nut-doc");
      expect(d.el("khoi-tin-hieu").hidden, "r-1 có tín hiệu").toBe(false);
      d.el("rfq").value = "r-2";
      const docGoiHai = Promise.all((d.el("nut-doc").nghe["click"] ?? []).map((f) => f()));
      await cho();
      expect(soLanDocTinHieu(d.trangThai.goi, "r-2"), "lần đọc tín hiệu của r-2 đã đi và đang chờ").toBe(1);
      expect([d.el("khoi-tin-hieu").hidden, dongGoi(d)], "đang chờ tín hiệu của r-2: khung của r-1 đã đi").toEqual([true, []]);
      tha2();
      await docGoiHai;

      for (const cach of ["dang-xuat", "doi-nguoi"] as const) {
        const { p: q } = await moTaoThau(true, "PENDING_APPROVAL", docTinHieu("r-1", thanTinHieu({ ghiNhanDuoc: true, lyDo: null })));
        expect(q.el("khoi-tin-hieu").hidden, cach).toBe(false);
        if (cach === "dang-xuat") await q.bam("nut-dang-xuat");
        else await q.doiFragment(`#${ORG}:maCuaB`);
        expect([q.el("khoi-tin-hieu").hidden, q.el("khoi-ghi-nhan").hidden, dongGoi(q)], cach).toEqual([true, true, []]);
      }
    });

    // ==========================================================================================
    // [S1.219 / khoản 230] MỖI MÃ LÝ DO TỪ CHỐI MỘT CÂU — trang đọc `ma` của thân 422, không đọc câu chữ của api.
    //
    // Api vẫn trả câu chung ở `error` (hợp đồng cũ, cho máy khách không biết `ma`); trang nói câu RIÊNG khi biết mã, và rơi
    // về `error` nguyên văn với mã lạ hay thân không mang mã — đúng «mã lạ ⇒ câu chung cũ» mà khoản 230 đòi.
    // ==========================================================================================
    describe("[S1.219 / khoản 230] nop-thau: lần nộp bị từ chối — mỗi mã một câu riêng, mã lạ ra câu chung", () => {
      /** Câu chung api vẫn trả ở `error` — trang KHÔNG được lặp lại nó khi đã biết mã. */
      const CAU_CHUNG =
        "Gói thầu không nhận báo giá này: kiểm lại trạng thái gói thầu, hạn nộp của vòng đang mở, và việc luồng báo giá của bạn có được mời nộp lại ở vòng này hay không.";
      /** Bấm «Niêm phong và nộp» với api trả thân `than` ở mã `status`; trả câu ở `loi3` sau khi đòi nút bật lại và bước 4 đóng. */
      const nopVoi = async (status: number, than: unknown): Promise<string> => {
        const p = await dungTrang("nop-thau", {
          hash: "", cookie: null, khach: true,
          thay: (l) => (l === "GET /guest/rfq" ? Promise.resolve({ status: 200, body: GOI_NOP }) : l === "POST /guest/bids" ? Promise.resolve({ status, body: than }) : undefined),
        });
        await p.bam("nut-dung-phien");
        await p.bam("nut-nop");
        expect(p.trangThai.goi).toContain("POST /guest/bids");
        expect(p.el("b4").hidden, "bước 4 không mở khi bị từ chối").toBe(true);
        expect(p.el("nut-nop").disabled, "nút nộp bấm lại được").toBe(false);
        expect(p.el("loi3").hidden).toBe(false);
        return p.el("loi3").textContent;
      };
      /** Sáu mã của `MA_THEO_RANG_BUOC` (`packages/bidding`) cộng mã của nhánh VÌ HẠN — mỗi mã một vế câu phải có. */
      const CAU_THEO_MA: readonly (readonly [string, RegExp])[] = [
        ["C1_QUA_HAN_NOP", /^Đã quá hạn nộp báo giá theo giờ của hệ thống/u],
        ["C1_GOI_KHONG_NHAN_BAO_GIA", /^Gói thầu này không còn nhận báo giá — đã đóng, đã huỷ hay chưa mở/u],
        ["BAFO_NGOAI_TOP_N", /không nằm trong vòng BAFO đang mở/u],
        ["C1_KHONG_VONG_BAFO_DANG_MO", /không thấy vòng nào đang mở — dữ liệu gói thầu không nhất quán/u],
        ["C1_KHONG_HAN_NOP", /không có hạn nộp — dữ liệu gói thầu không nhất quán/u],
        ["PHIEN_KHACH_KHONG_HOP_LE", /^Phiên nộp thầu đã hết hạn hoặc đã bị thu hồi/u],
        ["PHIEN_KHACH_KHAC_LOI_MOI", /thuộc một lời mời khác/u],
      ];

      it("bảy mã (sáu của MA_THEO_RANG_BUOC + mã vì hạn) — mỗi mã một câu tiếng Việt riêng, không câu nào lặp câu chung, bảy câu đôi một khác nhau", async () => {
        const cau: string[] = [];
        for (const [ma, mau] of CAU_THEO_MA) {
          const c = await nopVoi(422, { error: CAU_CHUNG, ma });
          expect(c, ma).toMatch(mau);
          expect(c, `${ma}: lặp câu chung của api`).not.toContain("kiểm lại trạng thái gói thầu");
          expect(c, `${ma}: nói rõ báo giá chưa đi`).toMatch(/CHƯA được gửi/u);
          cau.push(c);
        }
        expect(new Set(cau).size, "bảy câu đôi một khác nhau").toBe(CAU_THEO_MA.length);
      });

      it("vì hạn: câu riêng của C1_QUA_HAN_NOP ĐI CÙNG hai giờ (phán xử, hạn) và câu «đã ghi lại» — không lặp câu của api", async () => {
        const c = await nopVoi(422, {
          error: "Đã quá hạn nộp báo giá theo giờ của hệ thống — giờ hệ thống lúc phán xử và hạn nộp đã so đi kèm lời từ chối này.",
          ma: "C1_QUA_HAN_NOP",
          gioPhanXu: "2026-09-27T00:00:05.000000Z",
          hanNop: "2026-09-27T00:00:00.000000Z",
        });
        expect(c).toMatch(/^Đã quá hạn nộp báo giá theo giờ của hệ thống — báo giá CHƯA được gửi\./u);
        expect(c).toMatch(/Giờ hệ thống lúc phán xử: .*\(2026-09-27T00:00:05\.000000Z\)\. Hạn nộp: .*\(2026-09-27T00:00:00\.000000Z\)\. Hệ thống đã ghi lại lần nộp bị chặn này\.$/u);
        expect(c).not.toContain("đi kèm lời từ chối này");
      });

      it("mã LẠ, `ma` không phải chuỗi, thân không `ma` (api cũ), 500 hay 503 không JSON ⇒ câu chung cũ: `error` nguyên văn, hai giờ vẫn kèm khi có", async () => {
        expect(await nopVoi(422, { error: CAU_CHUNG, ma: "MA_LA_9999" })).toBe(CAU_CHUNG);
        expect(await nopVoi(422, { error: CAU_CHUNG, ma: 7 })).toBe(CAU_CHUNG);
        expect(await nopVoi(422, { error: CAU_CHUNG })).toBe(CAU_CHUNG);
        const cu = await nopVoi(422, { error: "Đã quá hạn (câu api cũ).", gioPhanXu: "2026-09-27T00:00:05.000000Z", hanNop: "2026-09-27T00:00:00.000000Z" });
        expect(cu).toMatch(/^Đã quá hạn \(câu api cũ\)\. Giờ hệ thống lúc phán xử: .*Hệ thống đã ghi lại lần nộp bị chặn này\.$/u);
        expect(await nopVoi(500, { error: "loi may chu" })).toBe("loi may chu");
        expect(await nopVoi(503, null)).toBe("Không nộp được (mã 503)");
      });
      it("bảng mã của trang ĐỐI CHIẾU với `MA_THEO_RANG_BUOC` của `packages/bidding` (đọc văn bản, như ma-tran-quyen đọc SQL): đúng sáu mã ấy cộng C1_QUA_HAN_NOP, không thừa, không thiếu — và bảy ca trên phủ trọn bảng", () => {
        // Hai bản của cùng một tập mã — bảng tên → mã ở `bidding.ts` (trigger ↔ mã đã được `bidding.int.test.ts` đo hai chiều)
        // và bảng mã → câu ở `nop-thau.js` — không có lớp nào giữ chúng khớp nhau. Một mã mới thêm ở CSDL mà quên trang ⇒ người
        // nộp nhận câu chung; một mã gõ sai ở trang ⇒ câu riêng không bao giờ hiện. Ca này là lớp ấy.
        const bidding = readFileSync(new URL("../../../packages/bidding/src/bidding.ts", import.meta.url), "utf8");
        const bang = /export const MA_THEO_RANG_BUOC = \{([\s\S]*?)\} as const;/u.exec(bidding);
        expect(bang, "không tìm thấy MA_THEO_RANG_BUOC trong bidding.ts").not.toBeNull();
        const maCsdl = [...(bang?.[1] ?? "").matchAll(/:\s*"([A-Z0-9_]+)"/gu)].map((m) => m[1] ?? "").sort();
        expect(maCsdl.length, "chống rỗng ruột").toBeGreaterThanOrEqual(6);
        const maQuaHan = /readonly ma = "([A-Z0-9_]+)" as const;/u.exec(bidding)?.[1] ?? "";
        expect(maQuaHan).toBe("C1_QUA_HAN_NOP");
        const js = readFileSync(new URL("../trang/nop-thau.js", import.meta.url), "utf8");
        const khoi = /const CAU_THEO_MA = \{([\s\S]*?)\n\};/u.exec(js);
        expect(khoi, "không tìm thấy CAU_THEO_MA trong nop-thau.js").not.toBeNull();
        const maTrang = [...(khoi?.[1] ?? "").matchAll(/^\s{2}([A-Z0-9_]+):/gmu)].map((m) => m[1] ?? "").sort();
        expect(maTrang).toEqual([...maCsdl, maQuaHan].sort());
        expect(CAU_THEO_MA.map(([ma]) => ma).sort(), "bảy ca DOM ở trên phủ trọn bảng").toEqual(maTrang);
      });
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

  // ============================================================================================
  // [S1.240 / khoản 282] BƯỚC 1 CỦA BỐN TRANG NGƯỜI MUA LÀ MỘT MODULE — ĐO BẰNG TỆP, KHÔNG BẰNG LỜI
  //
  // Ba vế: ⑴ `/lib/dang-nhap.js` được phục vụ (khai ở `MODULE_WEB`), mang `ganDangNhap`, và KHÔNG import gì — trang tải nó bằng
  // đúng một `import`, không có cây phụ thuộc nào phía sau để thiếu; ⑵ bốn trang người mua import nó, và KHÔNG trang nào tự gọi
  // `/auth/redeem` hay `/auth/totp` nữa — lời gọi ấy chỉ còn ở module; ⑶ tập trang còn tự gọi `/auth/redeem` là ĐÚNG `du-lieu.js`:
  // màn dữ liệu nền (S4.2b) chép khối cũ, ngoài danh sách tệp của lô — khoản 291. Vế ⑶ GHIM giới hạn ấy: ngày ai đưa
  // `du-lieu` sang module, vế này đỏ và phải sửa cùng lúc — cùng khuôn `countReceivedBids` của §S1.217.
  // [S1.249 / khoản 291] Ngày ấy là vòng này: `du-lieu.js` import module, vế ⑵ đọc NĂM trang, và vế ⑶ ghim tập RỖNG — không trang
  // nào trong `apps/web/trang/` còn tự đổi mã đăng nhập; một trang thứ sáu chép khối cũ làm vế ⑶ đỏ nêu tên nó.
  // ============================================================================================
  it("[S1.240 / khoản 282] /lib/dang-nhap.js ra JavaScript, không import nào; ~~bốn~~ [S1.249 / khoản 291] năm trang người mua import nó và không tự gọi /auth/redeem, /auth/totp", async () => {
    expect(MODULE_WEB).toContain("dang-nhap");
    const r = await goi("/lib/dang-nhap.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/javascript");
    expect(r.text).toContain("export function ganDangNhap");
    expect(r.text).toContain('"/auth/redeem"');
    expect(r.text).toContain('"/auth/totp"');
    expect(r.text, "module bước 1 không được kéo theo một import nào").not.toMatch(/^\s*import[\s{*]/mu);
    for (const trang of ["mo-thau", "tao-thau", "nhom-hang", "chinh-sach", "du-lieu", "nha-cung-cap"]) {
      const js = readFileSync(new URL(`../trang/${trang}.js`, import.meta.url), "utf8");
      expect(js, `${trang}.js không import ganDangNhap`).toMatch(/^import \{[^}]*\bganDangNhap\b[^}]*\} from "\/lib\/dang-nhap\.js";$/mu);
      expect(js, `${trang}.js còn tự gọi /auth/redeem`).not.toContain('"/auth/redeem"');
      expect(js, `${trang}.js còn tự gọi /auth/totp`).not.toContain('"/auth/totp"');
    }
    const thuMuc = new URL("../trang/", import.meta.url);
    const conChep = readdirSync(thuMuc)
      .filter((t) => t.endsWith(".js"))
      .filter((t) => readFileSync(new URL(t, thuMuc), "utf8").includes('"/auth/redeem"'))
      .sort();
    // [S1.249 / khoản 291] ~~`["du-lieu.js"]` — khoản 291 ghim đúng một~~ Tập rỗng: `du-lieu.js` đã sang module.
    expect(conChep, "trang còn tự đổi mã đăng nhập ngoài module").toEqual([]);
  });

  // [S1.240 / khoản 282] `/lib/dang-nhap.js` là module ĐẦU TIÊN của `MODULE_WEB` chạm DOM — trước nó mọi module ở đây là phép tính
  // thuần. Luật cấm sink HTML của [S1.107] (eslint `no-restricted-properties`) chỉ đọc `apps/web/trang/*.js`, nên vế này quét mã ĐÃ GỠ
  // KIỂU của mọi module `MODULE_WEB` — đúng thứ trình duyệt nhận — với đối chứng dương và âm trên văn bản mẫu.
  it("[S1.240 / khoản 282] không module nào của MODULE_WEB — kể cả bước 1 chạm DOM — mang sink HTML", () => {
    const SINK = /\.(?:innerHTML|outerHTML|insertAdjacentHTML)\b|\bdocument\s*\.\s*write(?:ln)?\b/u;
    expect(SINK.test('el.innerHTML = "<b>" + x + "</b>";'), "đối chứng dương: gán innerHTML").toBe(true);
    expect(SINK.test('p.insertAdjacentHTML("beforeend", x);'), "đối chứng dương: insertAdjacentHTML").toBe(true);
    expect(SINK.test("el.replaceChildren(); el.textContent = x;"), "đối chứng âm: textContent").toBe(false);
    const m = napTep();
    for (const ten of MODULE_WEB) {
      const js = m.get(`/lib/${ten}.js`)?.noiDung;
      expect(typeof js, ten).toBe("string");
      expect(SINK.test(String(js)), `${ten}.js mang một sink HTML`).toBe(false);
    }
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
  it("chuyển tiếp đường dẫn, phương thức, thân, và ĐÚNG năm header lên api", async () => {
    daNhan.length = 0;
    const r = await goi("/api/guest/redeem", {
      method: "POST",
      body: JSON.stringify({ token: "t" }),
      headers: {
        "content-type": "application/json",
        cookie: "__Host-tp_guest=xyz",
        origin: "http://127.0.0.1:8090",
        accept: "application/json",
        // [S1.230 / khoản 202] Vế thứ hai của cổng chống nguồn lạ ở api — cùng đi lên với `origin`.
        "sec-fetch-site": "same-origin",
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
    expect(n.headers["sec-fetch-site"]).toBe("same-origin");
    // Hai vế NGƯỢC, và chúng là phần đáng giá nhất của test này: khai hộ người gọi một địa chỉ
    // là đúng thứ `taoDocDiaChi` của api tồn tại để chặn, còn chuyển tiếp mù mọi header là cách
    // một bộ proxy trở thành một lỗ hổng mà không ai đọc ra từ mã của nó.
    expect(n.headers["x-forwarded-for"]).toBeUndefined();
    expect(n.headers["x-thu-la"]).toBeUndefined();
  });

  // ============================================================================================
  // [S1.230 / khoản 202] `sec-fetch-site` PHẢI ĐI LÊN, VÌ NÓ LÀ VẾ THỨ HAI CỦA CỔNG CHỐNG NGUỒN LẠ
  //
  // `nguonKhac` của `apps/api/src/server.ts` phán xử bằng HAI tín hiệu: `origin`, và khi không có
  // `origin` thì `sec-fetch-site` — với lời khai *"trình duyệt luôn gửi ít nhất MỘT trong hai"*.
  // `HEADER_LEN` từng chuyển bốn header và `sec-fetch-site` không nằm trong đó, nên một yêu cầu
  // ghi KHÔNG mang `origin` mà mang `sec-fetch-site: cross-site` bị 403 khi gọi thẳng api và đi
  // lọt khi đi qua `/api/*` của trang: bộ chuyển tiếp làm rụng đúng tín hiệu duy nhất api còn
  // để phán xử. Vế dưới đo header ĐẾN upstream, không đo phán quyết của api (đã có
  // `apps/api/src/api.int.test.ts`, vế `sec-fetch-site`); đối chứng: header lạ vẫn rụng, tức danh sách trắng vẫn là
  // danh sách trắng chứ không thành "mọi thứ".
  // ============================================================================================
  it("[khoản 202] không `origin` mà có `sec-fetch-site: cross-site` ⇒ api nhận NGUYÊN header ấy; header lạ vẫn rụng", async () => {
    daNhan.length = 0;
    const r = await goi("/api/guest/otp/verify", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "x-thu-la": "khong-duoc-di-len",
      },
    });
    expect(r.status).toBe(201);
    expect(daNhan).toHaveLength(1);
    const n = daNhan[0]!;
    expect(n.headers.origin).toBeUndefined();
    expect(n.headers["sec-fetch-site"], "vế thứ hai của cổng chống nguồn lạ rụng ở bộ chuyển tiếp").toBe("cross-site");
    // Chỉ `sec-fetch-site` — không phải cả họ `sec-fetch-*`: api chỉ đọc đúng một, và danh sách
    // trắng không được mở theo tiền tố. `fetch` của Node tự đóng dấu `sec-fetch-mode: cors` lên
    // yêu cầu đi lên (đo: upstream luôn thấy `cors`, kể cả khi khách không gửi gì), nên vế về
    // `sec-fetch-mode` chỉ đòi giá trị CỦA KHÁCH không tới nơi; `sec-fetch-dest` thì Node không
    // thêm, nên đòi vắng hẳn.
    expect(n.headers["sec-fetch-mode"]).not.toBe("navigate");
    expect(n.headers["sec-fetch-dest"]).toBeUndefined();
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

// ================================================================================================
// [S1.255 / khoản 326] 403 MANG HẰNG CỦA MÁY CHỦ KHÔNG ĐI THẲNG RA MÀN — CẢ BẢY BẢN `loiCua`
//
// Thân 403 của `apps/api` là MỘT hằng (`THAN_403 = { error: "khong co quyen" }`, `apps/api/src/dispatch.ts`) và nó phải ở
// nguyên như thế (khoản 191: nói thiếu quyền nào là dựng bản đồ mô hình quyền cho người dò). Khoản 191 sửa bước 3 của
// `/login` (S1.90); khoản 323 (S1.254) sửa `loiCua` của `/login` và `/tao-thau` — đổi ĐÚNG thân hằng ấy, để 403 khác (như
// `nguon khong duoc phep` của lớp chống CSRF theo origin, `apps/api/src/server.ts`) vẫn in nguyên văn. Năm bản còn lại —
// `/chinh-sach`, `/nhom-hang`, `/du-lieu`, `/nop-thau` và `/lib/dang-nhap.js` — vẫn in ba chữ không dấu; `du-lieu.js` có sẵn
// một câu 403 riêng đứng SAU dòng đọc `body.error`, tức mã chết từ lúc viết, vì API luôn gửi kèm hằng ấy.
//
// Lớp này đòi trên CẢ BẢY tệp: 403 mang đúng hằng ⇒ câu mở đầu bằng việc vừa bấm, nói vì quyền, không mang hằng; 403 thân
// khác, 422 có tên ⇒ đúng câu của máy chủ; không thân ⇒ câu mặc định kèm mã. Và mọi lần đọc `.error` trong bảy tệp nằm TRONG
// `loiCua` — một lối thứ hai in câu của máy chủ là một lối lớp này không đo. PHÁT BIỂU ĐÚNG MỨC: các hằng không dấu khác của
// API (`phien khong hop le`, `qua nhieu yeu cau`, `khong co duong nay`, `loi noi bo`) và câu không dấu của trigger vẫn đi ra
// nguyên văn; lớp này không dịch chúng.
// ================================================================================================
describe("[S1.255 / khoản 326] 403 mang hằng của máy chủ không đi thẳng ra màn — bảy bản `loiCua`", () => {
  const TEP: readonly string[] = [
    "trang/mo-thau.js", "trang/tao-thau.js", "trang/chinh-sach.js", "trang/nhom-hang.js",
    "trang/du-lieu.js", "trang/nop-thau.js", "src/dang-nhap.ts",
  ];
  const nguon = (t: string) => readFileSync(new URL(`../${t}`, import.meta.url), "utf8");
  const cay = (t: string) => ts.createSourceFile(t, nguon(t), ts.ScriptTarget.Latest, true, t.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const hamLoiCua = (sf: ts.SourceFile) =>
    sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "loiCua");
  type LoiCua = (r: { status: number; body: unknown }, macDinh: string) => string;
  /** `loiCua` của một tệp, chạy riêng — kèm hằng `THAN_403` cấp tệp nếu tệp có (khuôn khoản 323). */
  const layLoiCua = (t: string): LoiCua => {
    const sf = cay(t);
    const fn = hamLoiCua(sf);
    if (fn === undefined) throw new Error(`${t}: không có \`function loiCua\` ở cấp tệp`);
    const hang = sf.statements.filter((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === "THAN_403"));
    const van = [...hang, fn].map((s) => s.getText(sf)).join("\n");
    const js = ts.transpileModule(van, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return runInNewContext(`${js}\nloiCua`) as LoiCua;
  };

  it.each(TEP)("%s: 403 mang hằng `khong co quyen` ⇒ câu mở đầu bằng việc vừa bấm, nói vì quyền, không mang hằng", (t) => {
    const cau = layLoiCua(t)({ status: 403, body: { error: "khong co quyen" } }, "Không làm được việc thử");
    expect(cau).not.toMatch(/khong co quyen/u);
    expect(cau).toMatch(/^Không làm được việc thử/u);
    expect(cau).toMatch(/quyền/u);
  });

  it.each(TEP)("%s: 403 thân khác (chống CSRF theo origin) và 422 có tên đi ra nguyên văn; không thân ⇒ câu mặc định kèm mã", (t) => {
    const loiCua = layLoiCua(t);
    expect(loiCua({ status: 403, body: { error: "nguon khong duoc phep" } }, "Không làm được")).toBe("nguon khong duoc phep");
    expect(loiCua({ status: 422, body: { error: "Câu có tên của lớp gói." } }, "Không làm được")).toBe("Câu có tên của lớp gói.");
    expect(loiCua({ status: 500, body: null }, "Không làm được")).toBe("Không làm được (mã 500)");
  });

  it("mọi lần đọc `.error` trong bảy tệp nằm TRONG `loiCua` — không lối thứ hai in câu của máy chủ", () => {
    const ngoai: string[] = [];
    for (const t of TEP) {
      const sf = cay(t);
      const fn = hamLoiCua(sf);
      const dong = (n: ts.Node) => `${t}:${String(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1)}`;
      const di = (n: ts.Node): void => {
        if (n === fn) return;
        if (ts.isPropertyAccessExpression(n) && n.name.text === "error") ngoai.push(dong(n));
        if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && n.argumentExpression.text === "error") ngoai.push(dong(n));
        if (ts.isBindingElement(n) && ((n.propertyName !== undefined && ts.isIdentifier(n.propertyName) && n.propertyName.text === "error") || (n.propertyName === undefined && ts.isIdentifier(n.name) && n.name.text === "error"))) ngoai.push(dong(n));
        ts.forEachChild(n, di);
      };
      di(sf);
    }
    expect(ngoai).toEqual([]);
  });
});
