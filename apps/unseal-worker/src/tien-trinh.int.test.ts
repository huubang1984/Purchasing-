// ==============================================================================================
// [S1.82 / khoản 116] ĐIỂM VÀO TIẾN TRÌNH CỦA WORKER MỞ THẦU — ĐO TRÊN ĐƯỜNG SẼ CHẠY
//
// Khoản 116 nói thẳng vấn đề: *"phép đo của 106/107 chạy trên một đường KHÁC đường sẽ chạy"* —
// vì `apps/unseal-worker` có composition mà không có tiến trình. Tệp này đo đường ẤY: một pool
// dựng từ chuỗi kết nối của role ĐĂNG NHẬP thật (`app_unseal_login`), `SET ROLE app_unseal`, hai
// pool riêng, và `listOrganizations` nối vào hàm `052`.
//
// BỐN NHÓM, và nhóm ⑵ là nhóm không có nó thì cả vòng này là một lời hứa:
//   ⑴ cấu hình sai / phiên mạnh hơn vai ⇒ `batDau()` NÉM, tiến trình KHÔNG lên;
//   ⑵ hàm `052` trả ĐỦ tổ chức dưới vai `app_unseal`, và BA đột biến lúc chạy đều giết nó;
//   ⑶ nguồn danh sách tổ chức hỏng ⇒ NÉM LÚC KHỞI ĐỘNG, không phải im lặng phục vụ 0 tổ chức;
//   ⑷ hai pool phải KHÁC NHAU (khoản 121) — một docstring không chặn được gì.
// ==============================================================================================

import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "@trustprocure/db";
import { JobRunner, enqueueJob } from "@trustprocure/outbox";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { docCauHinh } from "./cau-hinh.js";
import { taoTienTrinhUnsealWorker } from "./tien-trinh.js";
import { UNSEAL_JOB_KIND, createUnsealWorkerRunner } from "./composition.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const KHOA_32 = Buffer.alloc(32, 3).toString("base64");

let db: TestDatabase;
let unsealPool: pg.Pool;
let urlLogin: string;
let thuMucCanhBao: string;
const cacOrg: string[] = [];

function doiNguoiDung(chuoi: string, nguoi: string, matKhau: string): string {
  const u = new URL(chuoi);
  u.username = nguoi;
  u.password = matKhau;
  return u.toString();
}

function moiTruong(ghiDe: Record<string, string> = {}): Record<string, string> {
  return {
    TRUSTPROCURE_DATABASE_URL: urlLogin,
    TRUSTPROCURE_DB_POOL_MAX: "2",
    TRUSTPROCURE_KEY_ADAPTER: "local-dev",
    TRUSTPROCURE_MASTER_KEYS: `v1=${KHOA_32}`,
    TRUSTPROCURE_MASTER_KEY_ACTIVE: "v1",
    TRUSTPROCURE_ALERT_ADAPTER: "dev-file",
    TRUSTPROCURE_ALERT_DIR: thuMucCanhBao,
    ...ghiDe,
  };
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
  for (const s of ["A", "B", "C"]) {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      [`Cong ty ${s}`, `cong-ty-${s.toLowerCase()}-s182`],
    );
    cacOrg.push(rows[0]!.id);
  }
  await db.pool.query("CREATE ROLE app_unseal_login LOGIN PASSWORD 'mk-unseal' IN ROLE app_unseal");
  urlLogin = doiNguoiDung(db.connectionString, "app_unseal_login", "mk-unseal");
  thuMucCanhBao = mkdtempSync(join(tmpdir(), "tp-canh-bao-"));
  unsealPool = db.poolAs("app_unseal");
}, 180_000);

afterAll(async () => {
  await unsealPool?.end().catch(() => undefined);
  await db?.stop();
});

describe("[S1.82 / khoản 116] điểm vào tiến trình worker mở thầu", () => {
  it("⑴ đối chứng dương: `batDau()` lên được, thấy ĐỦ tổ chức, rồi `dung()` sạch", async () => {
    const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong()));
    try {
      await tt.batDau();
    } finally {
      await tt.dung();
    }
    // `dung()` gọi hai lần phải là no-op, không ném.
    await tt.dung();
  }, 60_000);

  it("⑴ URL superuser bị chặn ở CẤU HÌNH (theo TÊN), trước khi chạm CSDL", () => {
    expect(() => docCauHinh(moiTruong({ TRUSTPROCURE_DATABASE_URL: db.connectionString }))).toThrow(
      /app_unseal_login/u,
    );
  });

  it("⑴ phiên đăng nhập MẠNH HƠN vai ⇒ `batDau()` NÉM (theo THUỘC TÍNH), tiến trình không lên", async () => {
    // Tên đúng nên lớp cấu hình cho qua; lớp thứ hai đo THUỘC TÍNH của phiên.
    await db.pool.query("ALTER ROLE app_unseal_login BYPASSRLS");
    const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong()));
    try {
      await expect(tt.batDau()).rejects.toThrow();
    } finally {
      await tt.dung();
      await db.pool.query("ALTER ROLE app_unseal_login NOBYPASSRLS");
    }
  }, 60_000);

  it("⑵ hàm 052 trả ĐỦ tổ chức dưới vai app_unseal — và BA đột biến lúc chạy đều giết nó", async () => {
    const dem = async (): Promise<number> => {
      const { rows } = await unsealPool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.outbox_danh_sach_to_chuc()",
      );
      return Number(rows[0]!.n);
    };
    const demThang = async (): Promise<number> => {
      const { rows } = await unsealPool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.organizations",
      );
      return Number(rows[0]!.n);
    };

    expect(await dem(), "hàm phải thấy ĐÚNG mọi tổ chức, không phải > 0").toBe(cacOrg.length);
    // VẾ GIỮ BÁN KÍNH: policy mới mang `TO app_liet_ke_to_chuc`, nên đọc THẲNG vẫn 0 hàng.
    expect(await demThang(), "app_unseal KHÔNG được đọc thẳng organizations").toBe(0);

    for (const [ten, dotBien, phucHoi] of [
      [
        "⒜ SECURITY INVOKER — hàm thôi chạy dưới quyền chủ",
        "ALTER FUNCTION public.outbox_danh_sach_to_chuc() SECURITY INVOKER",
        "ALTER FUNCTION public.outbox_danh_sach_to_chuc() SECURITY DEFINER",
      ],
      [
        "⒝ DROP POLICY — policy là thứ CHỊU LỰC, không phải SECURITY DEFINER",
        "DROP POLICY organizations_liet_ke_worker ON public.organizations",
        "CREATE POLICY organizations_liet_ke_worker ON public.organizations FOR SELECT TO app_liet_ke_to_chuc USING (true)",
      ],
      [
        "⒞ đổi CHỦ HÀM sang một vai thường — chủ hàm là thứ CHỊU LỰC",
        "ALTER FUNCTION public.outbox_danh_sach_to_chuc() OWNER TO app_unseal",
        "ALTER FUNCTION public.outbox_danh_sach_to_chuc() OWNER TO app_liet_ke_to_chuc",
      ],
    ] as const) {
      await db.pool.query(dotBien);
      try {
        // Khẳng định ĐỘT BIẾN ĐÃ ÁP trước khi đếm — một đột biến "chạy rồi" mà không áp cho một
        // con số xanh giả, đúng bài học của khoản 99.
        expect(await dem(), ten).toBe(0);
      } finally {
        await db.pool.query(phucHoi);
        // ĐỔI CHỦ VIẾT LẠI ACL — đo được ở chính lượt này: sau ⒞ thì `app_unseal` MẤT EXECUTE và
        // câu đếm ném 42501. Cùng cơ chế đã buộc `052` phải đặt khối ACL TRƯỚC `ALTER … OWNER TO`.
        // Nên phục hồi phải cấp lại, không chỉ đổi chủ về.
        await db.pool.query(
          "GRANT EXECUTE ON FUNCTION public.outbox_danh_sach_to_chuc() TO app_unseal",
        );
      }
    }
    expect(await dem(), "phục hồi cả ba ⇒ trở lại đủ").toBe(cacOrg.length);
  }, 60_000);

  it("⑶ `app_unseal` mất EXECUTE trên hàm ⇒ `batDau()` NÉM ngay, không im lặng phục vụ 0 tổ chức", async () => {
    await db.pool.query(
      "REVOKE EXECUTE ON FUNCTION public.outbox_danh_sach_to_chuc() FROM app_unseal",
    );
    const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong()));
    try {
      await expect(tt.batDau()).rejects.toThrow(/outbox_danh_sach_to_chuc/u);
    } finally {
      await tt.dung();
      await db.pool.query(
        "GRANT EXECUTE ON FUNCTION public.outbox_danh_sach_to_chuc() TO app_unseal",
      );
    }
  }, 60_000);

  it("⑸ MỐC CHẾT HAI CHIỀU: api không chạm `UNSEAL_RFQ`, worker không chạm `LOGIN_LINK_SEND`", async () => {
    // Đây là vế mà cả S1.81 lẫn S1.82 tồn tại để dựng, đo bằng HAI bảng handler THẬT trên CÙNG
    // một hàng đợi. Trước S1.81, lượt api ở đây sẽ ghi `UNSEAL_RFQ` thành FAILED/NO_HANDLER.
    const org = cacOrg[0]!;
    const apiPool = db.poolAs("app_api");
    try {
      const xep = async (kind: string): Promise<string> =>
        withTenant(apiPool, org, (c) =>
          enqueueJob(c, org, { kind, payload: { unsealRequestId: randomUUID(), rfqId: randomUUID() } }),
        );
      const idMoThau = await xep(UNSEAL_JOB_KIND);
      const idDangNhap = await xep("LOGIN_LINK_SEND");

      const doc = async (id: string): Promise<{ status: string; attempts: number }> => {
        const { rows } = await db.pool.query<{ status: string; attempts: number }>(
          "SELECT status, attempts FROM outbox_jobs WHERE id = $1",
          [id],
        );
        return rows[0]!;
      };

      // ── lượt của tiến trình `api`: bảng handler đúng một khoá `LOGIN_LINK_SEND` ──────────────
      const runnerApi = new JobRunner(
        apiPool,
        { LOGIN_LINK_SEND: () => Promise.resolve() },
        { listOrganizations: () => [org], onJobFailure: () => undefined },
      );
      expect(await runnerApi.runOnce(), "api chỉ được nhặt job của CHÍNH nó").toBe(1);
      expect(await doc(idDangNhap), "job của api phải xong").toMatchObject({ status: "DONE" });
      expect(
        await doc(idMoThau),
        "api ĐÃ CHẠM job mở thầu — đúng lỗi mà S1.81 vá; nó phải còn nguyên PENDING",
      ).toMatchObject({ status: "PENDING", attempts: 0 });

      // ── lượt của tiến trình `worker`: hai kind của nó ────────────────────────────────────────
      const idDangNhap2 = await xep("LOGIN_LINK_SEND");
      const runnerWorker = createUnsealWorkerRunner(
        unsealPool,
        {
          unwrapper: { name: "x", unwrap: () => Promise.reject(new Error("khong goi toi")) },
          alertSink: { name: "x", deliver: () => Promise.resolve() },
          auditPool: db.poolAs("app_unseal"),
          onJobFailure: () => undefined,
        },
        { listOrganizations: () => [org], onPollError: () => undefined, maxAttempts: 1 },
      );
      await runnerWorker.runOnce();
      expect(
        (await doc(idMoThau)).attempts,
        "worker phải CLAIM được job mở thầu — nếu 0 thì đường mở thầu vẫn không chạy",
      ).toBe(1);
      expect(
        await doc(idDangNhap2),
        "worker KHÔNG được chạm job của api",
      ).toMatchObject({ status: "PENDING", attempts: 0 });
    } finally {
      await apiPool.end().catch(() => undefined);
    }
  }, 90_000);

  it("⑷ hai pool TRÙNG NHAU bị chặn ở lời gọi, không phải ở một docstring (khoản 121)", () => {
    expect(() =>
      createUnsealWorkerRunner(
        unsealPool,
        {
          unwrapper: { name: "x", unwrap: () => Promise.reject(new Error("khong goi toi")) },
          alertSink: { name: "x", deliver: () => Promise.resolve() },
          auditPool: unsealPool,
          onJobFailure: () => undefined,
        },
        { listOrganizations: () => [], onPollError: () => undefined },
      ),
    ).toThrow(/KHÁC NHAU/u);
  });
});
