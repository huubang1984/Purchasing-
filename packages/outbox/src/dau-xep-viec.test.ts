import { describe, expect, it } from "vitest";
import type pg from "pg";
import { enqueueJob, layDauXepViec } from "./index.js";

// ============================================================================================
// [S1.92 / khoản 156] DẤU "GIAO DỊCH NÀY ĐÃ XẾP VIỆC" — bốn tính chất, không cần Postgres.
//
// Dấu là thứ thay cho một lời khai của route, nên phép đo ở đây đo đúng bốn ca mà lời khai cũ
// làm sai hoặc làm đúng một cách tình cờ:
//   ⑴ xếp việc ⇒ có dấu, và ĐỌC THÌ XOÁ (một lần đánh thức cho một giao dịch);
//   ⑵ dấu KHÔNG rò sang client khác — client thuộc về pool và sẽ phục vụ người khác;
//   ⑶ `enqueueJob` NÉM ⇒ không dấu: đường 23503 của `/auth/link` vẫn "không có gì để đánh thức";
//   ⑷ nhánh `DO NOTHING` (đã có job trùng khoá đang chờ) VẪN có dấu — job ấy vẫn đang chờ chạy.
// ============================================================================================

/** Một client giả: chỉ `query`, vì đó là tất cả những gì `enqueueJob` chạm tới. */
function clientGia(tra: readonly (unknown[] | Error)[]): pg.PoolClient {
  let i = 0;
  return {
    query: (): Promise<{ rows: unknown[] }> => {
      const ke = tra[i] ?? [];
      i += 1;
      // `Promise.reject` chứ không `throw` trong một hàm `async`: hàm này không chờ gì cả, và một
      // `async` không có `await` là đúng thứ `@typescript-eslint/require-await` từ chối.
      return ke instanceof Error ? Promise.reject(ke) : Promise.resolve({ rows: [...ke] });
    },
  } as unknown as pg.PoolClient;
}

const ORG = "11111111-1111-4111-8111-111111111111";

describe("[khoản 156] dấu xếp việc do chính enqueueJob để lại", () => {
  it("⑴ xếp việc ⇒ có dấu, và lần đọc thứ hai KHÔNG còn dấu", async () => {
    const c = clientGia([[{ id: "job-1" }]]);
    expect(layDauXepViec(c), "client sạch thì không có dấu").toBe(false);
    await enqueueJob(c, ORG, { kind: "TEST_KIND", payload: { rfqId: ORG } });
    expect(layDauXepViec(c), "xếp việc xong thì có dấu").toBe(true);
    expect(layDauXepViec(c), "đọc THÌ XOÁ — một giao dịch chỉ đánh thức một lần").toBe(false);
  });

  it("⑵ dấu KHÔNG đi theo pool sang một client khác", async () => {
    const a = clientGia([[{ id: "job-1" }]]);
    const b = clientGia([[{ id: "job-2" }]]);
    await enqueueJob(a, ORG, { kind: "TEST_KIND", payload: {} });
    expect(layDauXepViec(b), "client của yêu cầu khác không được mang dấu của yêu cầu này").toBe(false);
    expect(layDauXepViec(a)).toBe(true);
  });

  it("⑶ câu INSERT NÉM ⇒ không dấu — đường 23503 của /auth/link không có gì để đánh thức", async () => {
    const loi = Object.assign(new Error("insert or update violates foreign key constraint"), { code: "23503" });
    const c = clientGia([loi]);
    await expect(enqueueJob(c, ORG, { kind: "TEST_KIND", payload: {} })).rejects.toMatchObject({ code: "23503" });
    expect(layDauXepViec(c), "không có hàng nào được chèn thì không có việc nào để chạy").toBe(false);
  });

  it("⑷ nhánh DO NOTHING (trùng dedupeKey, job cũ còn chờ) VẪN đặt dấu", async () => {
    // Câu chèn nuốt xung đột (0 hàng), câu tìm bản trùng trả id của job đang chờ.
    const c = clientGia([[], [{ id: "job-cu" }]]);
    const id = await enqueueJob(c, ORG, { kind: "TEST_KIND", payload: {}, dedupeKey: "k" });
    expect(id).toBe("job-cu");
    expect(layDauXepViec(c), "job cũ vẫn PENDING — vẫn phải có ai đó đánh thức runner").toBe(true);
  });
});
