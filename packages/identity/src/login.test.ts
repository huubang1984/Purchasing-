// ==============================================================================================
// [S1.240 / khoản 268 / ADR-126] `listRecentLoginTokens` — PHẦN JAVASCRIPT CỦA CỬA SỔ, TRẦN VÀ CỜ «CÒN NỮA»
//
// Ngữ nghĩa SQL (cửa sổ 7 ngày, thứ tự, RLS, không `token_hash` trong thân) đo trên Postgres thật qua HTTP ở
// `apps/api/src/auth.int.test.ts` khối `[S1.240 / khoản 268]`. Tệp này đo đúng phần mà không cần Postgres: câu đọc xin TRẦN + 1 hàng
// (không hơn — một lần đọc không kéo cả lịch sử về), trả ĐÚNG trần hàng đầu theo thứ tự câu đọc, và `truncated` đúng khi và chỉ khi
// câu đọc trả hơn trần — ở ba mép 0, trần, trần + 1. Client là một bản ghi hai câu: câu của `assertTenantBound` (gắn đúng tổ chức) và
// câu đọc; câu thứ ba là lỗi.
// ==============================================================================================

import type pg from "pg";
import { describe, expect, it } from "vitest";
import { LoginTokenError, listRecentLoginTokens } from "./login.js";

const ORG = "11111111-2222-4333-8444-555555555555";
const NGUOI = "aaaaaaaa-0000-4000-8000-000000000000";

interface CauDoc {
  readonly sql: string;
  readonly thamSo: readonly unknown[];
}

/** Client giả: trả `hangDoc` cho câu đọc, ghi lại câu và tham số. */
function clientGia(hangDoc: readonly Record<string, unknown>[]): { readonly client: pg.PoolClient; readonly cau: CauDoc[] } {
  const cau: CauDoc[] = [];
  const query = (sql: string, thamSo: readonly unknown[] = []): Promise<{ rows: readonly Record<string, unknown>[] }> => {
    cau.push({ sql, thamSo });
    if (sql.includes("app_current_org_id()")) return Promise.resolve({ rows: [{ khop: true, dang_gan: ORG }] });
    if (cau.length !== 2) throw new Error(`câu thứ ${String(cau.length)} không có trong kịch bản: ${sql.slice(0, 60)}`);
    return Promise.resolve({ rows: hangDoc });
  };
  return { client: { query } as unknown as pg.PoolClient, cau };
}

/** `n` hàng như Postgres trả, mới nhất trước — hàng thứ i tạo i phút trước một mốc cố định. */
function hang(n: number): Record<string, unknown>[] {
  const moc = Date.parse("2026-09-30T12:00:00Z");
  return Array.from({ length: n }, (_, i) => ({
    created_at: new Date(moc - i * 60_000),
    expires_at: new Date(moc - i * 60_000 + 15 * 60_000),
    consumed_at: null,
    purpose: "LOGIN",
    status: "PENDING",
  }));
}

describe("[S1.240 / khoản 268] listRecentLoginTokens — trần + 1 hàng, cắt đúng trần, cờ «còn nữa»", () => {
  it("câu đọc: cửa sổ 7 ngày theo tham số, xin ĐÚNG 101 hàng, liệt kê đúng năm cột và không `token_hash`", async () => {
    const { client, cau } = clientGia(hang(3));
    await listRecentLoginTokens(client, ORG, NGUOI);
    expect(cau).toHaveLength(2);
    const doc = cau[1];
    expect(doc?.thamSo).toEqual([NGUOI, 7, 101]);
    expect(doc?.sql).toMatch(/make_interval\(days => \$2::pg_catalog\.int4\)/u);
    expect(doc?.sql).toMatch(/LIMIT \$3::pg_catalog\.int4/u);
    expect(doc?.sql).not.toMatch(/token_hash|\*/u);
  });

  it("0, 100 hàng ⇒ trả nguyên, `truncated: false`; 101 hàng ⇒ ĐÚNG 100 hàng đầu theo thứ tự câu đọc, `truncated: true`", async () => {
    for (const [n, soTra, cat] of [
      [0, 0, false],
      [1, 1, false],
      [100, 100, false],
      [101, 100, true],
    ] as const) {
      const vao = hang(n);
      const kq = await listRecentLoginTokens(clientGia(vao).client, ORG, NGUOI);
      expect(kq.links, `${String(n)} hàng`).toHaveLength(soTra);
      expect(kq.truncated, `${String(n)} hàng`).toBe(cat);
      expect(kq.links.map((l) => l.createdAt), `${String(n)} hàng — thứ tự của câu đọc`).toEqual(vao.slice(0, soTra).map((h) => h.created_at));
    }
  });

  it("mỗi link đúng năm trường của ADR-126 — không `id`, không băm", async () => {
    const kq = await listRecentLoginTokens(clientGia(hang(1)).client, ORG, NGUOI);
    expect(Object.keys(kq.links[0] ?? {}).sort()).toEqual(["consumedAt", "createdAt", "expiresAt", "purpose", "status"]);
    expect(Object.keys(kq).sort()).toEqual(["links", "truncated"]);
  });

  it("userId sai hình dạng ⇒ LoginTokenError, và không câu đọc nào sau câu gắn tổ chức", async () => {
    const { client, cau } = clientGia(hang(1));
    await expect(listRecentLoginTokens(client, ORG, "khong-phai-uuid")).rejects.toBeInstanceOf(LoginTokenError);
    expect(cau).toHaveLength(1);
  });
});
