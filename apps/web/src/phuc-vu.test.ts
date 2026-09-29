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
import * as taoThau from "./tao-thau.js";
import * as nhomHang from "./nhom-hang.js";
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
      // [S1.201 / S3.6a] Màn nhóm hàng — cùng khuôn đăng nhập và phiên với ba trang người mua kia.
      "nhom-hang": ["b2", "b3"],
    };
    /** Lời gọi mỗi trang tự đi sau khi mở các bước — trước lượt đo riêng của từng trang. */
    const SAU_MO: Record<string, readonly string[]> = {
      "chinh-sach": ["GET /policy/versions"],
      "tao-thau": ["GET /policy/versions"],
      "nhom-hang": ["GET /categories"],
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
          if (lenh === "GET /categories" && trangThai.cookie !== null) return { status: 200, body: { nhomHang: [] } };
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

    it("[S1.181 / ADR-110] tao-thau: Thu hồi xong ⇒ câu báo nói báo giá cũ vẫn nằm trong gói và chỉ đường Gửi lại link, không khuyên mời lại", async () => {
      const { p, nut } = await moDanhSachLoiMoi((l) => (l === "POST /invitations/i-1/revoke" ? Promise.resolve({ status: 200, body: { revoked: true } }) : undefined));
      for (const f of nut[1]?.nghe["click"] ?? []) await f();
      expect(p.el("ok5").textContent).toMatch(/Báo giá đã nộp theo lời mời này \(nếu có\) vẫn nằm trong gói thầu/u);
      expect(p.el("ok5").textContent).toMatch(/«Gửi lại link»/u);
      expect(p.el("ok5").textContent).not.toMatch(/Mời lại/u);
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
            : l === "GET /rfqs/r-1" ? Promise.resolve({ status: 200, body: { rfq: { id: "r-1", title: "Gói", status: trangThaiGoi } } })
            : l === "GET /rfqs/r-1/items" ? Promise.resolve({ status: 200, body: { items: [] } })
            : l === "GET /rfqs/r-1/invitations"
              ? Promise.resolve({ status: 200, body: { invitations: [{ id: "i-1", supplierName: "Công ty Thép", contactName: "Chị Lan", linkChannel: "EMAIL", status: "UNSENT", revokedAt: null }] } })
              : undefined),
      });
      await p.bam("nut-dung-phien");
      p.el("rfq").value = "r-1";
      await p.bam("nut-doc");
      const dongMoi = () => p.el("bang-moi").querySelector("tbody").con[0];
      return { p, dongMoi };
    };

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
      expect((draft.dongMoi()?.con[4]?.con ?? []).map((x) => x.textContent)).toEqual(["Thu hồi"]);
      const mo = await moTaoThau(true, "OPEN");
      expect((mo.dongMoi()?.con[4]?.con ?? []).map((x) => x.textContent)).toEqual(["Gửi lại link"]);
      const choDuyet = await moTaoThau(true, "PENDING_APPROVAL");
      expect(choDuyet.dongMoi()?.con[4]?.con ?? []).toEqual([]);
      const mvp1 = await moTaoThau(false, "OPEN");
      await mvp1.p.bam("nut-doc-moi");
      expect((mvp1.dongMoi()?.con[4]?.con ?? []).map((x) => x.textContent)).toEqual(["Gửi lại link", "Thu hồi"]);
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
