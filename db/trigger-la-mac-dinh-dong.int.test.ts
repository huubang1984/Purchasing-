// ===============================================================================================
// [INV-H19] [S1.9101 / khoản 259] MẶC ĐỊNH-ĐÓNG VỚI TRIGGER TRÊN MỌI BẢNG CỦA DỰ ÁN
//
// Mỗi mục ghim trigger của `hardening.always.sql` hỏi trigger theo TÊN và định nghĩa, rồi dựng lại khi
// thiếu — nó không hỏi bảng còn mang trigger NÀO KHÁC. Lượt soi của S1.198 đo: đổi tên
// `rfq_approvals_so_lan_nop` thành một tên xếp trước `rfq_approvals_kiem_nguoi_duyet` ⇒ `migrate()`
// xanh, mục ghim dựng lại trigger đúng tên và GIỮ bản đổi tên chạy trước chốt D2. Phép đo hành vi của
// kịch bản ấy (lời tự duyệt thiếu mốc lại vào sổ `CONTROL_DENIED`) nằm ở
// `packages/rfq/src/lan-nop-da-xem.int.test.ts`, nơi có sẵn dàn cảnh gói; tệp này đo MỤC hardening:
//
//   ⑴ `migrate()` trên cụm trống không gỡ trigger nào, và tập trigger trong cụm (ngoài bốn phần loại
//      trừ) TRÙNG KHÍT `TRIGGER_DUOC_PHEP` — một migration thêm trigger mà quên ghim đỏ ở đây, ở CI;
//   ⑵ trigger lạ trên bảng CÓ TÊN trong danh sách bị gỡ, ồn ào: bản đổi tên, bản CHÉP THÂN hàm sang tên
//      hàm khác, constraint trigger, tên được phép nhưng ở bảng khác;
//   ⑶ trigger lạ trên bảng KHÔNG có tên trong danh sách (bảng không mang trigger ghim nào, schema khác,
//      phân mảnh) chỉ bị PHÁN XÉT — chặn deploy, không tự gỡ (ADR-028 §2⑵: gỡ trigger không đơn điệu,
//      bị cấm trên tập suy ra; chủ dự án chốt ở S1.9101);
//   ⑷ bốn phần loại trừ đứng đúng chỗ: bảng sổ ([CR1] gỡ, không phải mục này), `chan_sua_xoa()` ở bảng
//      khác ([CR4] chặn deploy), bản sao trên phân mảnh (không bị hỏi riêng);
//   ⑸ gỡ không được thì lượt phán xét chặn deploy, nêu tên trigger;
//   ⑹ lượt sửa ĐẦU đứng yên: một migration đang chờ còn cần trigger lạ (khuôn 059: `DROP TRIGGER` không
//      `IF EXISTS`) vẫn chạy được;
//   ⑺ một `app.hardening_sau_vong = 'khong'` đặt sẵn ở mức vai không tắt được lần gỡ (migrate() đặt GUC ở MỌI
//      lượt), và đặt ngay trong phiên cũng không tắt được lượt phán xét.
// ===============================================================================================

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const HARDENING = readFileSync(join(MIGRATIONS_DIR, "hardening.always.sql"), "utf8").replace(/\r\n/gu, "\n");

const TEN_MUC = "không trigger lạ trên bảng của dự án (mặc định-đóng, khoản 259)";
const DAU_GO = "đã GỠ trigger lạ";
const CHI_PHAN_XET =
  "trên bảng KHÔNG có trong TRIGGER_DUOC_PHEP — hardening CHỈ PHÁN XÉT (ADR-028 §2⑵): " +
  "gỡ nó bằng DROP TRIGGER hay một migration mới, hoặc ghim nó và khai bảng vào TRIGGER_DUOC_PHEP";

/** `TRIGGER_DUOC_PHEP` đọc thẳng từ hardening: tập `lược đồ.bảng|tên`. */
function docDuocPhep(): ReadonlySet<string> {
  const khoi = /\n {2}TRIGGER_DUOC_PHEP constant text :=\n {4}\$q\$\(VALUES\n([\s\S]*?)\n {5}\) AS tg\(bang, ten\)\$q\$;/u.exec(HARDENING);
  if (khoi === null) throw new Error("không đọc được khối TRIGGER_DUOC_PHEP — khuôn đã đổi, phép đo đang MÙ");
  const ra = new Set<string>();
  for (const m of khoi[1]!.matchAll(/\('([a-z_0-9.]+)', ARRAY\[([^\]]*)\]\)/gu)) {
    for (const t of m[2]!.matchAll(/'([A-Za-z_0-9]+)'/gu)) ra.add(`${m[1]!}|${t[1]!}`);
  }
  return ra;
}

let db: TestDatabase;
let canhBaoLanDau: readonly string[] = [];

interface KetQua {
  readonly kq: string;
  readonly canhBao: readonly string[];
}

async function migrateLai(dir: string = MIGRATIONS_DIR, cum: TestDatabase = db): Promise<KetQua> {
  const canhBao: string[] = [];
  try {
    await migrate(cum.pool, dir, { onThongBao: (tb) => canhBao.push(tb.message) });
    return { kq: "OK", canhBao };
  } catch (e) {
    return { kq: `NÉM: ${(e as Error).message}`, canhBao };
  }
}

/** Trigger không nội bộ, không phải bản sao phân mảnh, của một bảng — theo tên. */
async function triggerCua(bang: string, cum: TestDatabase = db): Promise<string[]> {
  const { rows } = await cum.pool.query<{ ten: string }>(
    "SELECT t.tgname AS ten FROM pg_trigger t WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal ORDER BY t.tgname",
    [bang],
  );
  return rows.map((r) => r.ten);
}

/** Tập trigger mà mục khoản 259 hỏi: ngoài nội bộ, bản sao phân mảnh, bảng sổ và `chan_sua_xoa()`. */
async function chuTheTrongCum(): Promise<ReadonlySet<string>> {
  const { rows } = await db.pool.query<{ k: string }>(
    "SELECT n.nspname || '.' || c.relname || '|' || t.tgname AS k " +
      "  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace " +
      " WHERE NOT t.tgisinternal AND t.tgparentid = 0 " +
      "   AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%' " +
      "   AND NOT (n.nspname = 'public' AND c.relname IN ('audit_events', 'audit_chain_anchors')) " +
      "   AND t.tgfoid <> 'public.chan_sua_xoa()'::regprocedure",
  );
  return new Set(rows.map((r) => r.k));
}

/** Huỷ mọi kết nối nhàn rỗi của pool: phiên kế tiếp mở mới và nhận giá trị GUC đặt sẵn ở mức vai. */
async function boPhienCu(): Promise<void> {
  for (let i = 0; i < 20; i++) (await db.pool.connect()).release(true);
}

const goCua = (canhBao: readonly string[], ten: string): string[] =>
  canhBao.filter((c) => c.includes(DAU_GO) && c.includes(` ${ten} `));

beforeAll(async () => {
  db = await startPostgres();
  const canhBao: string[] = [];
  await migrate(db.pool, MIGRATIONS_DIR, { onThongBao: (tb) => canhBao.push(tb.message) });
  canhBaoLanDau = canhBao;
  await db.pool.query(
    "CREATE FUNCTION public.zz_khong_lam_gi() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$",
  );
}, 300000);

afterAll(async () => {
  await db?.stop();
});

describe("[INV-H19] [S1.9101 / khoản 259] mặc định-đóng với trigger trên mọi bảng của dự án", { timeout: 300000 }, () => {
  it("[INV-H19] ⑴ migrate() trên cụm trống không gỡ trigger nào, và tập trigger trong cụm TRÙNG KHÍT TRIGGER_DUOC_PHEP — migration quên ghim trigger đỏ ở đây", async () => {
    const duocPhep = docDuocPhep();
    expect(duocPhep.size, "chống mù: danh sách phải đọc được, và không nhỏ hơn tập đo ở S1.9101").toBeGreaterThanOrEqual(154);
    expect(canhBaoLanDau.filter((c) => c.includes(DAU_GO)), "lần migrate đầu không được gỡ trigger nào").toEqual([]);
    const trongCum = await chuTheTrongCum();
    expect([...trongCum].filter((k) => !duocPhep.has(k)).sort(), "trigger trong cụm mà không có trong danh sách").toEqual([]);
    expect([...duocPhep].filter((k) => !trongCum.has(k)).sort(), "dòng danh sách không có trigger nào trong cụm").toEqual([]);
  });

  it("[INV-H19] ⑵ khoản 259: bản ĐỔI TÊN của `rfq_approvals_so_lan_nop` xếp trước chốt D2 bị gỡ, trigger đúng tên được dựng lại — thứ tự trên bảng về lại bản chuẩn", async () => {
    const chuan = await triggerCua("public.rfq_approvals");
    expect(chuan).toContain("rfq_approvals_so_lan_nop");
    await db.pool.query("ALTER TRIGGER rfq_approvals_so_lan_nop ON public.rfq_approvals RENAME TO rfq_approvals_a_so_lan_nop");
    expect(await triggerCua("public.rfq_approvals"), "dàn cảnh: bản đổi tên xếp trước chốt D2").toEqual(
      [...chuan.filter((t) => t !== "rfq_approvals_so_lan_nop"), "rfq_approvals_a_so_lan_nop"].sort(),
    );
    const { kq, canhBao } = await migrateLai();
    expect(kq).toBe("OK");
    expect(await triggerCua("public.rfq_approvals")).toEqual(chuan);
    expect(goCua(canhBao, "rfq_approvals_a_so_lan_nop"), "gỡ được thì phải ỒN ÀO").toHaveLength(1);
  });

  it("[INV-H19] ⑵ bản CHÉP THÂN hàm so lần nộp sang một tên hàm khác, gắn dưới tên xếp trước chốt D2, bị gỡ — phép kiểm 'đúng một trigger trỏ vào hàm' không thấy nó", async () => {
    const { rows } = await db.pool.query<{ than: string }>(
      "SELECT prosrc AS than FROM pg_proc WHERE oid = 'public.rfq_chot_lan_nop_da_xem()'::regprocedure",
    );
    await db.pool.query(
      `CREATE FUNCTION public.zz_ban_sao_so_lan_nop() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $ham$${rows[0]!.than}$ham$`,
    );
    try {
      await db.pool.query(
        "CREATE TRIGGER rfq_approvals_a_ban_sao BEFORE INSERT ON public.rfq_approvals FOR EACH ROW EXECUTE FUNCTION public.zz_ban_sao_so_lan_nop()",
      );
      const { kq, canhBao } = await migrateLai();
      expect(kq).toBe("OK");
      expect(await triggerCua("public.rfq_approvals")).not.toContain("rfq_approvals_a_ban_sao");
      expect(goCua(canhBao, "rfq_approvals_a_ban_sao")).toHaveLength(1);
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS rfq_approvals_a_ban_sao ON public.rfq_approvals");
      await db.pool.query("DROP FUNCTION public.zz_ban_sao_so_lan_nop()");
    }
  });

  it("[INV-H19] ⑵ trên bảng CÓ TÊN: constraint trigger lạ, và một tên ĐƯỢC PHÉP nhưng ở bảng khác, đều bị gỡ", async () => {
    try {
      await db.pool.query(
        "CREATE CONSTRAINT TRIGGER zz_items_rang_buoc AFTER INSERT ON public.rfq_items DEFERRABLE INITIALLY DEFERRED " +
          "FOR EACH ROW EXECUTE FUNCTION public.zz_khong_lam_gi()",
      );
      await db.pool.query(
        "CREATE TRIGGER rfq_approvals_so_lan_nop BEFORE INSERT ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION public.zz_khong_lam_gi()",
      );
      const { kq, canhBao } = await migrateLai();
      expect(kq).toBe("OK");
      expect(await triggerCua("public.rfq_items")).not.toContain("zz_items_rang_buoc");
      expect(await triggerCua("public.rfq_items")).not.toContain("rfq_approvals_so_lan_nop");
      expect(await triggerCua("public.rfq_approvals"), "trigger đúng tên ở đúng bảng thì ở lại").toContain("rfq_approvals_so_lan_nop");
      for (const ten of ["zz_items_rang_buoc", "rfq_approvals_so_lan_nop"]) {
        expect(goCua(canhBao, ten), ten).toHaveLength(1);
      }
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS zz_items_rang_buoc ON public.rfq_items");
      await db.pool.query("DROP TRIGGER IF EXISTS rfq_approvals_so_lan_nop ON public.rfq_items");
    }
  });

  it("[INV-H19] ⑶ trên bảng KHÔNG có tên trong danh sách (bảng không mang trigger ghim nào, schema khác): chỉ PHÁN XÉT — chặn deploy, nêu từng trigger, không tự gỡ (ADR-028 §2⑵)", async () => {
    await db.pool.query("CREATE SCHEMA zz_kho");
    try {
      await db.pool.query("CREATE TABLE zz_kho.nhat_ky (id integer)");
      await db.pool.query(
        "CREATE TRIGGER zz_org_sau_chen AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.zz_khong_lam_gi()",
      );
      await db.pool.query(
        "CREATE TRIGGER zz_kho_truoc_chen BEFORE INSERT ON zz_kho.nhat_ky FOR EACH ROW EXECUTE FUNCTION public.zz_khong_lam_gi()",
      );
      const { kq, canhBao } = await migrateLai();
      expect(kq).toMatch(/^NÉM: Hardening hardening\.always\.sql \(phan_xet\) thất bại:/u);
      expect(kq).toContain(
        `- "${TEN_MUC}": trạng thái hiện tại SAI (organizations.zz_org_sau_chen: TRIGGER LẠ ${CHI_PHAN_XET} — CREATE TRIGGER zz_org_sau_chen AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION zz_khong_lam_gi(); ` +
          `zz_kho.nhat_ky.zz_kho_truoc_chen: TRIGGER LẠ ${CHI_PHAN_XET} — CREATE TRIGGER zz_kho_truoc_chen BEFORE INSERT ON zz_kho.nhat_ky FOR EACH ROW EXECUTE FUNCTION zz_khong_lam_gi()).`,
      );
      expect(await triggerCua("public.organizations"), "không tự gỡ").toEqual(["zz_org_sau_chen"]);
      expect(await triggerCua("zz_kho.nhat_ky"), "không tự gỡ").toEqual(["zz_kho_truoc_chen"]);
      expect(canhBao.filter((c) => c.includes(DAU_GO))).toEqual([]);
    } finally {
      await db.pool.query("DROP SCHEMA zz_kho CASCADE");
      await db.pool.query("DROP TRIGGER IF EXISTS zz_org_sau_chen ON public.organizations");
    }
    expect((await migrateLai()).kq, "người vận hành gỡ tay ⇒ deploy đi qua").toBe("OK");
  });

  it("[INV-H19] ⑷ loại trừ (a): trigger lạ trên bảng sổ do [CR1] gỡ, mục khoản 259 không đụng tới", async () => {
    await db.pool.query(
      "CREATE TRIGGER zz_so_sau_chen AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.zz_khong_lam_gi()",
    );
    const { kq, canhBao } = await migrateLai();
    expect(kq).toBe("OK");
    expect(await triggerCua("public.audit_events")).not.toContain("zz_so_sau_chen");
    const go = goCua(canhBao, "zz_so_sau_chen");
    expect(go, "đúng một lời gỡ, của [CR1]").toHaveLength(1);
    expect(go[0]).toContain("chỉ những trigger trong can_co");
  });

  it("[INV-H19] ⑷ loại trừ (b): trigger gọi `chan_sua_xoa()` ở bảng ngoài bảng sổ ở lại — [CR4] chặn deploy, không tự chữa", async () => {
    await db.pool.query(
      "CREATE TRIGGER zz_chan BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.chan_sua_xoa()",
    );
    try {
      const { kq, canhBao } = await migrateLai();
      expect(kq).toMatch(/^NÉM: Hardening hardening\.always\.sql \(phan_xet\) thất bại:/u);
      expect(kq).toContain("KHÔNG có trong BANG_CHI_GHI_THEM");
      expect(kq).not.toContain(TEN_MUC);
      expect(await triggerCua("public.suppliers")).toContain("zz_chan");
      expect(goCua(canhBao, "zz_chan")).toEqual([]);
    } finally {
      await db.pool.query("DROP TRIGGER IF EXISTS zz_chan ON public.suppliers");
    }
    expect((await migrateLai()).kq).toBe("OK");
  });

  it("[INV-H19] ⑷ loại trừ (c): trigger lạ trên bảng phân mảnh CHA bị phán xét MỘT lần — bản sao trên lá mang tên cha, không bị hỏi riêng", async () => {
    await db.pool.query("CREATE SCHEMA zz_phan");
    try {
      await db.pool.query("CREATE TABLE zz_phan.cha (id integer, k integer) PARTITION BY LIST (k)");
      await db.pool.query("CREATE TABLE zz_phan.la PARTITION OF zz_phan.cha FOR VALUES IN (1)");
      await db.pool.query(
        "CREATE TRIGGER zz_phan_sau_chen AFTER INSERT ON zz_phan.cha FOR EACH ROW EXECUTE FUNCTION public.zz_khong_lam_gi()",
      );
      expect(await triggerCua("zz_phan.la"), "dàn cảnh: lá mang bản sao").toEqual(["zz_phan_sau_chen"]);
      const { kq } = await migrateLai();
      expect(kq).toContain("zz_phan.cha.zz_phan_sau_chen: TRIGGER LẠ");
      expect(kq, "bản sao trên lá không thành một dòng riêng").not.toContain("zz_phan.la.zz_phan_sau_chen");
    } finally {
      await db.pool.query("DROP SCHEMA zz_phan CASCADE");
    }
    expect((await migrateLai()).kq).toBe("OK");
  });

  it("[INV-H19] ⑸ gỡ KHÔNG được (bảng có tên) thì lượt phán xét chặn deploy, nêu bảng, tên và định nghĩa của trigger lạ", async () => {
    await db.pool.query(
      "CREATE TRIGGER zz_khong_go_duoc AFTER INSERT ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION public.zz_khong_lam_gi()",
    );
    await db.pool.query(
      "CREATE FUNCTION public.zz_chan_drop_trigger() RETURNS event_trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'zz: DROP TRIGGER bi chan'; END $f$",
    );
    await db.pool.query(
      "CREATE EVENT TRIGGER zz_chan_drop_trigger ON ddl_command_start WHEN TAG IN ('DROP TRIGGER') EXECUTE FUNCTION public.zz_chan_drop_trigger()",
    );
    try {
      const { kq, canhBao } = await migrateLai();
      expect(kq).toMatch(/^NÉM: Hardening hardening\.always\.sql \(phan_xet\) thất bại:/u);
      expect(kq).toContain(
        `- "${TEN_MUC}": trạng thái hiện tại SAI (rfq_items.zz_khong_go_duoc: TRIGGER LẠ — CREATE TRIGGER zz_khong_go_duoc AFTER INSERT ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION zz_khong_lam_gi()).`,
      );
      expect(canhBao.filter((c) => c.includes("không gỡ được trigger lạ zz_khong_go_duoc"))).toHaveLength(1);
    } finally {
      await db.pool.query("DROP EVENT TRIGGER zz_chan_drop_trigger");
      await db.pool.query("DROP FUNCTION public.zz_chan_drop_trigger()");
      await db.pool.query("DROP TRIGGER IF EXISTS zz_khong_go_duoc ON public.rfq_items");
    }
    expect((await migrateLai()).kq).toBe("OK");
  });

  it("[INV-H19] ⑹ lượt sửa ĐẦU đứng yên: migration đang chờ gỡ một trigger lạ bằng `DROP TRIGGER` không `IF EXISTS` (khuôn 059) vẫn chạy được", async () => {
    const cum = await startPostgres();
    const tam = mkdtempSync(join(tmpdir(), "tp-khoan-259-"));
    try {
      await migrate(cum.pool, MIGRATIONS_DIR);
      await cum.pool.query(
        "CREATE FUNCTION public.zz_khong_lam_gi() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$",
      );
      await cum.pool.query(
        "CREATE TRIGGER zz_trigger_cu AFTER INSERT ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION public.zz_khong_lam_gi()",
      );
      cpSync(MIGRATIONS_DIR, tam, { recursive: true });
      writeFileSync(join(tam, "999_go_trigger_cu.sql"), "DROP TRIGGER zz_trigger_cu ON public.rfq_items;\n");
      const { kq, canhBao } = await migrateLai(tam, cum);
      expect(kq, "vòng đánh số tới được tệp đang chờ").toBe("OK");
      expect(await triggerCua("public.rfq_items", cum)).not.toContain("zz_trigger_cu");
      expect(goCua(canhBao, "zz_trigger_cu"), "không lượt nào của hardening gỡ nó — tệp đang chờ gỡ").toEqual([]);
      const { rows } = await cum.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.schema_migrations WHERE version = '999_go_trigger_cu.sql'",
      );
      expect(rows[0]!.n).toBe(1);
    } finally {
      rmSync(tam, { recursive: true, force: true });
      await cum.stop();
    }
  });

  it("[INV-H19] ⑺ `app.hardening_sau_vong = 'khong'` đặt sẵn ở mức VAI không tắt được lần gỡ — `migrate()` đặt GUC tường minh ở mọi lượt", async () => {
    await db.pool.query(
      "CREATE TRIGGER zz_gia_guc AFTER INSERT ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION public.zz_khong_lam_gi()",
    );
    await db.pool.query("ALTER ROLE CURRENT_USER SET app.hardening_sau_vong = 'khong'");
    try {
      await boPhienCu();
      const { rows } = await db.pool.query<{ g: string }>("SELECT current_setting('app.hardening_sau_vong', true) AS g");
      expect(rows[0]?.g, "dàn cảnh: phiên mới mang giá trị đặt sẵn").toBe("khong");
      const { kq, canhBao } = await migrateLai();
      expect(kq).toBe("OK");
      expect(await triggerCua("public.rfq_items")).not.toContain("zz_gia_guc");
      expect(goCua(canhBao, "zz_gia_guc")).toHaveLength(1);
    } finally {
      await db.pool.query("ALTER ROLE CURRENT_USER RESET app.hardening_sau_vong");
      await boPhienCu();
      await db.pool.query("DROP TRIGGER IF EXISTS zz_gia_guc ON public.rfq_items");
    }
  });

  it("[INV-H19] ⑺ lượt PHÁN XÉT không đọc `app.hardening_sau_vong`: đặt `'khong'` ngay trong phiên rồi chạy hardening ở chế độ phan_xet vẫn chặn, nêu trigger lạ", async () => {
    await db.pool.query(
      "CREATE TRIGGER zz_phan_xet_guc AFTER INSERT ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION public.zz_khong_lam_gi()",
    );
    const client = await db.pool.connect();
    let loi: string | null = null;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.hardening_che_do', 'phan_xet', true), set_config('app.hardening_sau_vong', 'khong', true)");
      await client.query(HARDENING);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      loi = (e as Error).message;
    } finally {
      client.release();
      await db.pool.query("DROP TRIGGER IF EXISTS zz_phan_xet_guc ON public.rfq_items");
    }
    expect(loi).toContain(`- "${TEN_MUC}": trạng thái hiện tại SAI (rfq_items.zz_phan_xet_guc: TRIGGER LẠ — `);
  });
});
