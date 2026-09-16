// ==============================================================================================
// KHUNG THÔNG ĐIỆP TRÊN STDIO — NƠI MỘT BỘ CÀI TỰ VIẾT THƯỜNG HỎNG
//
// Transport stdio của MCP là "một thông điệp JSON một dòng". Nghe như `chunk.split("\n")`, và đó
// chính là cái bẫy: `chunk` là BYTE, không phải dòng và cũng không phải ký tự.
//
//   • một thông điệp tới làm HAI chunk (TCP/pipe chia tuỳ ý) ⇒ `split` cho hai nửa JSON hỏng;
//   • hai thông điệp tới CHUNG một chunk ⇒ bỏ mất cái thứ hai nếu chỉ lấy phần tử đầu;
//   • một ký tự UTF-8 nhiều byte (tên nhà cung cấp tiếng Việt) bị cắt GIỮA hai chunk ⇒ `toString()`
//     trên từng chunk sinh ký tự thay thế, và JSON hỏng ở một chỗ không ai nghĩ tới;
//   • một dòng khổng lồ ⇒ bộ đệm lớn không giới hạn.
//
// Bốn ca ấy là bốn khẳng định dưới đây. Đây cũng là chỗ cái giá của "không dùng SDK" phải trả.
// ==============================================================================================

import { describe, expect, it } from "vitest";
import { taoBoGomDong, TRAN_DONG_KY_TU } from "./khung-dong.js";

function gom(cacChunk: Buffer[]): { dong: string[]; loi: string[]; demToiDa: number } {
  const dong: string[] = [];
  const loi: string[] = [];
  let demToiDa = 0;
  const bo = taoBoGomDong({
    khiCoDong: (d) => dong.push(d),
    khiQuaTran: (m) => loi.push(m),
  });
  for (const c of cacChunk) {
    bo.nhan(c);
    demToiDa = Math.max(demToiDa, bo.coDem());
  }
  return { dong, loi, demToiDa };
}

describe("bộ gom dòng", () => {
  it("một dòng đầy đủ", () => {
    expect(gom([Buffer.from('{"a":1}\n')]).dong).toEqual(['{"a":1}']);
  });

  it("một thông điệp chia làm hai chunk", () => {
    expect(gom([Buffer.from('{"a":'), Buffer.from('1}\n')]).dong).toEqual(['{"a":1}']);
  });

  it("hai thông điệp trong một chunk", () => {
    expect(gom([Buffer.from('{"a":1}\n{"b":2}\n')]).dong).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("dòng chưa kết thúc thì CHƯA phát ra", () => {
    expect(gom([Buffer.from('{"a":1}')]).dong).toEqual([]);
  });

  it("CRLF: bỏ \\r cuối dòng", () => {
    expect(gom([Buffer.from('{"a":1}\r\n')]).dong).toEqual(['{"a":1}']);
  });

  it("dòng rỗng và dòng chỉ khoảng trắng bị bỏ qua", () => {
    expect(gom([Buffer.from('\n   \n{"a":1}\n')]).dong).toEqual(['{"a":1}']);
  });

  it("ký tự UTF-8 nhiều byte bị cắt giữa hai chunk vẫn về nguyên", () => {
    const noiDung = '{"ten":"Thép Hoà Phát"}';
    const b = Buffer.from(`${noiDung}\n`, "utf8");
    // Cắt giữa một ký tự nhiều byte: `é` ở đầu chuỗi là hai byte.
    const catTai = b.indexOf(Buffer.from("é", "utf8")) + 1;
    expect(gom([b.subarray(0, catTai), b.subarray(catTai)]).dong).toEqual([noiDung]);
  });

  it("dòng vượt trần: báo lỗi, KHÔNG phát ra, và bộ đệm được xả", () => {
    const qua = Buffer.from(`${"a".repeat(TRAN_DONG_KY_TU + 1)}\n{"sau":1}\n`);
    const kq = gom([qua]);
    expect(kq.loi.length).toBe(1);
    // Thông điệp sau dòng hỏng vẫn được đọc — một dòng quá dài không được làm chết cả phiên.
    expect(kq.dong).toEqual(['{"sau":1}']);
  });

  it("dòng vượt trần chia nhiều chunk cũng bị chặn, không tích vô hạn", () => {
    const nua = Buffer.from("a".repeat(TRAN_DONG_KY_TU));
    const kq = gom([nua, nua, Buffer.from("\n")]);
    expect(kq.loi.length).toBeGreaterThan(0);
    expect(kq.dong).toEqual([]);
  });

  // ==========================================================================================
  // [lượt soi 69 M-1] CA NÀY BẮT MỘT LỖI THẬT, VÀ NÓ BẮT VÌ NEWLINE KHÔNG TỚI NGAY SAU LẦN XẢ
  //
  // Ca ngay trên gửi `[1 MiB, 1 MiB, "\n"]` — newline tới ở chunk NGAY SAU lần xả đầu, nên nó đo
  // đúng một bước của chế độ "đang bỏ" rồi dừng. Bản đầu của `khung-dong.ts` đi qua ca ấy trong
  // khi vẫn tích mọi chunk từ bước thứ hai trở đi: điều kiện xả mang `!dangBo`, và `dangBo` thì
  // không tắt cho tới khi gặp newline. Ca dưới đây gửi NĂM chunk không newline và đo THẲNG bộ
  // đệm, nên nó không đi qua được bằng cách nào khác ngoài xả thật.
  // ==========================================================================================
  it("dòng không bao giờ kết thúc: bộ đệm KHÔNG lớn hơn một trần cố định", () => {
    const chunk = Buffer.from("a".repeat(TRAN_DONG_KY_TU));
    const kq = gom([chunk, chunk, chunk, chunk, chunk]);
    expect(kq.loi.length, "phải báo vượt trần đúng một lần cho một dòng").toBe(1);
    expect(kq.dong).toEqual([]);
    expect(
      kq.demToiDa,
      "bộ đệm tích qua các chunk sau lần xả đầu — chế độ 'bỏ tới hết dòng' đang KHÔNG bỏ",
    ).toBeLessThanOrEqual(TRAN_DONG_KY_TU * 2);
  });

  it("sau một dòng quá dài không kết thúc, dòng kế TIẾP vẫn đọc được", () => {
    const chunk = Buffer.from("a".repeat(TRAN_DONG_KY_TU));
    const kq = gom([chunk, chunk, Buffer.from('bbb\n{"sau":1}\n')]);
    expect(kq.dong).toEqual(['{"sau":1}']);
    expect(kq.demToiDa).toBeLessThanOrEqual(TRAN_DONG_KY_TU * 2);
  });
});
