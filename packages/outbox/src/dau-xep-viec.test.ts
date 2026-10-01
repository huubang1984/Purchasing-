import { describe, expect, it } from "vitest";
import type pg from "pg";
import { enqueueJob, layDauXepViec, type JobInput } from "./index.js";

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
// [S1.239 / khoản 161] Bốn vế dưới đo DẤU, không đo `kind`: trước vòng này chúng dùng `"TEST_KIND"`; nay `JobInput.kind` là union
// `KindOutbox` nên chúng mượn một kind THẬT — client là giả, không câu SQL nào chạy.
const KIND = "LOGIN_LINK_SEND";

describe("[khoản 156] dấu xếp việc do chính enqueueJob để lại", () => {
  it("⑴ xếp việc ⇒ có dấu, và lần đọc thứ hai KHÔNG còn dấu", async () => {
    const c = clientGia([[{ id: "job-1" }]]);
    expect(layDauXepViec(c), "client sạch thì không có dấu").toBe(false);
    await enqueueJob(c, ORG, { kind: KIND, payload: { rfqId: ORG } });
    expect(layDauXepViec(c), "xếp việc xong thì có dấu").toBe(true);
    expect(layDauXepViec(c), "đọc THÌ XOÁ — một giao dịch chỉ đánh thức một lần").toBe(false);
  });

  it("⑵ dấu KHÔNG đi theo pool sang một client khác", async () => {
    const a = clientGia([[{ id: "job-1" }]]);
    const b = clientGia([[{ id: "job-2" }]]);
    await enqueueJob(a, ORG, { kind: KIND, payload: {} });
    expect(layDauXepViec(b), "client của yêu cầu khác không được mang dấu của yêu cầu này").toBe(false);
    expect(layDauXepViec(a)).toBe(true);
  });

  it("⑶ câu INSERT NÉM ⇒ không dấu — đường 23503 của /auth/link không có gì để đánh thức", async () => {
    const loi = Object.assign(new Error("insert or update violates foreign key constraint"), { code: "23503" });
    const c = clientGia([loi]);
    await expect(enqueueJob(c, ORG, { kind: KIND, payload: {} })).rejects.toMatchObject({ code: "23503" });
    expect(layDauXepViec(c), "không có hàng nào được chèn thì không có việc nào để chạy").toBe(false);
  });

  it("⑷ nhánh DO NOTHING (trùng dedupeKey, job cũ còn chờ) VẪN đặt dấu", async () => {
    // Câu chèn nuốt xung đột (0 hàng), câu tìm bản trùng trả id của job đang chờ.
    const c = clientGia([[], [{ id: "job-cu" }]]);
    const id = await enqueueJob(c, ORG, { kind: KIND, payload: {}, dedupeKey: "k" });
    expect(id).toBe("job-cu");
    expect(layDauXepViec(c), "job cũ vẫn PENDING — vẫn phải có ai đó đánh thức runner").toBe(true);
  });
});

// ============================================================================================
// [S1.239 / khoản 161] `JobInput.kind` LÀ UNION `KindOutbox` — PHÉP ĐO Ở TẦNG BIÊN DỊCH
//
// Hai `@ts-expect-error` dưới đây LÀ phép đo, cùng khuôn `packages/audit/src/verifier.test.ts`: nếu ai trả `kind` về `string` thì
// hai dòng ấy biên dịch được, và `pnpm typecheck` ĐỎ với "Unused '@ts-expect-error' directive" — không cách nào để lớp này mục đi
// trong im lặng. Hai hình dạng là hai hình dạng của phép đo trước (§S1.239): một kind ngoài tập, và một chuỗi ghép (kiểu `string`).
// Vế chạy chỉ để tệp có một khẳng định; trọng tài là tsc.
// ============================================================================================
describe("[S1.239 / khoản 161] `JobInput.kind` là union `KindOutbox` — tsc từ chối kind ngoài tập và chuỗi ghép", () => {
  it("literal trong union biên dịch; kind lạ và chuỗi ghép KHÔNG biên dịch (`@ts-expect-error` là mốc chết)", () => {
    const hop: JobInput = { kind: "UNSEAL_RFQ" };
    // @ts-expect-error — "THU_LOT_161" không thuộc KindOutbox: đúng lỗ khoản 161 (kind không người nhận nằm PENDING im lặng).
    const la: JobInput = { kind: "THU_LOT_161" };
    const ghep: string = ["UNSEAL", "RFQ"].join("_");
    // @ts-expect-error — chuỗi ghép mang kiểu `string`, không thu hẹp được về union.
    const quaBien: JobInput = { kind: ghep };
    expect([hop.kind, la.kind, quaBien.kind]).toEqual(["UNSEAL_RFQ", "THU_LOT_161", "UNSEAL_RFQ"]);
  });
});
