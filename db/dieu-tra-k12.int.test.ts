// ==============================================================================================
// [S1.9101 / S3.9b / K12] ĐIỀU TRA MỌI LỜI TỪ CHỐI TRONG THÂN HÀM — MỖI CHỖ ĐÚNG MỘT LỚP
//
// K12 (spec S3 §5, §5.1; ADR-084 ⑷ ⑸; ADR-060): lần từ chối nói NGƯỜI DÙNG cố đi tắt một chốt thì để lại một hàng sổ; lần từ chối
// nói dữ liệu hay cấu hình vừa đổi dưới chân họ thì không. Đo theo từng hạng mục từ S3.1 — đây là phép điều tra TRÊN TOÀN BỘ: mọi câu
// `RAISE` mức EXCEPTION trong thân CUỐI của mọi hàm (`pg_proc` sau `migrate()`), không chỉ của S3 — chủ dự án chốt 2026-10-11, để một
// `RAISE` mới ở BẤT KỲ đâu phải khai lớp của nó (ADR-9201).
//
// Sáu lớp, mỗi chỗ đúng một (bảng `db/phan-loai-tu-choi.ts`):
//   THEO_TEN     — tên ràng buộc có trong `CHOT_THEO_RANG_BUOC`, errcode `check_violation` (`maChotTuLoi` chỉ nhận 23514), khoá (tên, hàm,
//                  số câu) ở `BANG_THEO_TEN` kèm tệp gói bắt tên. Vào sổ hay không là cột `vaoSo` của `CHOT_VAO_SO`. Tên động
//                  (`CONSTRAINT = lower(<biến>)`) đi lớp này khi dòng của nó nói vậy và có tệp bắt tên.
//   HOI_TRUOC    — tầng ứng dụng hỏi trước câu ghi và từ chối ở đó; câu `RAISE` chỉ là lớp chặn cuối cho một đường ghi thứ hai.
//   SO_RIENG     — tầng gói bắt CHÍNH lỗi theo tên và ghi hàng sổ của riêng nó (`BID_STATE_DENIED`, `BID_DEADLINE_DENIED`,
//                  `UNSEAL_NOT_FOUND_DENIED`).
//   KHONG_VAO_SO — người dùng chạm được, lời từ chối nói dữ liệu / cấu hình (ADR-060), cố ý không vào sổ.
//   BAT_BIEN     — bất biến cấu trúc: không đường hợp lệ nào của người dùng tới được, trừ câu SQL thô hay lỗi lập trình.
//   KHOANG_TRONG — người dùng đi tắt một chốt mà không để hàng sổ — khoảng trống ĐÃ GỌI TÊN, trỏ khoản nợ.
// Phép đối chiếu HAI CHIỀU: mọi chỗ sống có dòng; mọi dòng còn chỗ sống và khớp ĐÚNG số câu.
//
// VẾ `PERMISSION_DENIED` không đo ở đây: cổng quyền nằm ở bộ điều phối và ở hàm gói (`requirePermission`), đo bằng
// `tests/architecture/cong-quyen-route.test.ts` — một câu `RAISE` về quyền trong trigger là lớp chặn cuối (HOI_TRUOC), không phải cổng.
// GIỚI HẠN, nói ra: lớp của một chỗ là lời khai có lý do, đọc từ mã lúc viết — phép đo này giữ cho lời khai không trôi khỏi thân hàm,
// không chứng minh lời khai đúng; lớp theo NHÓM (hàm, errcode) với câu không tên. Lời từ chối do trigger huỷ giao dịch nên không lối nào
// ghi được trong CHÍNH giao dịch ấy — cùng giới hạn J6; lớp THEO_TEN ghi ở giao dịch độc lập.
// ==============================================================================================
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { CHOT_THEO_RANG_BUOC, CHOT_VAO_SO } from "@trustprocure/identity";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boChuThich, docRaise, type CauRaise } from "./doc-raise.js";
import { BANG_DONG, BANG_KHONG_TEN, BANG_TEN, BANG_THEO_TEN, TU_VUNG_NGOAI } from "./phan-loai-tu-choi.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const GOC_KHO = new URL("../", import.meta.url);

let db: TestDatabase;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

interface Cho extends CauRaise {
  readonly ham: string;
}

interface HamThan {
  readonly ham: string;
  readonly than: string;
}

const CAU_HAM =
  "SELECT p.proname AS ham, p.prosrc AS than FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
  "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%' " +
  "AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql') ORDER BY 1";

async function docCho(q: pg.Pool | pg.PoolClient = db.pool): Promise<{ readonly cho: Cho[]; readonly ham: HamThan[] }> {
  const { rows } = await q.query<HamThan>(CAU_HAM);
  const cho: Cho[] = [];
  for (const r of rows) for (const c of docRaise(r.than)) if (c.muc === "EXCEPTION") cho.push({ ...c, ham: r.ham });
  return { cho, ham: rows };
}

/** Mã một hàm vị từ trả về: mọi `RETURN '<MÃ>'` viết hoa trong thân ĐÃ BỎ chú thích. */
function maTraVe(than: string): string[] {
  return [...boChuThich(than).matchAll(/RETURN\s+'([A-Z][A-Z0-9_]+)'/gu)].map((m) => m[1] ?? "");
}

/** `RETURN` của một hàm vị từ mà không phải chuỗi hằng viết hoa, không phải NULL — mã đi ra khỏi tầm đọc của phép đo. */
function traVeKhongDocDuoc(than: string): string[] {
  return [...boChuThich(than).matchAll(/\bRETURN\b\s*([^;]*);/giu)]
    .map((m) => (m[1] ?? "").trim())
    .filter((v) => !/^'[A-Z][A-Z0-9_]+'$/u.test(v) && !/^NULL$/iu.test(v) && v !== "");
}

/** Biến của một tên động: `lower(ly_do)` ⇒ `ly_do`. */
function bienCua(bieuThuc: string): string | null {
  return /^lower\(\s*([a-z_][a-z0-9_]*)\s*\)$/u.exec(bieuThuc)?.[1] ?? null;
}

const LA_CHECK = (ec: string): boolean => ec === "check_violation" || ec === "23514";

/** Phân loại một chỗ — trả lớp hay câu báo vì sao chưa phân loại được. */
function phanLoai(c: Cho): { readonly lop: string } | { readonly loi: string } {
  if (c.rangBuoc !== null) {
    if (Object.hasOwn(CHOT_THEO_RANG_BUOC, c.rangBuoc)) {
      // [lượt soi §S1.9101 T1] `maChotTuLoi` chỉ nhận 23514: tên của bảng chốt dưới errcode khác không bao giờ vào sổ.
      if (!LA_CHECK(c.errcode)) return { loi: `tên '${c.rangBuoc}' của CHOT_THEO_RANG_BUOC dưới errcode ${c.errcode} (${c.ham}) — maChotTuLoi chỉ nhận 23514` };
      const d = BANG_THEO_TEN.find((x) => x.ten === c.rangBuoc && x.ham === c.ham);
      return d === undefined ? { loi: `CHƯA PHÂN LOẠI — tên '${c.rangBuoc}' của bảng chốt ở hàm mới ${c.ham}: thêm dòng BANG_THEO_TEN kèm tệp bắt tên` } : { lop: "THEO_TEN" };
    }
    const d = BANG_TEN.find((x) => x.ten === c.rangBuoc && x.ham === c.ham);
    return d === undefined ? { loi: `CHƯA PHÂN LOẠI — tên '${c.rangBuoc}' (${c.ham}): ${c.cau}` } : { lop: d.lop };
  }
  if (c.rangBuocDong !== null) {
    const d = BANG_DONG.find((x) => x.ham === c.ham && x.bieuThuc === c.rangBuocDong);
    if (d === undefined) return { loi: `CHƯA PHÂN LOẠI — tên động '${c.rangBuocDong}' (${c.ham}): ${c.cau}` };
    if (d.lop === "THEO_TEN" && !LA_CHECK(c.errcode)) return { loi: `tên động THEO_TEN dưới errcode ${c.errcode} (${c.ham})` };
    return { lop: d.lop };
  }
  const d = BANG_KHONG_TEN.find((x) => x.ham === c.ham && x.errcode === c.errcode);
  return d === undefined ? { loi: `CHƯA PHÂN LOẠI — RAISE không tên (${c.ham}, ${c.errcode}): ${c.cau}` } : { lop: d.lop };
}

describe("[S1.9101 / S3.9b / K12] bộ đọc câu RAISE — văn bản mẫu đi qua từng nhánh", () => {
  it("mức, ERRCODE, tên tĩnh / động, điều kiện, SQLSTATE, ném lại; chuỗi chứa ; và '', chú thích chứa RAISE, $tag$, định danh nháy kép, chuỗi nối", () => {
    const mau = [
      "BEGIN",
      "  -- RAISE EXCEPTION 'trong chú thích' ; một dấu ' lẻ ở đây",
      "  /* RAISE EXCEPTION 'khối /* lồng */ vẫn chú thích' */",
      "  RAISE EXCEPTION 'co ; trong chuoi va ''nhay''' USING ERRCODE = 'check_violation', CONSTRAINT = 'ten_tinh';",
      "  RAISE EXCEPTION 'x %', a\n    USING ERRCODE = 'check_violation',\n          CONSTRAINT = lower(ly_do);",
      "  RAISE 'muc mac dinh';",
      "  RAISE NOTICE 'khong phai tu choi';",
      "  RAISE check_violation USING MESSAGE = 'dieu kien';",
      "  RAISE EXCEPTION SQLSTATE '22012';",
      "  RAISE EXCEPTION USING MESSAGE = 'chi USING', ERRCODE = 'foreign_key_violation';",
      "  PERFORM format($f$RAISE EXCEPTION 'trong dollar'$f$);",
      "  x := E'RAISE \\' van chuoi';",
      "  SELECT \"it's\" INTO y; RAISE EXCEPTION 'sau dinh danh' USING CONSTRAINT = 'k1_' || x;",
      "  /* 🙂 */ RAISE EXCEPTION 'sau ky tu ngoai mat phang' USING ERRCODE = 'check_violation', CONSTRAINT = 'sau_emoji';",
      "  RAISE;",
      "END",
    ].join("\n");
    const r = docRaise(mau).map((c) => [c.muc, c.errcode, c.rangBuoc, c.rangBuocDong]);
    expect(r).toEqual([
      ["EXCEPTION", "check_violation", "ten_tinh", null],
      ["EXCEPTION", "check_violation", null, "lower(ly_do)"],
      ["EXCEPTION", "raise_exception", null, null],
      ["NOTICE", "raise_exception", null, null],
      ["EXCEPTION", "check_violation", null, null],
      ["EXCEPTION", "22012", null, null],
      ["EXCEPTION", "foreign_key_violation", null, null],
      ["EXCEPTION", "raise_exception", null, "'k1_' || x"],
      ["EXCEPTION", "check_violation", "sau_emoji", null],
      ["NEM_LAI", "", null, null],
    ]);
    expect(boChuThich("x := 1; -- RETURN 'CU'\nRETURN 'MOI';")).not.toMatch(/'CU'/u);
  });
});

describe("[S1.9101 / S3.9b / K12] điều tra mọi lời từ chối trong thân hàm", () => {
  it("không hàm nạp chồng nào mang RAISE — bảng khoá theo TÊN hàm; một hàm nạp chồng làm phép đo khoá theo chữ ký", async () => {
    const { rows } = await db.pool.query<{ ham: string; n: string }>(
      "SELECT p.proname AS ham, count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
        "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%' AND p.prosrc ~* '\\mRAISE\\M' " +
        "GROUP BY 1 HAVING count(*) > 1",
    );
    expect(rows).toEqual([]);
  });

  it("[lượt soi §S1.9101 THẤP] ngoài tầm bộ đọc: không hàm nào ở ngôn ngữ thủ tục khác plpgsql, không câu ASSERT trong thân plpgsql", async () => {
    const { rows } = await db.pool.query<{ ham: string; ngon: string }>(
      "SELECT p.proname AS ham, l.lanname AS ngon FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang " +
        "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%' AND l.lanname NOT IN ('plpgsql', 'sql', 'c', 'internal')",
    );
    expect(rows).toEqual([]);
    const { ham } = await docCho();
    expect(ham.filter((h) => /\bASSERT\b/iu.test(boChuThich(h.than).replace(/'(?:[^']|'')*'/gu, "''"))).map((h) => h.ham)).toEqual([]);
  });

  it("khoá của mọi bảng là duy nhất", () => {
    const trung = (ds: string[]): string[] => ds.filter((k, i) => ds.indexOf(k) !== i);
    expect(trung(BANG_TEN.map((d) => `${d.ten}|${d.ham}`))).toEqual([]);
    expect(trung(BANG_THEO_TEN.map((d) => `${d.ten}|${d.ham}`))).toEqual([]);
    expect(trung(BANG_DONG.map((d) => `${d.ham}|${d.bieuThuc}`))).toEqual([]);
    expect(trung(BANG_KHONG_TEN.map((d) => `${d.ham}|${d.errcode}`))).toEqual([]);
    expect(trung(TU_VUNG_NGOAI.map((d) => `${d.viTu}|${d.ma}`))).toEqual([]);
  });

  it("mỗi chỗ RAISE mức EXCEPTION thuộc ĐÚNG MỘT lớp — không chỗ nào chưa phân loại", async () => {
    const { cho } = await docCho();
    expect(cho.length, "bộ đọc không thấy chỗ nào — đang mù").toBeGreaterThan(300);
    const loi = cho.map(phanLoai).flatMap((x) => ("loi" in x ? [x.loi] : []));
    expect(loi).toEqual([]);
  });

  it("hai chiều: mọi dòng của bảng còn chỗ sống và khớp ĐÚNG số câu; mọi tên của CHOT_THEO_RANG_BUOC còn chỗ sống", async () => {
    const { cho, ham } = await docCho();
    const thua: string[] = [];
    const dem = (f: (c: Cho) => boolean): number => cho.filter(f).length;
    for (const d of BANG_TEN) {
      const n = dem((c) => c.rangBuoc === d.ten && c.ham === d.ham);
      if (n !== d.so) thua.push(`tên '${d.ten}' (${d.ham}): bảng khai ${String(d.so)} câu, thân có ${String(n)}`);
      if (Object.hasOwn(CHOT_THEO_RANG_BUOC, d.ten)) thua.push(`tên '${d.ten}' đã ở CHOT_THEO_RANG_BUOC — dòng thuộc BANG_THEO_TEN`);
    }
    for (const d of BANG_THEO_TEN) {
      const n = dem((c) => c.rangBuoc === d.ten && c.ham === d.ham);
      if (n !== d.so) thua.push(`THEO_TEN '${d.ten}' (${d.ham}): bảng khai ${String(d.so)} câu, thân có ${String(n)}`);
      if (!Object.hasOwn(CHOT_THEO_RANG_BUOC, d.ten)) thua.push(`THEO_TEN '${d.ten}' không có trong CHOT_THEO_RANG_BUOC`);
    }
    for (const d of BANG_DONG) {
      const n = dem((c) => c.ham === d.ham && c.rangBuocDong === d.bieuThuc);
      if (n !== d.so) thua.push(`tên động ${d.ham}: bảng khai ${String(d.so)} câu, thân có ${String(n)}`);
    }
    for (const d of BANG_KHONG_TEN) {
      const n = dem((c) => c.ham === d.ham && c.errcode === d.errcode && c.rangBuoc === null && c.rangBuocDong === null);
      if (n !== d.so) thua.push(`(${d.ham}, ${d.errcode}): bảng khai ${String(d.so)} câu, thân có ${String(n)}`);
    }
    // Tên của bảng chốt: hoặc là tên tĩnh sống, hoặc là mã (viết thường) một hàm vị từ sau tên động trả về.
    const tenDong = new Set(BANG_DONG.flatMap((d) => d.viTu.flatMap((v) => maTraVe(ham.find((h) => h.ham === v)?.than ?? "").map((m) => m.toLowerCase()))));
    for (const ten of Object.keys(CHOT_THEO_RANG_BUOC)) {
      if (!cho.some((c) => c.rangBuoc === ten) && !tenDong.has(ten)) thua.push(`CHOT_THEO_RANG_BUOC '${ten}': không chỗ nào ném tên ấy`);
    }
    expect(thua).toEqual([]);
  });

  it("THEO_TEN có tệp bắt tên: tệp tồn tại và gọi maChotTuLoi; dòng tên động THEO_TEN mang tệp, dòng khác lớp thì không", () => {
    const lech: string[] = [];
    const tep = [...BANG_THEO_TEN.map((d) => [d.ten, d.batBoi] as const), ...BANG_DONG.filter((d) => d.lop === "THEO_TEN").map((d) => [d.ham, d.batBoi ?? ""] as const)];
    for (const [ai, duong] of tep) {
      const url = new URL(duong, GOC_KHO);
      if (duong === "" || !existsSync(url)) { lech.push(`${ai}: tệp bắt tên '${duong}' không tồn tại`); continue; }
      if (!readFileSync(url, "utf8").includes("maChotTuLoi(")) lech.push(`${ai}: '${duong}' không gọi maChotTuLoi`);
    }
    for (const d of BANG_DONG) if (d.lop !== "THEO_TEN" && d.batBoi !== null) lech.push(`${d.ham}: lớp ${d.lop} mà khai tệp bắt tên`);
    expect(lech).toEqual([]);
  });

  it("tên động: biến chỉ nhận lời gọi các hàm vị từ đã khai; mọi mã chúng trả về đọc được và có trong CHOT_THEO_RANG_BUOC — hay TU_VUNG_NGOAI của đúng hàm ấy", async () => {
    const { ham } = await docCho();
    const lech: string[] = [];
    for (const d of BANG_DONG) {
      if (d.viTu.length === 0) { lech.push(`${d.ham}: viTu rỗng`); continue; }
      const bien = bienCua(d.bieuThuc);
      if (bien === null) { lech.push(`${d.ham}: biểu thức '${d.bieuThuc}' không phải lower(<biến>)`); continue; }
      const goi = boChuThich(ham.find((h) => h.ham === d.ham)?.than ?? "");
      // [lượt soi §S1.9101 T3] Mọi phép gán cho biến là lời gọi MỘT hàm vị từ của dòng; mọi hàm của dòng được gán; không `INTO <biến>`.
      const gan = [...goi.matchAll(new RegExp(String.raw`\b${bien}\s*:=\s*([^;]*);`, "gu"))].map((m) => (m[1] ?? "").trim());
      const duocGan = new Set<string>();
      for (const v of gan) {
        const m = /^(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/u.exec(v);
        if (m === null || !d.viTu.includes(m[1] ?? "")) lech.push(`${d.ham}: ${bien} := ${v.slice(0, 80)} — không phải lời gọi một hàm của viTu`);
        else duocGan.add(m[1] ?? "");
      }
      for (const v of d.viTu) if (!duocGan.has(v)) lech.push(`${d.ham}: viTu khai ${v} mà thân không gán ${bien} từ nó`);
      if (new RegExp(String.raw`\bINTO\s+${bien}\b`, "iu").test(goi)) lech.push(`${d.ham}: SELECT … INTO ${bien} — ngoài tầm phép đo`);
      for (const v of d.viTu) {
        const than = ham.find((h) => h.ham === v)?.than;
        if (than === undefined) { lech.push(`${d.ham}: hàm vị từ ${v} không tồn tại`); continue; }
        const ma = maTraVe(than);
        if (ma.length === 0) lech.push(`${v}: không thấy mã nào — bộ đọc mù`);
        for (const r of traVeKhongDocDuoc(than)) lech.push(`${v}: RETURN ${r.slice(0, 60)} — không phải mã hằng hay NULL`);
        for (const m of ma) {
          if (Object.hasOwn(CHOT_THEO_RANG_BUOC, m.toLowerCase())) continue;
          if (TU_VUNG_NGOAI.some((x) => x.viTu === v && x.ma === m)) continue;
          lech.push(`${v} trả '${m}' — không có trong CHOT_THEO_RANG_BUOC, không trong TU_VUNG_NGOAI của ${v}`);
        }
      }
      // Dòng THEO_TEN mà mã của nó nằm ở TU_VUNG_NGOAI thì lời từ chối ấy không vào sổ — lớp sai.
      if (d.lop === "THEO_TEN" && d.viTu.some((v) => TU_VUNG_NGOAI.some((x) => x.viTu === v))) lech.push(`${d.ham}: THEO_TEN mà mã ở TU_VUNG_NGOAI`);
    }
    expect(lech).toEqual([]);
  });

  it("TU_VUNG_NGOAI hai chiều: mỗi mã còn được ĐÚNG hàm vị từ của nó trả về, và không mã nào đã có trong CHOT_THEO_RANG_BUOC", async () => {
    const { ham } = await docCho();
    for (const t of TU_VUNG_NGOAI) {
      expect(maTraVe(ham.find((h) => h.ham === t.viTu)?.than ?? ""), `${t.viTu} / ${t.ma}`).toContain(t.ma);
      expect(BANG_DONG.some((d) => d.viTu.includes(t.viTu)), t.viTu).toBe(true);
      expect(Object.hasOwn(CHOT_THEO_RANG_BUOC, t.ma.toLowerCase()), t.ma).toBe(false);
    }
  });

  it("lớp THEO_TEN lấy vế vào sổ từ CHOT_VAO_SO — mọi mã của CHOT_THEO_RANG_BUOC có dòng ở đó", () => {
    for (const ma of Object.values(CHOT_THEO_RANG_BUOC)) expect(Object.hasOwn(CHOT_VAO_SO, ma), ma).toBe(true);
  });

  it("đối chứng: một hàm mới mang RAISE không tên, một tên mới, một tên động mới, một tên của bảng chốt sai errcode ⇒ phép điều tra nêu cả bốn (giao dịch huỷ)", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "CREATE FUNCTION public.zz_k12_doi_chung() RETURNS void LANGUAGE plpgsql AS $$ BEGIN " +
          "RAISE EXCEPTION 'khong ten' USING ERRCODE = 'check_violation'; " +
          "RAISE EXCEPTION 'ten moi' USING ERRCODE = 'check_violation', CONSTRAINT = 'zz_k12_ten_moi'; " +
          "RAISE EXCEPTION 'dong' USING ERRCODE = 'check_violation', CONSTRAINT = lower('X'); " +
          "RAISE EXCEPTION 'sai errcode' USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'd2_nguoi_tao_tu_duyet'; END $$",
      );
      const { cho } = await docCho(c);
      const loi = cho.filter((x) => x.ham === "zz_k12_doi_chung").map(phanLoai).flatMap((x) => ("loi" in x ? [x.loi] : []));
      expect(loi).toHaveLength(4);
      expect(loi.join("\n")).toMatch(/RAISE không tên \(zz_k12_doi_chung, check_violation\)/u);
      expect(loi.join("\n")).toMatch(/tên 'zz_k12_ten_moi'/u);
      expect(loi.join("\n")).toMatch(/tên động 'lower\('X'\)'/u);
      expect(loi.join("\n")).toMatch(/'d2_nguoi_tao_tu_duyet' của CHOT_THEO_RANG_BUOC dưới errcode insufficient_privilege/u);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});
