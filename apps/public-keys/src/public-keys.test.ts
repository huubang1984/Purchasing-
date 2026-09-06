// ==============================================================================================
// [khoản nợ 30] ĐƯỜNG CÔNG BỐ ĐƯỢC ĐO ĐẦU-CUỐI, VÀ VẾ CHỊU LỰC LÀ MỘT VẾ PHỦ ĐỊNH
//
// Khẳng định quan trọng nhất của nhóm này không phải *"endpoint trả đúng khoá"* mà là
// *"endpoint KHÔNG BAO GIỜ trả nửa riêng"*. Vế thứ nhất hỏng thì có người kêu ngay hôm sau; vế
// thứ hai hỏng thì không ai kêu bao giờ, và mọi biên nhận của hệ thống mất giá trị cùng lúc.
//
// Nên nó được đo bằng cách suy TỪ TÍNH CHẤT chứ không bằng cách đọc từng trường: dựng một vòng
// khoá thật, tuần tự hoá TOÀN BỘ phản hồi, rồi tìm chuỗi byte của khoá riêng trong đó dưới cả ba
// cách mã hoá mà một lần rò rỉ có thể mang. Thêm một trường mới vào tài liệu mai sau sẽ tự động
// nằm trong phạm vi phép đo này.
// ==============================================================================================

import { createHash, generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReceiptSigningKeyRing, type ReceiptKeyPair } from "@trustprocure/bidding";
import {
  RECEIPT_KEYS_PATH,
  buildReceiptKeyDocument,
  createReceiptKeyServer,
} from "./index.js";

function capKhoa(): ReceiptKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey: new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" })),
    publicKey: new Uint8Array(publicKey.export({ type: "spki", format: "der" })),
  };
}

const K1 = capKhoa();
const K2 = capKhoa();
const vongKhoa = new ReceiptSigningKeyRing("bien-nhan-2026-02", {
  "bien-nhan-2026-01": K1,
  "bien-nhan-2026-02": K2,
});

let server: ReturnType<typeof createReceiptKeyServer>;
let goc = "";

beforeAll(async () => {
  server = createReceiptKeyServer(vongKhoa);
  await new Promise<void>((xong) => server.listen(0, "127.0.0.1", xong));
  const dia = server.address() as AddressInfo;
  goc = `http://127.0.0.1:${String(dia.port)}`;
});

afterAll(async () => {
  await new Promise<void>((xong) => server.close(() => { xong(); }));
});

describe("[khoản nợ 30] khoá công khai ký biên nhận có một ĐƯỜNG để lấy", () => {
  it("[INV-B2] tài liệu liệt kê CẢ HAI khoá của vòng, kèm khoá đang dùng", async () => {
    const res = await fetch(`${goc}${RECEIPT_KEYS_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/u);
    const doc = (await res.json()) as ReturnType<typeof buildReceiptKeyDocument>;

    // Vòng khoá KHÔNG được rụng khoá cũ (ADR-011 mục 3) — nên tài liệu công bố cũng không.
    expect(doc.keys.map((k) => k.kid)).toEqual(["bien-nhan-2026-01", "bien-nhan-2026-02"]);
    expect(doc.activeKeyId).toBe("bien-nhan-2026-02");
  });

  it("[INV-B2] khoá công bố ĐÚNG là nửa công khai thật, và dấu vân tay khớp", async () => {
    const res = await fetch(`${goc}${RECEIPT_KEYS_PATH}/bien-nhan-2026-01`);
    expect(res.status).toBe(200);
    const k = (await res.json()) as { spki: string; fingerprint: string; alg: string };

    // ĐỐI CHỨNG DƯƠNG so với chuỗi byte gốc, không so với chính bộ sinh.
    expect(Buffer.from(k.spki, "base64").equals(Buffer.from(K1.publicKey))).toBe(true);
    expect(k.fingerprint).toBe(createHash("sha256").update(K1.publicKey).digest("hex"));
    expect(k.alg).toBe("ECDSA_P256_SHA256");
  });

  it("[khoản nợ 30] VẾ CHỊU LỰC: không phản hồi nào mang một byte nào của khoá RIÊNG", async () => {
    const cacDuong = [
      RECEIPT_KEYS_PATH,
      `${RECEIPT_KEYS_PATH}/bien-nhan-2026-01`,
      `${RECEIPT_KEYS_PATH}/bien-nhan-2026-02`,
      `${RECEIPT_KEYS_PATH}/khong-co`,
      "/",
    ];
    let daKiem = 0;
    for (const d of cacDuong) {
      const than = await (await fetch(`${goc}${d}`)).text();
      daKiem += 1;
      for (const [ten, k] of [
        ["2026-01", K1],
        ["2026-02", K2],
      ] as const) {
        const rieng = Buffer.from(k.privateKey);
        for (const cach of ["base64", "hex", "base64url"] as const) {
          expect(
            than.includes(rieng.toString(cach)),
            `${d} rò rỉ khoá riêng của ${ten} ở dạng ${cach}`,
          ).toBe(false);
        }
      }
    }
    expect(daKiem, "chống rỗng ruột: phải thật sự gọi được các đường").toBe(cacDuong.length);
  });

  it("[khoản nợ 30] ĐỐI CHỨNG cho vế trên: chính phép tìm ấy BẮT ĐƯỢC một lần rò rỉ dựng sẵn", () => {
    // Không có ca này thì `includes(...) === false` cũng đúng khi phép mã hoá bị viết sai và
    // chuỗi so sánh không bao giờ xuất hiện ở đâu cả.
    const roRi = JSON.stringify({ oops: Buffer.from(K1.privateKey).toString("base64") });
    expect(roRi.includes(Buffer.from(K1.privateKey).toString("base64"))).toBe(true);
  });

  it("[khoản nợ 30] `kid` không có thì 404, và KHÔNG vọng lại chuỗi người gọi gửi", async () => {
    const doc = "<script>alert(1)</script>";
    const res = await fetch(`${goc}${RECEIPT_KEYS_PATH}/${encodeURIComponent(doc)}`);
    expect(res.status).toBe(404);
    const than = await res.text();
    // Một đường không xác thực vọng lại đầu vào là một máy phản chiếu miễn phí — cho log của
    // chúng ta, và cho bất kỳ ai đọc log ấy bằng một công cụ render HTML.
    expect(than).not.toContain("script");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("[khoản nợ 30] dịch vụ này CHỈ ĐỌC — mọi phương thức ghi bị từ chối", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await fetch(`${goc}${RECEIPT_KEYS_PATH}`, { method });
      expect(res.status, `${method} phải bị từ chối`).toBe(405);
    }
  });

  it("[khoản nợ 30] query bám đuôi KHÔNG đổi được đường", async () => {
    const res = await fetch(`${goc}${RECEIPT_KEYS_PATH}?callback=x`);
    expect(res.status).toBe(200);
  });

  it("[khoản nợ 30] thứ tự khoá ỔN ĐỊNH — hai lần dựng cho cùng một tài liệu", () => {
    const nguoc = new ReceiptSigningKeyRing("bien-nhan-2026-02", {
      "bien-nhan-2026-02": K2,
      "bien-nhan-2026-01": K1,
    });
    // Tài liệu này được so byte ở tầng vận hành. Một thứ tự phụ thuộc thứ tự chèn làm hai lần
    // khởi động cho hai tài liệu khác nhau mà không có gì thật sự đổi.
    expect(buildReceiptKeyDocument(nguoc)).toEqual(buildReceiptKeyDocument(vongKhoa));
  });
});
