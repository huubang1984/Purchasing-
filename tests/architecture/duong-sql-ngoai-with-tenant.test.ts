// ==============================================================================================
// [S1.59 / khoản nợ 99] ĐƯỜNG CHẠY SQL TRÊN POOL ỨNG DỤNG NGOÀI `withTenant` — ĐIỀU TRA KIẾN TRÚC
//
// `withTenant` có hai phép kiểm GUC vận hành (khoản 96): ⑴ khối DO ném TP096 trong CÙNG câu với COMMIT, ⑵ đọc lại ba GUC sau giao
// dịch và huỷ kết nối nhiễm. Khoản 99: mã chạy câu trên pool NGOÀI hàm ấy không có lớp nào. Bản vá đặt ⑵ vào `ganVaiTroChoPool` —
// chỗ MỌI lần lấy client của pool có vai đi qua — và ⑴ vào mọi giao dịch tường minh của mã sản xuất. Tệp này giữ ba tiền đề của bản
// vá ở dạng kiểm được:
//   ⒜ mọi `createPool(` của mã sản xuất truyền `role` (không `role: undefined`, không đổi tên khi import) — không vai thì không qua
//      `ganVaiTroChoPool`, không có phép kiểm ⑵ — và số chỗ dựng `new pg.Pool(` / `new pg.Client(` của từng tệp khớp danh sách khai;
//   ⒝ mọi lệnh kết thúc giao dịch bằng commit (COMMIT, hay END — đồng nghĩa trong PostgreSQL) trong hằng chuỗi của mã sản xuất đi
//      ngay sau khối DO ném TP096 trong cùng câu — số lệnh không chặn của từng tệp khớp danh sách khai — và tệp nào mang khối chặn thì
//      có nhánh xử lý SQLSTATE TP096;
//   ⒞ số chỗ lấy client (`.connect()`) và chạy câu thẳng trên một pool (`…pool.query(`) của từng tệp sản xuất khớp danh sách khai
//      kèm lý do — một đường mới là một quyết định nhìn thấy được.
// Miễn theo SỐ LƯỢNG, không theo tệp (lượt soi 52 NHẸ-3, cùng bài học H14-M1 của [INV-H21]); một mục đã khai mà mã không còn khớp
// cũng đỏ.
// RANH GIỚI, nói ra: đây là bộ dò CÁCH VIẾT trên văn bản đã bỏ chú thích và nội dung chuỗi, không phải bộ kiểm kiểu — biến pool không
// mang chữ "pool" (`p.query(`) lọt phần `.query` của vế ⒞, và vế ⒞ đếm SỐ LƯỢNG chứ không đếm danh tính (đổi một đường lấy một đường
// khác cùng tệp vẫn xanh); lệnh COMMIT dựng lúc chạy lọt vế ⒝; một câu TỰ commit (`pool.query` ghi ngoài giao dịch tường minh) không
// có COMMIT nào để gác nên vế ⒝ không nói gì về nó — vế ⒞ biến nó thành một dòng phải khai; mã trong phần nội suy `${…}` của template
// literal bị bỏ cùng chuỗi; hằng nháy đơn/kép viết `\n` thoát được bộ đọc chung (`cacHangChuoi`) đọc thành chữ `n`, nên một chú thích
// `--` trong hằng ấy nuốt phần sau của câu (cùng giới hạn với [INV-H21]); tệp chưa `git add` đứng ngoài `git ls-files` khi chạy cục bộ
// (CI thấy mọi tệp đã commit); hàm nhận `pg.Pool` từ người gọi không được soi phía người gọi; một dấu nháy trong biểu thức chính quy có
// thể làm bộ bỏ chuỗi nuốt nhầm mã (cùng giới hạn với bộ đọc của [INV-H21]).
// ==============================================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cacHangChuoi, tepNguonCoSql } from "./qt3-doc-sql.js";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

function docTep(tep: string): string {
  return readFileSync(join(GOC, tep), "utf8").replace(/\r\n/gu, "\n");
}

/** Văn bản mã với chú thích và NỘI DUNG chuỗi thay bằng khoảng trắng — giữ nguyên độ dài và xuống dòng. */
function boChuThichVaChuoi(ma: string): string {
  const ra = ma.split("");
  const trang = (tu: number, den: number): void => {
    for (let k = tu; k < den && k < ra.length; k += 1) if (ra[k] !== "\n") ra[k] = " ";
  };
  let i = 0;
  while (i < ma.length) {
    const c = ma[i]!;
    const ke = ma[i + 1];
    if (c === "/" && ke === "/") {
      const j = ma.indexOf("\n", i);
      const den = j < 0 ? ma.length : j;
      trang(i, den);
      i = den;
      continue;
    }
    if (c === "/" && ke === "*") {
      const j = ma.indexOf("*/", i + 2);
      const den = j < 0 ? ma.length : j + 2;
      trang(i, den);
      i = den;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < ma.length && ma[j] !== c) {
        if (ma[j] === "\\") j += 1;
        j += 1;
      }
      trang(i + 1, j);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return ra.join("");
}

interface CumChuoi {
  readonly dong: number;
  readonly noiDung: string;
  /** Cụm là TOÁN HẠNG của một phép so (`ketThuc?.command !== "COMMIT"`) — tên command tag, không phải một câu lệnh. */
  readonly laToanHangSoSanh: boolean;
  /** Cụm là đối số ĐẦU của một lời gọi `.query(` — chữ ở đó là một câu gửi đi, kể cả `end` viết thường. */
  readonly laDoiSoQuery: boolean;
}

/** Mọi hằng chuỗi của một tệp, GHÉP các hằng liền kề nối bằng `+` — cùng quy tắc với bộ đọc SQL của [INV-H21], không lọc từ khoá. */
function chuoiGhep(ma: string): readonly CumChuoi[] {
  const chuoi = cacHangChuoi(ma);
  const ra: CumChuoi[] = [];
  let i = 0;
  while (i < chuoi.length) {
    let j = i;
    let noi = chuoi[i]!.noiDung;
    while (j + 1 < chuoi.length && /^\s*\+\s*$/u.test(ma.slice(chuoi[j]!.cuoi, chuoi[j + 1]!.dau))) {
      j += 1;
      noi += chuoi[j]!.noiDung;
    }
    const truoc = ma.slice(Math.max(0, chuoi[i]!.dau - 80), chuoi[i]!.dau);
    const sau = ma.slice(chuoi[j]!.cuoi, chuoi[j]!.cuoi + 12);
    ra.push({
      dong: ma.slice(0, chuoi[i]!.dau).split("\n").length,
      noiDung: noi,
      laToanHangSoSanh: /(?:[!=]==?|\bcase)\s*$/u.test(truoc) || /^\s*[!=]==?/u.test(sau),
      laDoiSoQuery: /\.query\s*(?:<[^()]*>)?\s*\(\s*$/u.test(truoc),
    });
    i = j + 1;
  }
  return ra;
}

/**
 * Quét SQL từ trái sang phải MỘT LẦN: bỏ chú thích `--` và `/* … *\/`; hằng nháy đơn và thân dollar-quote thì GIỮ nguyên (`giuChuoi`)
 * hay thay bằng chỗ trống. Không dùng biểu thức chính quy theo lượt: `--` trong một hằng không phải chú thích, và một dấu nháy trong
 * chú thích không mở hằng (cùng lý do với bộ đọc của [INV-H21]).
 */
function quetSql(sql: string, giuChuoi: boolean): string {
  let ra = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? sql.length : j;
      ra += " ";
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2);
      i = j < 0 ? sql.length : j + 2;
      ra += " ";
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") break;
        j += 1;
      }
      ra += giuChuoi ? sql.slice(i, j + 1) : "'S'";
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const the = /^\$(\w*)\$/u.exec(sql.slice(i));
      if (the) {
        const dong = sql.indexOf(the[0], i + the[0].length);
        const den = dong < 0 ? sql.length : dong + the[0].length;
        ra += giuChuoi ? sql.slice(i, den) : " ";
        i = den;
        continue;
      }
    }
    ra += c;
    i += 1;
  }
  return ra;
}

/** Lệnh COMMIT, không phân biệt hoa thường, tuỳ chọn WORK/TRANSACTION và AND [NO] CHAIN, đứng đầu câu hay sau `;`, theo sau là `;` hay hết câu. */
const RE_LENH_COMMIT = /(?:^|;)\s*COMMIT(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?\s*(?=;|$)/giu;
/**
 * Lệnh END (đồng nghĩa COMMIT) viết HOA — ở mọi hằng; viết thường chỉ khi hằng là đối số đầu của `.query(`: chuỗi "end" thường là tên
 * sự kiện stream của Node (đo: bản đầu đếm `apps/api/src/server.ts` thành một lệnh commit).
 */
const RE_LENH_END_HOA = /(?:^|;)\s*END(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?\s*(?=;|$)/gu;
const RE_LENH_END_MOI_CACH = /(?:^|;)\s*END(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?\s*(?=;|$)/giu;
/** Khối chặn ⑴ của khoản 96 đúng nguyên văn, và lệnh commit viết HOA NGAY sau nó, trong cùng câu. */
const RE_COMMIT_CO_CHAN =
  /DO\s+\$kiem_khoan_96\$BEGIN\s+IF\s+pg_catalog\.current_setting\('session_replication_role'\)\s+OPERATOR\(pg_catalog\.<>\)\s+'origin'\s+AND\s+pg_catalog\.current_setting\('session_replication_role'\)\s+OPERATOR\(pg_catalog\.<>\)\s+'local'\s+THEN\s+RAISE\s+SQLSTATE\s+'TP096';\s+END\s+IF;\s+END\$kiem_khoan_96\$;\s*(?:COMMIT|END)(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?\s*(?=;|$)/gu;

/** Số lệnh commit của một cụm — trên SQL đã bỏ chú thích, hằng nháy đơn và thân dollar-quote (`BEGIN … END;` của plpgsql không phải lệnh). */
function soLenhCommit(c: Pick<CumChuoi, "noiDung" | "laDoiSoQuery">): number {
  const sach = quetSql(c.noiDung, false);
  return [...sach.matchAll(RE_LENH_COMMIT)].length + [...sach.matchAll(c.laDoiSoQuery ? RE_LENH_END_MOI_CACH : RE_LENH_END_HOA)].length;
}

/** Số lệnh commit có khối chặn — trên SQL chỉ bỏ chú thích, nên một khối chặn nằm trong chú thích không che một COMMIT thật. */
function soCommitCoChan(noiDung: string): number {
  return [...quetSql(noiDung, true).matchAll(RE_COMMIT_CO_CHAN)].length;
}

/** Số lệnh commit KHÔNG chặn của một tệp. */
function commitKhongChanCua(ma: string): number {
  let so = 0;
  for (const c of chuoiGhep(ma)) {
    if (c.laToanHangSoSanh) continue;
    so += Math.max(0, soLenhCommit(c) - soCommitCoChan(c.noiDung));
  }
  return so;
}

/** Tệp mang khối chặn mà không có nhánh so SQLSTATE với "TP096" — lời từ chối sẽ rơi ra như một lỗi không tên (lượt soi 52 INFO-7). */
function thieuNhanhTP096(ma: string): boolean {
  const cum = chuoiGhep(ma);
  const coChan = cum.some((c) => soCommitCoChan(c.noiDung) > 0);
  return coChan && !cum.some((c) => c.noiDung === "TP096" && c.laToanHangSoSanh);
}

/** Vế ⒝: số lệnh commit không có khối chặn được phép theo tệp, kèm lý do. */
const COMMIT_TRAN_DA_KHAI: Record<string, { readonly so: number; readonly lyDo: string }> = {
  "packages/db/src/migrate.ts": {
    so: 2,
    lyDo:
      "khoá tư vấn và giao dịch của từng tệp migration trên kết nối DEPLOY, không phải pool ứng dụng: migrate() từ chối sớm khi GUC " +
      "vận hành gắn sẵn từ nguồn ngoài (khoản 92), và một migration đặt replica cần quyền SUSET — việc của hardening",
  },
};

const RE_DUNG_TRUC_TIEP = /\bnew\s+(?:pg\s*\.\s*)?(?:Pool|Client)\s*\(/gu;

/** Vế ⒜: số chỗ dựng `pg.Pool`/`pg.Client` trực tiếp được phép theo tệp, kèm lý do. */
const DUNG_TRUC_TIEP_DA_KHAI: Record<string, { readonly so: number; readonly lyDo: string }> = {
  "packages/db/src/pool.ts": {
    so: 1,
    lyDo: "chính createPool — nơi DUY NHẤT của mã sản xuất dựng pg.Pool, rồi giao cho ganVaiTroChoPool khi có vai",
  },
  "packages/test-support/src/postgres.ts": {
    so: 3,
    lyDo: "hạ tầng test: pg.Client dựng CSDL của cụm thử, pool superuser của cụm là cố ý, poolAs bọc ganVaiTroChoPool",
  },
};

/** Vế ⒞: số chỗ lấy client và chạy câu thẳng trên pool của từng tệp, kèm lý do. */
const DUONG_KHAI: Record<string, { readonly lay: number; readonly cau: number; readonly lyDo: string }> = {
  "packages/tenancy/src/with-tenant.ts": {
    lay: 1,
    cau: 0,
    lyDo: "withTenant — chính lớp ⑴⑵ của khoản 96; withGuestSession gọi lại withTenant",
  },
  "packages/invitation/src/invitation.ts": {
    lay: 2,
    cau: 0,
    lyDo:
      "hai bộ dọn nền chạy ngoài giao dịch của một yêu cầu: giao dịch tường minh kết thúc bằng COMMIT mang khối DO (⑴, vế ⒝), " +
      "huỷ kết nối trên mọi lỗi; ⑵ ở ganVaiTroChoPool (khoản 99)",
  },
  "packages/identity/src/rbac.ts": {
    lay: 0,
    cau: 1,
    lyDo:
      "khangDinhAuditPoolDungQuyen đọc thuộc tính vai của auditPool — một câu CHỈ ĐỌC tự commit, không ghi gì để commit dưới " +
      "replica; ⑵ ở ganVaiTroChoPool",
  },
  "apps/api/src/composition.ts": {
    lay: 1,
    cau: 0,
    lyDo: "batDau(): khangDinhPhienDangNhapUngDung trên một client của mỗi pool trước khi mở cổng — chỉ đọc; ⑵ ở ganVaiTroChoPool",
  },
  "packages/db/src/migrate.ts": {
    lay: 1,
    cau: 0,
    lyDo:
      "client giữ khoá của migrate() trên pool người gọi truyền vào để chạy migration — kết nối deploy, không phải pool ứng dụng; " +
      "có phép từ chối GUC vận hành sớm của riêng nó (khoản 92)",
  },
  "packages/test-support/src/postgres.ts": {
    lay: 1,
    cau: 0,
    lyDo: "hạ tầng test — pg.Client dựng CSDL của cụm thử",
  },
};

const RE_GOI_CREATE_POOL = /\bcreatePool\s*\(/gu;
const RE_LAY_CLIENT = /\.connect\s*\(\s*\)/gu;
const RE_CAU_TREN_POOL = /\b\w*[Pp]ool\s*\.\s*query\s*[<(]/gu;
const RE_GAN_LISTENER = /\.on\s*\(\s*["'`]/gu;
const RE_TEN_CONNECT_BIND = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.]+\.connect\.bind\s*\(/gu;
const RE_GOI_KHONG_DOI_SO = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(\s*\)/gu;

/**
 * [S1.66 / lượt soi ngang 59b-2] Vế ⒟: số listener 'error' gắn bằng `.on(` trong MÃ, không trong chú thích hay chuỗi. Bộ bỏ chuỗi
 * thay NỘI DUNG chuỗi bằng khoảng trắng và giữ nguyên độ dài, nên tên sự kiện đọc ở văn bản gốc, đúng vị trí ngay sau dấu nháy mở.
 * `.once(` và `.off(` không tính: `server.once("error")` của cổng HTTP không phải listener của một client mượn từ pool, và tính nó
 * thì một client thiếu listener ở cùng tệp vẫn xanh.
 */
function soListenerLoi(ma: string): number {
  const sach = boChuThichVaChuoi(ma);
  let so = 0;
  for (const m of sach.matchAll(RE_GAN_LISTENER)) {
    const sau = (m.index ?? 0) + m[0].length;
    if (ma.startsWith("error", sau) && ma[sau + 5] === ma[sau - 1]) so += 1;
  }
  return so;
}

/**
 * [S1.66 / lượt soi 60a-3] Số chỗ LẤY client trong một văn bản đã bỏ chú thích và chuỗi: `.connect()` trần, CỘNG lời gọi không đối số
 * của mọi tên gán từ `<x>.connect.bind(…)` — khuôn của bộ bọc vai (`const connectGoc = pool.connect.bind(pool)` rồi `connectGoc()`),
 * chỗ bản đầu của vế ⒟ không thấy. Điểm mù còn lại, nói ra: dạng callback `connect(cb)`, truyền `pool.connect` như một giá trị, và
 * `.bind` qua một biến trung gian khác.
 */
function soLanLayClient(sach: string): number {
  let so = [...sach.matchAll(RE_LAY_CLIENT)].length;
  for (const m of sach.matchAll(RE_TEN_CONNECT_BIND)) {
    for (const k of sach.matchAll(RE_GOI_KHONG_DOI_SO)) if (k[1] === m[1]) so += 1;
  }
  return so;
}

/** Vế ⒟: số chỗ lấy client KHÔNG có listener 'error' tương ứng được phép theo tệp, kèm lý do. */
const LAY_KHONG_NGHE_DA_KHAI: Record<string, { readonly so: number; readonly lyDo: string }> = {
  "packages/test-support/src/postgres.ts": {
    so: 1,
    lyDo:
      "hạ tầng test — pg.Client một lần của phép đo backend còn sót ngay trước khi dừng container; kết nối đứt ở đó làm bộ test đỏ, " +
      "không có tiến trình sản xuất nào để chết",
  },
};

/** Vế ⒜ trên một văn bản: dòng của mỗi lời gọi createPool mà danh sách đối số không có thuộc tính `role` mang giá trị. */
function createPoolThieuVai(ma: string): number[] {
  const sach = boChuThichVaChuoi(ma);
  const ra: number[] = [];
  for (const m of sach.matchAll(RE_GOI_CREATE_POOL)) {
    const dau = m.index ?? 0;
    if (/\bfunction\s+$/u.test(sach.slice(Math.max(0, dau - 20), dau))) continue;
    let sau = 1;
    let k = dau + m[0].length;
    while (k < sach.length && sau > 0) {
      if (sach[k] === "(") sau += 1;
      if (sach[k] === ")") sau -= 1;
      k += 1;
    }
    const doiSo = sach.slice(dau, k);
    if (!/[{,]\s*role\s*[:,}]/u.test(doiSo) || /\brole\s*:\s*undefined\b/u.test(doiSo)) ra.push(sach.slice(0, dau).split("\n").length);
  }
  return ra;
}

/** Vế ⒜: `createPool` đổi tên khi import thì bộ dò theo tên không thấy lời gọi. */
function coDoiTenCreatePool(ma: string): boolean {
  return /\bcreatePool\s+as\b/u.test(boChuThichVaChuoi(ma));
}

describe("[S1.59 / khoản nợ 99] đường chạy SQL trên pool ứng dụng ngoài withTenant", () => {
  const tep = tepNguonCoSql();

  it("phép quét không rỗng ruột: có mã sản xuất để quét", () => {
    expect(tep.length).toBeGreaterThan(50);
  });

  it("⒜ mọi createPool( của mã sản xuất truyền `role` — mọi pool ứng dụng qua ganVaiTroChoPool; số chỗ dựng pg.Pool / pg.Client khớp danh sách khai", () => {
    const thieuVai: string[] = [];
    const doiTen: string[] = [];
    const dungTrucTiep: Record<string, number> = {};
    let soCreatePool = 0;
    for (const t of tep) {
      const ma = docTep(t);
      const sach = boChuThichVaChuoi(ma);
      soCreatePool += [...sach.matchAll(RE_GOI_CREATE_POOL)].length;
      for (const dong of createPoolThieuVai(ma)) thieuVai.push(`${t}:${dong}`);
      if (coDoiTenCreatePool(ma)) doiTen.push(t);
      const so = [...sach.matchAll(RE_DUNG_TRUC_TIEP)].length;
      if (so > 0) dungTrucTiep[t] = so;
    }
    expect(soCreatePool, "chống rỗng ruột: mã sản xuất có lời gọi createPool").toBeGreaterThan(1);
    expect(thieuVai, "createPool không vai ⇒ không qua ganVaiTroChoPool ⇒ không có phép kiểm GUC vận hành ở mỗi lần lấy client").toEqual([]);
    expect(doiTen, "createPool đổi tên khi import — bộ dò theo tên không thấy lời gọi").toEqual([]);
    expect(
      dungTrucTiep,
      "số chỗ dựng pg.Pool/pg.Client theo tệp phải khớp danh sách khai — một chỗ mới là một quyết định, một mục thừa là ngoại lệ chết",
    ).toEqual(Object.fromEntries(Object.entries(DUNG_TRUC_TIEP_DA_KHAI).map(([t, d]) => [t, d.so])));
  });

  it("⒝ mọi lệnh COMMIT/END trong hằng chuỗi của mã sản xuất đi ngay sau khối DO ném TP096 — số lệnh không chặn theo tệp khớp danh sách khai; tệp mang khối chặn có nhánh TP096", () => {
    const khongChan: Record<string, number> = {};
    const thieuNhanh: string[] = [];
    let soCoChan = 0;
    for (const t of tep) {
      const ma = docTep(t);
      const so = commitKhongChanCua(ma);
      if (so > 0) khongChan[t] = so;
      soCoChan += chuoiGhep(ma).reduce((tong, c) => tong + soCommitCoChan(c.noiDung), 0);
      if (thieuNhanhTP096(ma)) thieuNhanh.push(t);
    }
    expect(soCoChan, "chống rỗng ruột: withTenant và hằng dùng chung của hai bộ dọn mang khối chặn").toBeGreaterThanOrEqual(2);
    expect(
      khongChan,
      "COMMIT không có khối chặn ngoài số đã khai — ghi dưới replica sẽ được commit; một mục khai thừa là ngoại lệ chết",
    ).toEqual(Object.fromEntries(Object.entries(COMMIT_TRAN_DA_KHAI).map(([t, d]) => [t, d.so])));
    expect(thieuNhanh, "tệp mang khối chặn mà không so SQLSTATE với TP096 — lời từ chối rơi ra như một lỗi không tên").toEqual([]);
  });

  it("⒞ chỗ lấy client và chạy câu thẳng trên pool của mã sản xuất khớp danh sách khai", () => {
    const thucTe: Record<string, { lay: number; cau: number }> = {};
    for (const t of tep) {
      const sach = boChuThichVaChuoi(docTep(t));
      const lay = [...sach.matchAll(RE_LAY_CLIENT)].length;
      const cau = [...sach.matchAll(RE_CAU_TREN_POOL)].length;
      if (lay > 0 || cau > 0) thucTe[t] = { lay, cau };
    }
    const khai = Object.fromEntries(Object.entries(DUONG_KHAI).map(([t, d]) => [t, { lay: d.lay, cau: d.cau }]));
    expect(thucTe, "một đường mới chạy SQL trên pool ngoài withTenant phải được khai kèm lý do").toEqual(khai);
  });

  it("⒟ [S1.66 / lượt soi ngang 59b-2, lượt soi 60a-3] trong mỗi tệp mã sản xuất, số listener 'error' gắn bằng `.on(` không ít hơn số chỗ lấy client — `.connect()` trần và lời gọi của tên gán từ `.connect.bind(` — khuôn [fix I1]; tệp thiếu phải khai kèm lý do (một phép ĐẾM theo tệp, không ghép từng cặp)", () => {
    const thieu: Record<string, number> = {};
    let soNghe = 0;
    for (const t of tep) {
      const ma = docTep(t);
      const lay = soLanLayClient(boChuThichVaChuoi(ma));
      const nghe = soListenerLoi(ma);
      soNghe += nghe;
      if (lay > nghe) thieu[t] = lay - nghe;
    }
    expect(soNghe, "chống rỗng ruột: withTenant, migrate(), hai bộ dọn và phép kiểm lúc khởi động gắn listener").toBeGreaterThanOrEqual(5);
    expect(
      thieu,
      "client mượn không listener 'error' làm tiến trình chết khi kết nối đứt (đo: lượt soi 59, bo-don-ngat-ket-noi.int.test.ts); " +
        "một mục khai thừa là ngoại lệ chết",
    ).toEqual(Object.fromEntries(Object.entries(LAY_KHONG_NGHE_DA_KHAI).map(([t, d]) => [t, d.so])));
  });

  it("đối chứng trên văn bản giả: bộ dò thấy createPool thiếu vai hay đổi tên, COMMIT/END không chặn, nhánh TP096 thiếu; bỏ qua chú thích, chuỗi, phép so command tag, thân dollar-quote", () => {
    expect(createPoolThieuVai('const p = createPool(url, 2);\nconst q = createPool(url, 2, { role: "app_api" });')).toEqual([1]);
    expect(createPoolThieuVai("const q = createPool(url, 2, { role });")).toEqual([]);
    expect(createPoolThieuVai("const q = createPool(url, 2, { role: undefined });"), "role: undefined là không vai").toEqual([1]);
    expect(createPoolThieuVai('// createPool(url)\nconst s = "createPool(url)";\nexport function createPool(a: string) {}')).toEqual([]);
    expect(coDoiTenCreatePool('import { createPool as tao } from "@trustprocure/db";')).toBe(true);
    expect(coDoiTenCreatePool('import { createPool } from "@trustprocure/db";')).toBe(false);

    const chan =
      "DO $kiem_khoan_96$BEGIN IF pg_catalog.current_setting('session_replication_role') OPERATOR(pg_catalog.<>) 'origin' " +
      "AND pg_catalog.current_setting('session_replication_role') OPERATOR(pg_catalog.<>) 'local' " +
      "THEN RAISE SQLSTATE 'TP096'; END IF; END$kiem_khoan_96$; COMMIT";
    /** Văn bản giả của một lời gọi `.query` với câu NHIỀU DÒNG thật (template literal) — `\n` viết thoát bộ đọc chung đọc thành chữ `n`. */
    const nhieuDong = (...dong: string[]): string => "await c.query(`" + dong.join("\n") + "`);";
    expect(commitKhongChanCua('await c.query("COMMIT");')).toBe(1);
    expect(commitKhongChanCua('await c.query("BEGIN; SELECT 1; " + "COMMIT");')).toBe(1);
    expect(commitKhongChanCua("await c.query('END');")).toBe(1);
    expect(commitKhongChanCua('await c.query("end");'), "end viết thường là đối số đầu của .query — một câu gửi đi").toBe(1);
    expect(commitKhongChanCua('await c.query("commit work and no chain");')).toBe(1);
    expect(commitKhongChanCua('await c.query("COMMIT -- ghi chu");'), "chú thích sau lệnh").toBe(1);
    expect(commitKhongChanCua('await c.query("/* ghi chu */ COMMIT");'), "chú thích trước lệnh").toBe(1);
    expect(commitKhongChanCua("await c.query(\"SELECT 'a--b'; COMMIT\");"), "-- trong một hằng không phải chú thích").toBe(1);
    expect(commitKhongChanCua(nhieuDong("SELECT 1; -- ghi chu", "COMMIT")), "chú thích hết ở cuối dòng").toBe(1);
    expect(commitKhongChanCua(nhieuDong("-- ghi chu", "COMMIT")), "chú thích đứng trước lệnh đầu tiên").toBe(1);
    expect(commitKhongChanCua(nhieuDong("SELECT 1 -- ghi chu", "COMMIT")), "không `;` thì COMMIT là tên cột của cùng câu SELECT, không phải lệnh").toBe(0);
    expect(commitKhongChanCua(nhieuDong("-- COMMIT", "SELECT 1")), "COMMIT trong chú thích không phải lệnh").toBe(0);
    expect(commitKhongChanCua('req.on("end", xong);'), "tên sự kiện stream viết thường không phải lệnh END").toBe(0);
    expect(commitKhongChanCua('if (kq.command !== "COMMIT") throw x;')).toBe(0);
    expect(commitKhongChanCua('throw new Error("lần COMMIT cuối của tệp");')).toBe(0);
    expect(commitKhongChanCua('await c.query("DO $$BEGIN PERFORM 1; END; $$");')).toBe(0);
    expect(commitKhongChanCua(`await c.query("${chan}");`)).toBe(0);
    expect(commitKhongChanCua(`await c.query("COMMIT; BEGIN; ${chan}");`), "một COMMIT có chặn không che một COMMIT trần cùng câu").toBe(1);
    expect(commitKhongChanCua(nhieuDong(`-- ${chan}`, "COMMIT")), "khối chặn trong chú thích không che COMMIT thật").toBe(1);
    expect(commitKhongChanCua(`await c.query("${chan.replace("'local'", "'replica'")}");`), "khối chặn sai điều kiện không tính").toBe(1);

    expect(thieuNhanhTP096(`const CAU = "${chan}";`), "mang khối chặn mà không so TP096").toBe(true);
    expect(thieuNhanhTP096(`const CAU = "${chan}";\nif (loi.code === "TP096") throw x;`)).toBe(false);
    expect(thieuNhanhTP096('if (loi.code === "TP096") throw x;'), "không mang khối chặn thì không đòi nhánh").toBe(false);

    expect([...boChuThichVaChuoi('// pool.query(x)\nconst a = "pool.connect()";').matchAll(RE_CAU_TREN_POOL)]).toHaveLength(0);
    expect([...boChuThichVaChuoi("await auditPool.query<{ a: string }>(x);").matchAll(RE_CAU_TREN_POOL)]).toHaveLength(1);
    expect([...boChuThichVaChuoi("const kq = new pg.Client({ x });").matchAll(RE_DUNG_TRUC_TIEP)]).toHaveLength(1);

    expect(soListenerLoi(`c.on("error", f);\n// c.on("error", g)\nconst s = "c.on('error', h)";`), "chú thích và chuỗi không tính").toBe(1);
    expect(soListenerLoi("c.on('error', f); c.on(`error`, g);"), "ba kiểu nháy").toBe(2);
    expect(soListenerLoi('c.once("error", f); c.off("error", f); c.on("close", f); c.on("errors", f);'), "once/off, sự kiện khác, tên dài hơn").toBe(0);
    expect(soLanLayClient("const connectGoc = pool.connect.bind(pool);\nfunction lay() { return connectGoc().then((c) => c); }"), "[60a-3] lời gọi của tên gán từ .connect.bind").toBe(1);
    expect(soLanLayClient("const c = await pool.connect();\nconst d = await pool.connect ();"), ".connect() trần, kể cả có khoảng trắng").toBe(2);
    expect(soLanLayClient("const goc = pool.connect.bind(pool);\ngoc(cb);\nobj.goc();"), "gọi có đối số, hay qua thuộc tính, không tính").toBe(0);
  });
});
