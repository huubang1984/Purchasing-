// Bộ ghép đường dẫn TỰ VIẾT là chỗ ADR-020 §8.2 gọi tên là rủi ro. Đây là phép đo của rủi ro ấy:
// mỗi lỗ mà một framework đóng hộ được liệt kê thành một ca, và ca nào không có ở đây thì chưa
// được đóng.
import { describe, expect, it } from "vitest";
import { HttpError } from "./http.js";
import {
  docCookie,
  ghepDuongDan,
  phanTichThan,
  tachCookiePhien,
  tachDoan,
  tachQuery,
} from "./router.js";

describe("tachDoan — chỉ nhận đường dẫn có hình dạng đã khai", () => {
  it("đường hợp lệ tách thành đoạn; gốc là mảng rỗng", () => {
    expect(tachDoan("/")).toEqual([]);
    expect(tachDoan("/suppliers")).toEqual(["suppliers"]);
    expect(tachDoan("/guest/bids/2/receipt")).toEqual(["guest", "bids", "2", "receipt"]);
    expect(tachDoan("/rfq/3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toHaveLength(2);
  });

  it.each([
    ["..", "/suppliers/../admin"],
    ["%2F", "/guest%2Fsession"],
    ["% nói chung", "/rfq/%00"],
    ["gạch chéo ngược", "/guest\\session"],
    ["hai gạch chéo", "/guest//session"],
    ["gạch chéo cuối", "/suppliers/"],
    ["khoảng trắng", "/sup pliers"],
    ["không bắt đầu bằng /", "suppliers"],
    ["đoạn rỗng", "//"],
  ])("từ chối: %s", (_ten, duong) => {
    expect(tachDoan(duong)).toBeNull();
  });
});

describe("ghepDuongDan — tham số theo đoạn, không theo regex", () => {
  it("điền tham số :name và từ chối khi lệch số đoạn", () => {
    expect(ghepDuongDan("/rfq/:rfqId/items", ["rfq", "abc", "items"])).toEqual({
      params: { rfqId: "abc" },
    });
    expect(ghepDuongDan("/rfq/:rfqId/items", ["rfq", "abc"])).toBeNull();
    expect(ghepDuongDan("/rfq/:rfqId", ["rfq", "abc", "x"])).toBeNull();
    expect(ghepDuongDan("/", [])).toEqual({ params: {} });
  });

  it("đoạn cố định phải khớp CHÍNH XÁC, kể cả hoa thường", () => {
    expect(ghepDuongDan("/suppliers", ["Suppliers"])).toBeNull();
  });
});

describe("tachQuery / docCookie / tachCookiePhien", () => {
  it("query bị cắt và KHÔNG đi đâu cả", () => {
    expect(tachQuery("/guest/session?token=abc")).toBe("/guest/session");
    expect(tachQuery("/health")).toBe("/health");
  });

  it("[sổ nợ 42] cookie: tên LẶP thì BỎ tên ấy (không lấy đầu, không lấy sau); bỏ mảnh không có dấu bằng", () => {
    // ~~lấy giá trị ĐẦU khi lặp tên~~ — review L-2: lấy cái đầu là cho kẻ ném cookie thắng.
    expect(docCookie("a=1; b=2; a=3; rac; =x")).toEqual({ b: "2" });
    expect(docCookie("a=1; a=1")).toEqual({});
    expect(docCookie("a=1; b=2; a=3; a=4")).toEqual({ b: "2" });
    expect(docCookie(undefined)).toEqual({});
    // [review H4-12] Tên trùng tên thuộc tính prototype không bị coi là "trùng"; tên không có ⇒ undefined, không phải hàm.
    const la = docCookie("toString=1; constructor=2; __proto__=3");
    expect(Object.entries(la).sort()).toEqual([["__proto__", "3"], ["constructor", "2"], ["toString", "1"]]);
    expect(Object.hasOwn(docCookie("a=1"), "constructor")).toBe(false);
    expect(Object.hasOwn(docCookie("a=1"), "toString")).toBe(false);
    expect(Object.getPrototypeOf(docCookie("a=1"))).toBeNull();
  });

  it("cookie phiên phải là <uuid>.<base64url ≥ 32 ký tự>", () => {
    const org = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const tok = "A".repeat(43);
    expect(tachCookiePhien(`${org}.${tok}`)).toEqual({ orgId: org, token: tok });
    expect(tachCookiePhien(undefined)).toBeNull();
    expect(tachCookiePhien(`${org}`)).toBeNull();
    expect(tachCookiePhien(`khong-phai-uuid.${tok}`)).toBeNull();
    expect(tachCookiePhien(`${org}.ngan`)).toBeNull();
    expect(tachCookiePhien(`${org}.${"A".repeat(20)}+/=`)).toBeNull();
  });
});

describe("phanTichThan — JSON hoặc không gì cả", () => {
  it("thân rỗng là undefined; JSON hợp lệ được trả về", () => {
    expect(phanTichThan("", undefined)).toBeUndefined();
    expect(phanTichThan('{"a":1}', "application/json; charset=utf-8")).toEqual({ a: 1 });
  });

  it("sai content-type ⇒ 415; JSON hỏng ⇒ 400", () => {
    expect(() => phanTichThan("a=1", "application/x-www-form-urlencoded")).toThrow(HttpError);
    try {
      phanTichThan("a=1", "text/plain");
    } catch (e) {
      expect((e as HttpError).status).toBe(415);
    }
    try {
      phanTichThan("{", "application/json");
    } catch (e) {
      expect((e as HttpError).status).toBe(400);
    }
  });
});
