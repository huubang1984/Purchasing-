// ==============================================================================================
// CẤU HÌNH CỦA `apps/mcp` — FAIL-CLOSED, VÀ THÔNG ĐIỆP LỖI KHÔNG BAO GIỜ NÊU GIÁ TRỊ
//
// Cùng ba quy tắc của `apps/api/src/cau-hinh.ts`, vì lý do giống hệt: một `CauHinhError` đi thẳng
// ra log lúc khởi động, và biến bí mật ở đây là MỘT PHIÊN NGƯỜI MUA ĐANG SỐNG — ai đọc được nó
// thì đọc được mọi thứ người ấy đọc được, cho tới khi phiên hết hạn.
//
// Khác `apps/api` ở một chỗ và nói ra: MCP KHÔNG có vòng khoá nào, không chạm CSDL, nên bí mật
// duy nhất nó giữ là cookie phiên.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { CauHinhError, docCauHinh } from "./cau-hinh.js";

const COOKIE = "s%3AabcDEF.0123456789";
const DU: Readonly<Record<string, string>> = {
  TRUSTPROCURE_MCP_API_URL: "https://api.trustprocure.example",
  TRUSTPROCURE_MCP_SESSION_COOKIE: COOKIE,
};

describe("docCauHinh", () => {
  it("đọc đủ hai biến bắt buộc", () => {
    const ch = docCauHinh(DU);
    expect(ch.apiBaseUrl).toBe("https://api.trustprocure.example");
    expect(ch.sessionCookie).toBe(COOKIE);
    expect(ch.timeoutMs).toBeGreaterThan(0);
  });

  it.each(["TRUSTPROCURE_MCP_API_URL", "TRUSTPROCURE_MCP_SESSION_COOKIE"])(
    "thiếu %s ⇒ ném, và thông điệp nêu TÊN biến",
    (ten) => {
      const thieu = { ...DU };
      delete (thieu as Record<string, string>)[ten];
      expect(() => docCauHinh(thieu)).toThrow(CauHinhError);
      expect(() => docCauHinh(thieu)).toThrow(ten);
    },
  );

  it("KHÔNG có mặc định cho cookie phiên — chuỗi rỗng cũng là thiếu", () => {
    expect(() => docCauHinh({ ...DU, TRUSTPROCURE_MCP_SESSION_COOKIE: "  " })).toThrow(CauHinhError);
  });

  // [lượt soi 69 L-3] Hình dạng cookie-value, và một trần độ dài.
  it.each([
    { ten: "dấu chấm phẩy — chèn thêm cookie vào header", gt: "abc; admin=1" },
    { ten: "CRLF — chèn header", gt: "abc\r\nX-Evil: 1" },
    { ten: "khoảng trắng giữa", gt: "abc def" },
    { ten: "dấu nháy kép", gt: 'abc"def' },
    { ten: "ký tự ngoài ASCII in được", gt: "abcđef" },
    { ten: "quá dài", gt: "a".repeat(4097) },
  ])("từ chối cookie phiên: $ten", ({ gt }) => {
    expect(() => docCauHinh({ ...DU, TRUSTPROCURE_MCP_SESSION_COOKIE: gt })).toThrow(CauHinhError);
  });

  it("cookie phiên được TRIM — khoảng trắng hai đầu của một biến môi trường là lỗi dán-chép", () => {
    expect(docCauHinh({ ...DU, TRUSTPROCURE_MCP_SESSION_COOKIE: `  ${COOKIE}  ` }).sessionCookie).toBe(
      COOKIE,
    );
  });

  it("thông điệp lỗi KHÔNG chứa giá trị cookie", () => {
    try {
      docCauHinh({ ...DU, TRUSTPROCURE_MCP_API_URL: "ftp://x" });
      expect.unreachable("phải ném");
    } catch (e) {
      expect((e as Error).message).not.toContain(COOKIE);
    }
  });

  it.each([
    { ten: "scheme lạ", gt: "ftp://api.example" },
    { ten: "không phải URL", gt: "api.example" },
    { ten: "có đường dẫn", gt: "https://api.example/v1" },
    { ten: "có query", gt: "https://api.example/?a=1" },
    { ten: "http với host thật — cookie phiên sẽ đi trần", gt: "http://api.example" },
  ])("từ chối TRUSTPROCURE_MCP_API_URL: $ten", ({ gt }) => {
    expect(() => docCauHinh({ ...DU, TRUSTPROCURE_MCP_API_URL: gt })).toThrow(CauHinhError);
  });

  it("http CHỈ cho localhost — đường phát triển, và nó là ngoại lệ DUY NHẤT", () => {
    expect(docCauHinh({ ...DU, TRUSTPROCURE_MCP_API_URL: "http://localhost:8080" }).apiBaseUrl).toBe(
      "http://localhost:8080",
    );
    expect(docCauHinh({ ...DU, TRUSTPROCURE_MCP_API_URL: "http://127.0.0.1:8080" }).apiBaseUrl).toBe(
      "http://127.0.0.1:8080",
    );
  });

  it("trần thời gian: mặc định có, ngoài khoảng thì ném", () => {
    expect(docCauHinh(DU).timeoutMs).toBe(10_000);
    expect(docCauHinh({ ...DU, TRUSTPROCURE_MCP_TIMEOUT_MS: "500" }).timeoutMs).toBe(500);
    for (const xau of ["0", "99", "60001", "abc", "-1", "1e3"]) {
      expect(() => docCauHinh({ ...DU, TRUSTPROCURE_MCP_TIMEOUT_MS: xau })).toThrow(CauHinhError);
    }
  });
});
