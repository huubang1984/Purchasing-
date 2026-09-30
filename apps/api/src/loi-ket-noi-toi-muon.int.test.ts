// ==============================================================================================
// [S1.221 / khoản 183] DÒNG LOG "LỖI KẾT NỐI TỚI MUỘN" CỦA `api` — ĐO BẰNG HÀNH VI TRÊN POOL THẬT
//
// Khoản 183 (§S1.87): chuỗi `loi ket noi toi muon` chỉ có ở hai tệp sản xuất, không một tệp test
// nào; cổng `tests/architecture/pool-nghe-du-tin-hieu.test.ts` chỉ đo SỰ CÓ MẶT của lời gọi
// `ghiLogLoiKetNoiToiMuon(pool, …)` ở composition root, và TIN hai hàm bọc của `mo-ta-loi.ts` theo
// đường import — đột biến sống: thân `ghiLogLoiKetNoiToiMuon` thành no-op ⇒ cổng VẪN XANH. Người
// anh em `ghiLogKetNoiHuy` có hai phép đo hành vi (`composition.int.test.ts` ⑴⑷ qua tiến trình thật,
// `loi-giao-thuc.int.test.ts` ⒥ ở mức hàm); lớp S1.84 thì không. Tệp này là phép đo ấy: một pool
// thật vai `app_api`, gắn ĐÚNG hai hàm bọc như `taoTienTrinhApi` gắn, cảnh kết nối tới SAU trần, và
// dòng log ghim NGUYÊN VĂN.
//
// Cảnh theo khuôn §S1.84 (`packages/tenancy/src/with-tenant.int.test.ts`): pool MỘT kết nối, kết nối
// ấy bị giữ và làm nhiễm (`SET row_security = off`); `withTenant` với trần 300 ms ném
// `CONNECT_WAIT_EXCEEDED` cho người gọi; kết nối nhả SAU trần tới lời hứa đã bị bỏ, bộ bọc vai thấy
// nhiễm và huỷ bằng `release(KetNoiNhiemError)` — không ai nhận lỗi ấy, chỉ còn sự kiện lỗi-tới-muộn.
// Hai đối chứng canh hai tính chất khác nhau: kết nối nhiễm tới TRONG trần (người gọi đã nhận lỗi ⇒
// 0 dòng) và kết nối SẠCH tới sau trần (không lỗi ⇒ 0 dòng).
//
// RANH GIỚI, nói ra: không dựng tiến trình từ `docCauHinh` — hai pool của tiến trình sống trong
// `taoTienTrinhApi`, không giữ được kết nối của chúng từ ngoài để dựng cảnh "pool bão hoà bởi một kết
// nối nhiễm"; dây nối (mỗi pool một dòng gắn) là việc của cổng kiến trúc, và tệp này đo phần cổng ấy
// KHÔNG đọc: thân hàm bọc.
// ==============================================================================================

import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate } from "@trustprocure/db";
import { TenantError, withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { ghiLogKetNoiHuy, ghiLogLoiKetNoiToiMuon } from "./mo-ta-loi.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
/** Trần chờ kết nối của cảnh tới-muộn — cùng con số với vế §S1.84 của tenancy. */
const TRAN_MS = 300;

let db: TestDatabase;
let orgA: string;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'cong-ty-a') RETURNING id",
  );
  orgA = rows[0]?.id ?? "";
  expect(orgA).not.toBe("");
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

/** Gom MỌI dòng `console.error` từ lúc bật tới lúc tắt — đúng kênh hai hàm bọc ghi. */
function batLog(): { readonly log: string[]; readonly tat: () => void } {
  const log: string[] = [];
  const cu = console.error;
  console.error = (...a: unknown[]) => {
    log.push(a.map(String).join(" "));
  };
  return {
    log,
    tat: () => {
      console.error = cu;
    },
  };
}

/** Pool MỘT kết nối vai `app_api`, gắn ĐÚNG hai hàm bọc mà `taoTienTrinhApi` gắn cho pool mang tên `ten`. */
function poolNgheDu(ten: string): pg.Pool {
  const pool = createPool(db.connectionString, 1, { role: "app_api" });
  ghiLogKetNoiHuy(pool, ten);
  ghiLogLoiKetNoiToiMuon(pool, ten);
  return pool;
}

async function ngu(ms: number): Promise<void> {
  await new Promise<void>((x) => setTimeout(x, ms));
}

/** Đợi tới khi có ít nhất một dòng, tối đa `hanMs` — trả về ngay khi có, không nới thêm. */
async function doiDong(log: readonly string[], hanMs = 3000): Promise<void> {
  const han = Date.now() + hanMs;
  while (log.length === 0 && Date.now() < han) await ngu(20);
}

/** Cảnh §S1.84: kết nối duy nhất bị giữ (làm nhiễm nếu `nhiem`), trần nổ, rồi kết nối nhả SAU trần. */
async function canhToiMuon(
  pool: pg.Pool,
  nhiem: boolean,
  log: readonly string[],
): Promise<{ readonly loiNguoiGoi: unknown; readonly logLucTranNo: readonly string[] }> {
  const giu = await pool.connect();
  let daNha = false;
  try {
    if (nhiem) await giu.query("SET row_security = off");
    const loiNguoiGoi = await withTenant(pool, orgA, () => Promise.resolve("khong chay"), { maxConnectWaitMs: TRAN_MS }).then(
      () => "KHONG_NEM",
      (e: unknown) => e,
    );
    const logLucTranNo = [...log];
    giu.release();
    daNha = true;
    await doiDong(log);
    // Thêm một quãng ngắn để một dòng THỨ HAI (nếu có) kịp tới — vế "một sự cố, một dòng" cần nó.
    await ngu(200);
    return { loiNguoiGoi, logLucTranNo };
  } finally {
    if (!daNha) giu.release();
  }
}

describe("[S1.221 / khoản 183] api: `ghiLogLoiKetNoiToiMuon` ghi đúng dòng khi kết nối nhiễm tới sau trần, trên pool thật", () => {
  it("⑴ kết nối NHIỄM tới SAU trần ⇒ người gọi nhận CONNECT_WAIT_EXCEEDED, và ĐÚNG MỘT dòng `[api] loi ket noi toi muon pool KetNoiNhiemError` — `ghiLogKetNoiHuy` trên cùng pool không thêm dòng nào; dòng không mang id tổ chức; pool về 0/0/0", async () => {
    const pool = poolNgheDu("pool");
    const { log, tat } = batLog();
    try {
      const { loiNguoiGoi, logLucTranNo } = await canhToiMuon(pool, true, log);
      expect((loiNguoiGoi as TenantError).code, "người gọi vẫn nhận đúng lỗi của trần").toBe("CONNECT_WAIT_EXCEEDED");
      expect(logLucTranNo, "trần vừa nổ, kết nối muộn chưa tới ⇒ chưa có gì để ghi").toEqual([]);
      expect(log).toEqual(["[api] loi ket noi toi muon pool KetNoiNhiemError"]);
      expect(log[0]).not.toContain(orgA);
      expect({ tong: pool.totalCount, ranh: pool.idleCount, cho: pool.waitingCount }).toEqual({ tong: 0, ranh: 0, cho: 0 });
    } finally {
      tat();
      await pool.end().catch(() => undefined);
    }
  }, 30_000);

  it("⑵ dòng nêu TÊN POOL được gắn — cùng cảnh trên pool tên `auditPool` ⇒ `[api] loi ket noi toi muon auditPool KetNoiNhiemError`", async () => {
    const pool = poolNgheDu("auditPool");
    const { log, tat } = batLog();
    try {
      const { loiNguoiGoi } = await canhToiMuon(pool, true, log);
      expect((loiNguoiGoi as TenantError).code).toBe("CONNECT_WAIT_EXCEEDED");
      expect(log).toEqual(["[api] loi ket noi toi muon auditPool KetNoiNhiemError"]);
    } finally {
      tat();
      await pool.end().catch(() => undefined);
    }
  }, 30_000);

  it("⑶ ĐỐI CHỨNG: kết nối nhiễm tới TRONG trần ⇒ người gọi nhận KetNoiNhiemError, 0 dòng — một sự cố không thành hai dấu", async () => {
    const pool = poolNgheDu("pool");
    const { log, tat } = batLog();
    const giu = await pool.connect();
    try {
      await giu.query("SET row_security = off");
      setTimeout(() => giu.release(), 100);
      const loi = await withTenant(pool, orgA, () => Promise.resolve("khong chay"), { maxConnectWaitMs: 4000 }).then(
        () => "KHONG_NEM",
        (e: unknown) => e,
      );
      expect((loi as Error).name, "trong trần thì lỗi đi ra qua Promise.race").toBe("KetNoiNhiemError");
      await ngu(300);
      expect(log).toEqual([]);
    } finally {
      tat();
      await pool.end().catch(() => undefined);
    }
  }, 30_000);

  it("⑷ ĐỐI CHỨNG: kết nối SẠCH tới sau trần ⇒ người gọi nhận CONNECT_WAIT_EXCEEDED, kết nối về pool, 0 dòng — chỉ LỖI tới muộn mới thành dòng", async () => {
    const pool = poolNgheDu("pool");
    const { log, tat } = batLog();
    try {
      const { loiNguoiGoi } = await canhToiMuon(pool, false, log);
      expect((loiNguoiGoi as TenantError).code).toBe("CONNECT_WAIT_EXCEEDED");
      expect(log).toEqual([]);
      expect({ tong: pool.totalCount, ranh: pool.idleCount }, "kết nối sạch trả về pool, không bị huỷ").toEqual({ tong: 1, ranh: 1 });
    } finally {
      tat();
      await pool.end().catch(() => undefined);
    }
  }, 30_000);
});
