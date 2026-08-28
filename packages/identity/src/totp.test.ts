import { describe, expect, it } from "vitest";
import {
  counterForTime,
  deriveTotpCode,
  generateTotpSecret,
  isWellFormedTotpCode,
  verifyTotpCode,
} from "./totp.js";

// RFC 6238 Appendix B: khoá SHA-1 là chuỗi ASCII "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

// Cột TOTP của RFC là 8 chữ số; bản 6 chữ số là 6 ký tự cuối. Sáu giá trị dưới đây là phép thử
// BIẾT-TRƯỚC-ĐÁP-ÁN: nếu cài đặt sai một chi tiết nào — thứ tự byte của bộ đếm, phép cắt động,
// mặt nạ 0x7f — không giá trị nào khớp.
const RFC_VECTORS: ReadonlyArray<{ seconds: number; expected: string }> = [
  { seconds: 59, expected: "287082" },
  { seconds: 1111111109, expected: "081804" },
  { seconds: 1111111111, expected: "050471" },
  { seconds: 1234567890, expected: "005924" },
  { seconds: 2000000000, expected: "279037" },
  { seconds: 20000000000, expected: "353130" },
];

describe("TOTP", () => {
  it.each(RFC_VECTORS)("khớp vector RFC 6238 tại T=$seconds", ({ seconds, expected }) => {
    expect(deriveTotpCode(RFC_SECRET, counterForTime(seconds * 1000))).toBe(expected);
  });

  it("sáu vector RFC KHÔNG trùng nhau — chống rỗng ruột cho bảng trên", () => {
    // Nếu `deriveTotpCode` bị đột biến thành một hằng số, sáu khẳng định trên vẫn có thể xanh
    // trong một bản viết lại tệ hơn (vd. bảng vector bị sửa cho khớp). Neo tính PHÂN BIỆT của
    // chính bộ vector, độc lập với cài đặt.
    expect(new Set(RFC_VECTORS.map((v) => v.expected)).size).toBe(RFC_VECTORS.length);
  });

  it("sinh bí mật dài 20 byte và khác nhau mỗi lần", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a.length).toBe(20);
    expect(a.equals(b)).toBe(false);
  });

  it("counterForTime chia đúng bước 30 giây và từ chối đầu vào không hữu hạn", () => {
    expect(counterForTime(0)).toBe(0);
    expect(counterForTime(29_999)).toBe(0);
    expect(counterForTime(30_000)).toBe(1);
    expect(counterForTime(59_999)).toBe(1);
    expect(() => counterForTime(Number.NaN)).toThrow(/hữu hạn/);
    expect(() => counterForTime(Number.POSITIVE_INFINITY)).toThrow(/hữu hạn/);
  });

  it("deriveTotpCode từ chối bộ đếm âm thay vì ném lỗi khó đọc của Buffer", () => {
    expect(() => deriveTotpCode(RFC_SECRET, -1)).toThrow(/không âm/);
  });

  it("[INV-E3(2)] chấp nhận mã đúng ở bước hiện tại", () => {
    const now = 1_700_000_000_000;
    const code = deriveTotpCode(RFC_SECRET, counterForTime(now));
    expect(verifyTotpCode(RFC_SECRET, code, { now })).toEqual({
      ok: true,
      counter: counterForTime(now),
    });
  });

  it("[INV-E3(2)] chấp nhận lệch một bước để bù trễ mạng, từ chối lệch hai bước", () => {
    const now = 1_700_000_000_000;
    const counter = counterForTime(now);

    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter - 1), { now }).ok).toBe(true);
    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter + 1), { now }).ok).toBe(true);
    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter - 2), { now }).ok).toBe(false);
    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter + 2), { now }).ok).toBe(false);
  });

  it("[INV-E3(2)] bước khớp được TRẢ VỀ đúng, không phải luôn là bước hiện tại", () => {
    // Chống rỗng ruột cho test trên: một cài đặt trả về `counterForTime(now)` bất kể bước nào
    // khớp vẫn làm mọi khẳng định `.ok` xanh — và nó phá vế "dùng một lần", vì bộ đếm ghi vào
    // `last_used_counter` sẽ sai.
    const now = 1_700_000_000_000;
    const counter = counterForTime(now);
    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter - 1), { now })).toEqual({
      ok: true,
      counter: counter - 1,
    });
    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter + 1), { now })).toEqual({
      ok: true,
      counter: counter + 1,
    });
  });

  it("[INV-E3(2)] mã đã dùng không dùng lại được — VÀ mọi bước KHÔNG LỚN HƠN cũng vậy", () => {
    const now = 1_700_000_000_000;
    const counter = counterForTime(now);
    const code = deriveTotpCode(RFC_SECRET, counter);

    expect(verifyTotpCode(RFC_SECRET, code, { now }).ok).toBe(true);
    expect(verifyTotpCode(RFC_SECRET, code, { now, lastUsedCounter: counter })).toEqual({
      ok: false,
      reason: "CODE_ALREADY_USED",
    });
    // Vế `<=` chứ không `=`: mã của bước TRƯỚC (vẫn còn trong cửa sổ trượt) cũng phải bị từ
    // chối sau khi bước sau đã được dùng — nếu không, kẻ bắt được mã cũ vẫn chơi lại được.
    expect(
      verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter - 1), {
        now,
        lastUsedCounter: counter,
      }),
    ).toEqual({ ok: false, reason: "CODE_ALREADY_USED" });
    // Đối chứng dương: bước SAU thì vẫn qua, tức phép chặn không phải "chặn tất cả".
    expect(
      verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter + 1), {
        now,
        lastUsedCounter: counter,
      }),
    ).toEqual({ ok: true, counter: counter + 1 });
  });

  it("[INV-E3(2)] lastUsedCounter = null hoặc vắng mặt KHÔNG chặn gì", () => {
    // `typeof daDung === "number"` là vế chịu lực: `null <= counter` trong JS là `true` (null ép
    // về 0), nên một phép kiểm ngây thơ sẽ từ chối MỌI mã của một hồ sơ chưa từng dùng.
    const now = 1_700_000_000_000;
    const counter = counterForTime(now);
    const code = deriveTotpCode(RFC_SECRET, counter);
    expect(verifyTotpCode(RFC_SECRET, code, { now, lastUsedCounter: null }).ok).toBe(true);
    expect(verifyTotpCode(RFC_SECRET, code, { now }).ok).toBe(true);
  });

  it("[INV-E3(3)] từ chối mã sai định dạng mà không rò rỉ thông tin khác", () => {
    const now = 1_700_000_000_000;
    for (const xau of ["", "12345", "1234567", "abcdef", "12 34 56", "١٢٣٤٥٦", "12345\n", "+12345"]) {
      expect(verifyTotpCode(RFC_SECRET, xau, { now })).toEqual({
        ok: false,
        reason: "MALFORMED_CODE",
      });
    }
  });

  it("isWellFormedTotpCode phán xét ĐÚNG BẰNG phép kiểm mà verifyTotpCode dùng", () => {
    // Hai bản lệch nhau trong im lặng là đúng lớp lỗi mà dự án này đã phải đóng bằng meta-test
    // nhiều lần (thân app_current_org_id(), chuỗi D3). Ở đây chúng là MỘT hàm; test này khoá
    // điều đó lại thay vì tin.
    const now = 1_700_000_000_000;
    for (const xau of ["", "12345", "1234567", "abcdef", "١٢٣٤٥٦", "000000", "999999"]) {
      const saiDinhDang =
        verifyTotpCode(RFC_SECRET, xau, { now }).ok === false &&
        (verifyTotpCode(RFC_SECRET, xau, { now }) as { reason: string }).reason ===
          "MALFORMED_CODE";
      expect(isWellFormedTotpCode(xau)).toBe(!saiDinhDang);
    }
  });

  it("[INV-E3(3)] mã sai bị từ chối", () => {
    const now = 1_700_000_000_000;
    const dung = deriveTotpCode(RFC_SECRET, counterForTime(now));
    const sai = dung === "000000" ? "111111" : "000000";
    expect(verifyTotpCode(RFC_SECRET, sai, { now })).toEqual({ ok: false, reason: "WRONG_CODE" });
  });

  it("[INV-E3(3)] window = 0 chỉ chấp nhận đúng bước hiện tại", () => {
    const now = 1_700_000_000_000;
    const counter = counterForTime(now);
    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter), { now, window: 0 }).ok).toBe(
      true,
    );
    expect(
      verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter - 1), { now, window: 0 }).ok,
    ).toBe(false);
    expect(() => verifyTotpCode(RFC_SECRET, "000000", { now, window: -1 })).toThrow(/không âm/);
  });

  it("[INV-E3(3)] bộ đếm âm trong cửa sổ trượt không làm hàm ném — sát epoch vẫn phán xét được", () => {
    // `now` = 0 làm bước `hienTai - 1` âm. Nếu vòng lặp không bỏ qua nhánh đó, mọi lời gọi ở
    // đây ném RangeError thay vì trả một phán xét — tức fail-CRASH chứ không fail-closed.
    const code = deriveTotpCode(RFC_SECRET, 0);
    expect(verifyTotpCode(RFC_SECRET, code, { now: 0 })).toEqual({ ok: true, counter: 0 });
    expect(verifyTotpCode(RFC_SECRET, "000000", { now: 0 }).ok).toBe(false);
  });

  // ==========================================================================================
  // [CẤM LOG] Bí mật TOTP, mã OTP và mọi mảnh của chúng KHÔNG được đi vào một chuỗi nào.
  //
  // Đây là một PHÉP KIỂM, không phải một lời hứa trong chú thích — cùng khuôn với test của
  // Task 8 khẳng định không một mảnh giá/token nào lọt vào thông báo lỗi.
  // ==========================================================================================
  it("[CẤM LOG] không thông báo lỗi nào của totp.ts mang bí mật hoặc mã", () => {
    const biMat = generateTotpSecret();
    const biMatHex = biMat.toString("hex");
    const biMatB64 = biMat.toString("base64");
    const ma = deriveTotpCode(biMat, 1);

    const cacLoi: string[] = [];
    const bat = (fn: () => unknown): void => {
      try {
        fn();
      } catch (loi) {
        cacLoi.push(loi instanceof Error ? `${loi.name}: ${loi.message}` : String(loi));
      }
    };
    bat(() => counterForTime(Number.NaN));
    bat(() => deriveTotpCode(biMat, -1));
    bat(() => verifyTotpCode(biMat, ma, { window: -1 }));
    bat(() => verifyTotpCode(biMat, ma, { window: 1.5 }));
    // Chống rỗng ruột: phải THẬT SỰ có lỗi để mà quét.
    expect(cacLoi.length).toBe(4);

    const gop = cacLoi.join("\n");
    expect(gop).not.toContain(biMatHex);
    expect(gop).not.toContain(biMatB64);
    expect(gop).not.toContain(ma);
    // Cả một mảnh cũng không: 8 ký tự hex đầu là đủ để thu hẹp không gian tìm kiếm.
    expect(gop).not.toContain(biMatHex.slice(0, 8));

    // Và các GIÁ TRỊ TRẢ VỀ cũng không mang bí mật — `TotpResult` chỉ có `ok`, `counter`,
    // `reason`. Nếu ai đó thêm một trường chẩn đoán vào đó, khẳng định này đỏ.
    const traVe = JSON.stringify([
      verifyTotpCode(biMat, ma),
      verifyTotpCode(biMat, "000000"),
      verifyTotpCode(biMat, "abc"),
    ]);
    expect(traVe).not.toContain(biMatHex);
    expect(traVe).not.toContain(biMatB64);
    expect(traVe).not.toContain(ma);
  });

  it("[CẤM LOG] gói identity KHÔNG có đường sinh URI otpauth:// hay mã QR", async () => {
    // Đường ghi danh dạng `otpauth://totp/...?secret=<base32>` mang bí mật ở dạng RÕ trong một
    // chuỗi — tức nó là đường dễ nhất để bí mật rơi vào một dòng log, một URL, hay một ảnh QR
    // được lưu lại. Task 9 CỐ Ý không viết nó. Khẳng định này giữ quyết định đó nhìn thấy được:
    // ai thêm nó vào phải sửa test này và trả lời câu hỏi "bí mật rõ đi tới đâu".
    const cua = (await import("./index.js")) as Record<string, unknown>;
    const ten = Object.keys(cua).join(" ").toLowerCase();
    expect(ten).not.toContain("otpauth");
    expect(ten).not.toContain("qr");
    expect(ten).not.toContain("uri");
    // Đối chứng dương: cửa phải THẬT SỰ có gì đó để quét.
    expect(Object.keys(cua)).toContain("generateTotpSecret");
  });
});
