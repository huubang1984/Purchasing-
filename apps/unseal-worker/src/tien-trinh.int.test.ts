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
import { KIND_KHONG_NGUOI_NHAN, JobRunner, enqueueJob } from "@trustprocure/outbox";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { docCauHinh } from "./cau-hinh.js";
import { taoTienTrinhUnsealWorker } from "./tien-trinh.js";
import { UNSEAL_JOB_KIND, createUnsealWorkerRunner } from "./composition.js";
// [S1.83 / lượt soi ngang 73] Bảng handler THẬT của tiến trình `api`, không một bản viết tay.
// Cùng tiền lệ với `composition.int.test.ts`, và lý do ở vế ⑸.
import { buildApiOutboxHandlers } from "../../api/src/outbox-api.js";
import { dichVuTest } from "../../api/src/test-services.js";

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

  // [khoản 165] Tiến trình này giữ MỘT vòng nên không tự so chéo được (ADR-006). Ca đối chứng dương
  // ngay trên đã ghi dấu kiểm của `v1` = KHOA_32; một worker dán NHẦM khoá khác dưới `v1` phải KHÔNG
  // lên — trước khoản 165 nó lên và chỉ hỏng lúc mở phong bì thật, giữa một lượt mở thầu.
  it("⑴ [khoản 165] khoá bọc dán NHẦM dưới cùng tên phiên bản ⇒ `batDau()` NÉM DauKiemVongKhoaLechError, tiến trình không lên", async () => {
    const nham = Buffer.alloc(32, 7).toString("base64");
    const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong({ TRUSTPROCURE_MASTER_KEYS: `v1=${nham}` })));
    try {
      await expect(tt.batDau()).rejects.toMatchObject({ name: "DauKiemVongKhoaLechError" });
    } finally {
      await tt.dung();
    }
  }, 60_000);

  // [khoản 196 / ADR-074 phần 1] Cùng hai vế với `apps/api/src/composition.int.test.ts`: lúc KHỞI
  // ĐỘNG lệch quá ngưỡng ⇒ không lên; lúc CHẠY đồng hồ trôi ⇒ một dòng log cảnh báo có tên, không dừng.
  // Đồng hồ trôi được dựng ở phía TIẾN TRÌNH (đồng hồ tiêm) — đồng hồ CSDL không vặn được từ test.
  it("⑴ [khoản 196] đồng hồ tiến trình lệch 6 giờ 22 phút so với CSDL ⇒ `batDau()` NÉM LechDongHoError, tiến trình không lên", async () => {
    const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong()), { dongHo: () => Date.now() + (6 * 3600_000 + 22 * 60_000) });
    try {
      await expect(tt.batDau()).rejects.toMatchObject({ name: "LechDongHoError" });
    } finally {
      await tt.dung();
    }
  }, 60_000);

  it("⑴ [khoản 196] đồng hồ trôi SAU khi đã lên ⇒ dòng log `canh bao LechDongHo` mang ba con số, không mang URL", async () => {
    const log: string[] = [];
    const cu = console.error;
    console.error = (...a: unknown[]) => {
      log.push(a.map(String).join(" "));
    };
    let troi = 0;
    const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong({ TRUSTPROCURE_CLOCK_SKEW_CHECK_MS: "1000" })), {
      dongHo: () => Date.now() + troi,
    });
    try {
      await tt.batDau();
      troi = 10_000;
      const het = Date.now() + 8000;
      let dong: string | undefined;
      while (dong === undefined && Date.now() < het) {
        await new Promise((x) => setTimeout(x, 100));
        dong = log.find((d) => d.includes("canh bao LechDongHo"));
      }
      expect(dong, JSON.stringify(log)).toBeDefined();
      expect(dong).toMatch(/lech -\d{4,5} ms .*khu hoi \d+ ms, nguong 2000 ms/u);
      expect(dong).not.toContain(urlLogin);
    } finally {
      await tt.dung();
      console.error = cu;
    }
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

  // ===============================================================================================
  // [S1.9161 / khoản 185] BA ĐỘT BIẾN CỦA `052` — MỘT BẢNG CHO VẾ ⑵ (đo HÀM) VÀ VẾ ⑵b (đo `batDau()`), MỖI ĐỘT BIẾN MỘT `it`.
  //
  // Trước vòng này cả ba chạy trong một vòng `for` của MỘT `it` ở mỗi vế: ⒜ đỏ thì ⒝ và ⒞ không bao giờ chạy — mà ⑵b là lớp DUY NHẤT
  // canh cảnh ❷ của ADR-040. Nay `it.each` khoá theo ca, và `finally` phục hồi nằm trong TỪNG ca, nên một ca đỏ không để lược đồ
  // hỏng cho ca sau. Đối chứng dương của mỗi vế tách ra riêng.
  // ===============================================================================================
  const DOT_BIEN_052 = [
    {
      ten: "⒜ SECURITY INVOKER — hàm thôi chạy dưới quyền chủ",
      dotBien: "ALTER FUNCTION public.outbox_danh_sach_to_chuc() SECURITY INVOKER",
      phucHoi: "ALTER FUNCTION public.outbox_danh_sach_to_chuc() SECURITY DEFINER",
    },
    {
      ten: "⒝ DROP POLICY — policy là thứ CHỊU LỰC, không phải SECURITY DEFINER",
      dotBien: "DROP POLICY organizations_liet_ke_worker ON public.organizations",
      phucHoi: "CREATE POLICY organizations_liet_ke_worker ON public.organizations FOR SELECT TO app_liet_ke_to_chuc USING (true)",
    },
    {
      ten: "⒞ đổi CHỦ HÀM sang một vai thường — chủ hàm là thứ CHỊU LỰC",
      dotBien: "ALTER FUNCTION public.outbox_danh_sach_to_chuc() OWNER TO app_unseal",
      phucHoi: "ALTER FUNCTION public.outbox_danh_sach_to_chuc() OWNER TO app_liet_ke_to_chuc",
    },
  ] as const;

  /**
   * Phục hồi một đột biến, VÀ cấp lại EXECUTE. ĐỔI CHỦ VIẾT LẠI ACL — đo được ở lượt S1.82: sau ⒞ thì `app_unseal` MẤT EXECUTE và
   * câu đếm ném 42501. Cùng cơ chế đã buộc `052` phải đặt khối ACL TRƯỚC `ALTER … OWNER TO`. Nên phục hồi phải cấp lại, không chỉ đổi
   * chủ về — và cấp lại cho cả ba, vì `GRANT` lặp là no-op.
   */
  async function phucHoi052(cau: string): Promise<void> {
    await db.pool.query(cau);
    await db.pool.query("GRANT EXECUTE ON FUNCTION public.outbox_danh_sach_to_chuc() TO app_unseal");
  }

  const dem = async (): Promise<number> => {
    const { rows } = await unsealPool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.outbox_danh_sach_to_chuc()",
    );
    return Number(rows[0]!.n);
  };

  it("⑵ đối chứng dương: hàm 052 trả ĐỦ tổ chức dưới vai app_unseal — và đọc THẲNG organizations vẫn 0 hàng", async () => {
    const demThang = async (): Promise<number> => {
      const { rows } = await unsealPool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.organizations",
      );
      return Number(rows[0]!.n);
    };
    expect(await dem(), "hàm phải thấy ĐÚNG mọi tổ chức, không phải > 0").toBe(cacOrg.length);
    // VẾ GIỮ BÁN KÍNH: policy mới mang `TO app_liet_ke_to_chuc`, nên đọc THẲNG vẫn 0 hàng.
    expect(await demThang(), "app_unseal KHÔNG được đọc thẳng organizations").toBe(0);
  }, 60_000);

  it.each(DOT_BIEN_052)(
    "⑵ $ten ⇒ hàm 052 trả 0 hàng; phục hồi ⇒ trở lại đủ",
    async ({ ten, dotBien, phucHoi }) => {
      await db.pool.query(dotBien);
      try {
        // Khẳng định ĐỘT BIẾN ĐÃ ÁP trước khi đếm — một đột biến "chạy rồi" mà không áp cho một
        // con số xanh giả, đúng bài học của khoản 99.
        expect(await dem(), ten).toBe(0);
      } finally {
        await phucHoi052(phucHoi);
      }
      expect(await dem(), "phục hồi ⇒ trở lại đủ").toBe(cacOrg.length);
    },
    60_000,
  );

  // ===============================================================================================
  // ⑵b [S1.83 / lượt soi ngang 73] BA ĐỘT BIẾN CỦA VẾ ⑵ CHO **0 HÀNG, KHÔNG LỖI** — VÀ TRƯỚC VÒNG
  // NÀY CẢ BA ĐI QUA `batDau()` TRÓT LỌT.
  //
  // Vế ⑵ ngay trên đo HÀM: ba đột biến đều cho 0. Vế ⑶ ngay dưới đo `batDau()` nhưng chỉ ở đường
  // hàm KHÔNG GỌI ĐƯỢC (42501). Giữa hai vế ấy là đúng cảnh ❷ của §S1.82 — gọi được, trả 0, không
  // lỗi — và không vế nào đứng ở đó. Đo trên mã trước bản vá: `batDau()` LÊN, `runner.start()`
  // chạy, `runOnce()` gặp danh sách rỗng thì `return 0`, và dấu vết duy nhất là một dòng log khởi
  // động ghi `to chuc thay duoc: 0`. Tức chính cái hỏng mà `052` sinh ra để giết thì im lặng ở
  // tiến trình dùng `052`.
  //
  // Vế này lấy ĐÚNG ba đột biến của ⑵ (cùng bảng `DOT_BIEN_052`) và hỏi câu của ⑶.
  // ===============================================================================================
  it.each(DOT_BIEN_052)(
    "⑵b $ten cho 0 hàng KHÔNG LỖI ⇒ `batDau()` NÉM — cảnh ❷ không được thành im lặng",
    async ({ ten, dotBien, phucHoi }) => {
      await db.pool.query(dotBien);
      const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong()));
      try {
        // Thông điệp phải NÊU cảnh ❷ chứ không chỉ "có lỗi" — người vận hành đọc dòng này lúc 3
        // giờ sáng phải biết đi xem policy và chủ hàm, không phải đi đoán.
        await expect(tt.batDau(), ten).rejects.toThrow(/tra 0 to chuc/u);
      } finally {
        await tt.dung();
        await phucHoi052(phucHoi);
      }
    },
    60_000,
  );

  it("⑵b ĐỐI CHỨNG DƯƠNG: sau ba đột biến đã phục hồi, tiến trình lên lại được — các ca trên đỏ vì đột biến, không phải vì `batDau()` hỏng sẵn", async () => {
    const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong()));
    try {
      await expect(tt.batDau()).resolves.toBeUndefined();
    } finally {
      await tt.dung();
    }
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
    //
    // ~~[S1.82] Vế `api` dựng bảng handler bằng tay: `{ LOGIN_LINK_SEND: () => … }`.~~
    // **[S1.83 / lượt soi ngang 73] Lời khai "HAI bảng handler THẬT" khi ấy RỘNG HƠN MÃ, và chỗ
    // hở không phải hình thức.** Bản viết tay bỏ `kindKhongNguoiNhan`, nên mảng lọc `kind` của
    // runner trong test là `["LOGIN_LINK_SEND"]` — MỘT phần tử — trong khi tiến trình `api` thật
    // dựng nó từ `Object.keys(handlers)` HỢP `Object.keys(KIND_KHONG_NGUOI_NHAN)`, tức HAI. Mốc
    // chết đo trên một mảng lọc mà sản xuất không dùng thì nó canh một tiến trình không tồn tại.
    // ~~Nay cả hai vế lấy đúng thứ `apps/api/src/composition.ts` lấy.~~
    // **[S1.9151 / khoản 168] SỔ MỒ CÔI ĐỔI CHỦ: `apps/api/src/composition.ts` THÔI khai, `tien-trinh.ts`
    // của tiến trình này khai.** Nên vế `api` dưới đây KHÔNG truyền `kindKhongNguoiNhan` — mảng lọc của
    // nó là đúng `Object.keys(handlers)` như sản xuất từ vòng này — còn vế `worker` truyền
    // `Object.keys(KIND_KHONG_NGUOI_NHAN)` như `tien-trinh.ts`. Sổ hôm nay RỖNG (S1.91), nên ở vòng này
    // hai mảng lọc không đổi kích thước; vế ⑹ dưới là chỗ đo đường ấy với một dòng thử.
    const org = cacOrg[0]!;
    const apiPool = db.poolAs("app_api");
    try {
      // [S1.83] Payload phải là payload THẬT của từng kind, vì handler nay là handler THẬT.
      // Bản viết tay trước đây nhận mọi payload, nên nó che mất chính ràng buộc này: đo được khi
      // đổi sang bảng thật — `LOGIN_LINK_SEND` không có `email` thì handler ném, job về PENDING
      // với `attempts = 1`, và vế "job của api phải xong" đỏ. Một handler giả làm mốc chết đo
      // đúng cái tên `kind` và không đo gì thêm.
      const xep = async (kind: string, payload: Record<string, unknown>): Promise<string> =>
        withTenant(apiPool, org, (c) => enqueueJob(c, org, { kind, payload }));
      const idMoThau = await xep(UNSEAL_JOB_KIND, { unsealRequestId: randomUUID(), rfqId: randomUUID() });
      // Không có người dùng nào mang địa chỉ này ⇒ `issueLoginToken` trả `ok: false` ⇒ handler kết
      // thúc BÌNH THƯỜNG, không gửi gì. Đó là đường DONE của kind ấy, đúng như sản xuất.
      const idDangNhap = await xep("LOGIN_LINK_SEND", { email: "moc-chet-hai-chieu@vd.test" });

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
        buildApiOutboxHandlers(dichVuTest().services),
        {
          listOrganizations: () => [org],
          onJobFailure: () => undefined,
          // ~~Đúng mảng lọc mà `apps/api/src/composition.ts` truyền — không phải một tập con tiện tay.~~
          // [S1.9151 / khoản 168] KHÔNG `kindKhongNguoiNhan`: `apps/api/src/composition.ts` thôi khai sổ
          // mồ côi từ vòng này, và mảng lọc của `api` là đúng `Object.keys(handlers)`.
        },
      );
      expect(await runnerApi.runOnce(), "api chỉ được nhặt job của CHÍNH nó").toBe(1);
      expect(await doc(idDangNhap), "job của api phải xong").toMatchObject({ status: "DONE" });
      expect(
        await doc(idMoThau),
        "api ĐÃ CHẠM job mở thầu — đúng lỗi mà S1.81 vá; nó phải còn nguyên PENDING",
      ).toMatchObject({ status: "PENDING", attempts: 0 });

      // ── lượt của tiến trình `worker`: hai kind của nó ────────────────────────────────────────
      const idDangNhap2 = await xep("LOGIN_LINK_SEND", { email: "moc-chet-hai-chieu-2@vd.test" });
      const runnerWorker = createUnsealWorkerRunner(
        unsealPool,
        {
          unwrapper: { name: "x", openOrgKey: () => Promise.reject(new Error("khong goi toi")) },
          alertSink: { name: "x", deliver: () => Promise.resolve() },
          auditPool: db.poolAs("app_unseal"),
          onJobFailure: () => undefined,
        },
        {
          listOrganizations: () => [org],
          onPollError: () => undefined,
          maxAttempts: 1,
          // [S1.9151 / khoản 168] Đúng sổ mà `tien-trinh.ts` khai — tiến trình này là tiến trình DUY NHẤT
          // khai sổ mồ côi từ vòng này.
          kindKhongNguoiNhan: Object.keys(KIND_KHONG_NGUOI_NHAN),
        },
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

  // ===============================================================================================
  // ⑹ [S1.9151 / khoản 168] SỔ `kind` MỒ CÔI KHAI Ở TIẾN TRÌNH THẤY MỌI TỔ CHỨC — ĐO TRÊN ĐƯỜNG SẼ CHẠY.
  //
  // Khoản 168 (§S1.83): tới trước vòng này sổ khai ở `api`, mà `listOrganizations` của `api` là tập
  // tổ chức tiến trình ấy ĐÃ THẤY enqueue (`toChucDaThay`, rỗng lại sau mỗi lần khởi động). Một job
  // mang `kind` mồ côi của một tổ chức chưa ai xếp việc qua `api` thì KHÔNG tiến trình nào claim —
  // nó nằm `PENDING` im lặng, đúng thứ sổ mồ côi sinh ra để chặn. Tiến trình này thấy MỌI tổ chức
  // (hàm `052`), nên bảo đảm *"vẫn chết ồn ào"* đặt ở đây mới đúng chỗ.
  //
  // SỔ THẬT HÔM NAY RỖNG (S1.91, khoản 154 đóng), nên phép đo phải cho nó MỘT dòng thử — và cho
  // TRÊN ĐÚNG ĐỐI TƯỢNG tiến trình đọc (`KIND_KHONG_NGUOI_NHAN`, đọc lúc `taoTienTrinhUnsealWorker`
  // dựng runner), không qua một cửa tiêm riêng: một cửa tiêm đo được cửa ấy chứ không đo được dây
  // nối mặc định, và dây nối mặc định là thứ khoản này nói tới. Dòng thử được gỡ trong `finally`;
  // tệp này có sổ riêng của nó (vitest cô lập module theo tệp), nên cổng ở
  // `composition.int.test.ts` — vế ⑶ đòi mỗi dòng trỏ một khoản CÒN MỞ — không thấy dòng này.
  // Ai đóng băng đối tượng ấy (`Object.freeze`) thì vế này NÉM chứ không xanh giả: khi ấy mở một
  // cửa tiêm trong `PhuThuocTienTrinhWorker` là bước kế tiếp, và câu này ở đây để bước ấy có lý do.
  //
  // Đối chứng: một `kind` KHÔNG khai của cùng tổ chức phải còn nguyên `PENDING` — chứng minh thứ
  // đưa job tới `FAILED` là dòng khai, không phải một vị từ nhặt việc quá rộng (§S1.81 mục 1).
  // ===============================================================================================
  it("⑹ [khoản 168] job mang `kind` mồ côi của một tổ chức CHƯA TỪNG xếp việc qua api ⇒ tiến trình này đưa nó tới FAILED/NO_HANDLER và ghi MỘT dòng; `kind` không khai của cùng tổ chức không bị chạm", async () => {
    const KIND_MO_COI = "THU_MO_COI_168";
    const KIND_KHONG_KHAI = "THU_KHONG_KHAI_168";
    // Tổ chức MỚI: chưa ai xin link đăng nhập, chưa một lời `enqueueJob` nào đi qua `api` — tức
    // không nằm trong `toChucDaThay` của một tiến trình `api` nào.
    const { rows: tc } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      ["Cong ty F", "cong-ty-f-k168"],
    );
    const orgF = tc[0]!.id;
    const gieo = async (kind: string): Promise<string> => {
      const { rows } = await db.pool.query<{ id: string }>(
        "INSERT INTO outbox_jobs (org_id, kind) VALUES ($1::uuid, $2) RETURNING id",
        [orgF, kind],
      );
      return rows[0]!.id;
    };
    const idMoCoi = await gieo(KIND_MO_COI);
    const idKhongKhai = await gieo(KIND_KHONG_KHAI);
    const doc = async (id: string): Promise<{ status: string; attempts: number; last_failure_reason: string | null }> => {
      const { rows } = await db.pool.query<{ status: string; attempts: number; last_failure_reason: string | null }>(
        "SELECT status, attempts, last_failure_reason FROM outbox_jobs WHERE id = $1",
        [id],
      );
      return rows[0]!;
    };

    Object.assign(KIND_KHONG_NGUOI_NHAN, { [KIND_MO_COI]: "dòng THỬ của vế ⑹ — không phải một khai thật, gỡ trong finally" });
    const log: string[] = [];
    const cu = console.error;
    console.error = (...a: unknown[]) => {
      log.push(a.map(String).join(" "));
    };
    const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong({ TRUSTPROCURE_OUTBOX_POLL_MS: "200" })));
    try {
      await tt.batDau();
      const het = Date.now() + 10_000;
      while ((await doc(idMoCoi)).status !== "FAILED" && Date.now() < het) {
        await new Promise((x) => setTimeout(x, 100));
      }
      expect(await doc(idMoCoi), "job mồ côi phải tới trạng thái cuối ỒN ÀO — nếu còn PENDING thì không tiến trình nào khai sổ").toEqual({
        status: "FAILED",
        attempts: 1,
        last_failure_reason: "NO_HANDLER",
      });
      expect(log.filter((d) => d.startsWith(`[unseal-worker] outbox ${KIND_MO_COI}`)), JSON.stringify(log)).toEqual([
        `[unseal-worker] outbox ${KIND_MO_COI} NO_HANDLER (bo cuoc)`,
      ]);
      expect(await doc(idKhongKhai), "`kind` KHÔNG khai không được bị claim — vị từ lọc của S1.81 vẫn đứng").toEqual({
        status: "PENDING",
        attempts: 0,
        last_failure_reason: null,
      });
      expect(log.join("\n")).not.toContain(orgF);
    } finally {
      await tt.dung();
      console.error = cu;
      Reflect.deleteProperty(KIND_KHONG_NGUOI_NHAN, KIND_MO_COI);
    }
  }, 60_000);

  it("⑷ hai pool TRÙNG NHAU bị chặn ở lời gọi, không phải ở một docstring (khoản 121)", () => {
    expect(() =>
      createUnsealWorkerRunner(
        unsealPool,
        {
          unwrapper: { name: "x", openOrgKey: () => Promise.reject(new Error("khong goi toi")) },
          alertSink: { name: "x", deliver: () => Promise.resolve() },
          auditPool: unsealPool,
          onJobFailure: () => undefined,
        },
        { listOrganizations: () => [], onPollError: () => undefined },
      ),
    ).toThrow(/KHÁC NHAU/u);
  });

  // [ADR-083] Dòng tồn đọng outbox trên ĐƯỜNG SẼ CHẠY: pool `app_unseal` thật, danh sách tổ chức của
  // hàm `052`, `withTenant` cho từng tổ chức. Hai tổ chức mới mang job quá hạn của một `kind` không
  // runner nào nhận (nên chúng nằm yên đúng như khi không ai rút hàng đợi); dòng tổng phải thấy
  // tuổi của job GIÀ NHẤT (MAX qua tổ chức) và đếm job của CẢ HAI (TỔNG).
  it("[ADR-083] dòng `outbox ton dong` ghi tuổi MAX và số job TỔNG qua mọi tổ chức, đúng hình dạng metric filter đọc", async () => {
    const moi: string[] = [];
    for (const s of ["D", "E"]) {
      const { rows } = await db.pool.query<{ id: string }>(
        "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
        [`Cong ty ${s}`, `cong-ty-${s.toLowerCase()}-adr083`],
      );
      moi.push(rows[0]!.id);
    }
    const gieo = (org: string, lechGiay: number): Promise<unknown> =>
      db.pool.query(
        "INSERT INTO outbox_jobs (org_id, kind, run_after) VALUES ($1::uuid, 'THU_TON_DONG', now() + make_interval(secs => $2::float8))",
        [org, lechGiay],
      );
    await gieo(moi[0]!, -100);
    await gieo(moi[1]!, -5000);
    await gieo(moi[1]!, -10);
    // Chưa tới hạn ⇒ không đếm.
    await gieo(moi[1]!, 3600);
    const { rows: dem } = await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM organizations");
    const soToChuc = Number(dem[0]!.n);

    const log: string[] = [];
    const cu = console.error;
    console.error = (...a: unknown[]) => {
      log.push(a.map(String).join(" "));
    };
    const tt = taoTienTrinhUnsealWorker(docCauHinh(moiTruong({ TRUSTPROCURE_OUTBOX_TON_DONG_MS: "1000" })));
    try {
      await tt.batDau();
      const het = Date.now() + 10_000;
      let dong: string | undefined;
      while (dong === undefined && Date.now() < het) {
        await new Promise((x) => setTimeout(x, 100));
        dong = log.find((d) => d.startsWith("[unseal-worker] outbox ton dong:"));
      }
      expect(dong, JSON.stringify(log)).toBeDefined();
      const m = /^\[unseal-worker\] outbox ton dong: (\d+) giay, (\d+) job qua han, (\d+) to chuc$/u.exec(dong!);
      expect(m, dong).not.toBeNull();
      // Tuổi: job -5000 s của tổ chức E là già nhất cụm (job còn sót của các ca trên mới vài giây).
      expect(Number(m![1])).toBeGreaterThanOrEqual(5000);
      expect(Number(m![1])).toBeLessThan(5000 + 120);
      // Số job: ba job quá hạn của D và E, cộng những job PENDING mà ca ⑸ để lại cho `api`.
      expect(Number(m![2])).toBeGreaterThanOrEqual(3);
      expect(Number(m![3])).toBe(soToChuc);
      expect(log.filter((d) => d.includes("outbox ton dong khong do duoc")), JSON.stringify(log)).toEqual([]);
      await tt.dung();
      // Sau `dung()` không còn dòng tồn đọng nào: hẹn giờ đã huỷ (nhịp 1 s, chờ 1,5 s).
      const truoc = log.filter((d) => d.includes("outbox ton dong")).length;
      await new Promise((x) => setTimeout(x, 1500));
      expect(log.filter((d) => d.includes("outbox ton dong")).length).toBe(truoc);
    } finally {
      await tt.dung();
      console.error = cu;
    }
  }, 60_000);
});
