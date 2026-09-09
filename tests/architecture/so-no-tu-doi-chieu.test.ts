// ==============================================================================================
// [INV-H20] SỔ NỢ PHẢI TỰ ĐỐI CHIẾU — VÌ BA CÁCH ĐẾM CỦA NÓ CHO BA CON SỐ KHÁC NHAU
//
// ----------------------------------------------------------------------------------------------
// KHIẾM KHUYẾT, NÓI THẲNG
// ----------------------------------------------------------------------------------------------
// `docs/STATE.md` mang HAI khẳng định về cùng một thứ:
//
//   ⑴ **bảng sổ nợ** — mỗi dòng một khoản, trạng thái nằm trong văn phong của thân dòng;
//   ⑵ **câu tổng kết của mỗi vòng** — *"Sổ nợ mở còn: 23 và nửa sau của 30"*.
//
// Đo ngày 2026-09-07, trước khi viết tệp này: câu ⑵ xuất hiện TÁM lần, từ mục 27 (S1.12) tới
// mục 35 (S1.20), và nó **sai ở mọi lần**. BA cách đếm cho BA con số:
//
//   câu tổng kết khai                                        :  5
//   đếm bảng theo DẤU VĂN BẢN (dòng không có dấu đã-đóng)    : 14
//     (1, 2, 4, 5, 7, 8, 10, 12, 15, 18, 19, 23, 50, 60 — trong đó **50 đã đóng** nhưng viết
//      bằng một cách khác (*"MỞ VÀ ĐÓNG CÙNG VÒNG"*), và **59 thì VÔ HÌNH** với bộ đọc vì
//      dòng ấy thiếu hẳn một cột — xem P1)
//   phán xét lại từng dòng bằng phép đo hôm nay              : 13
//     (2, 4, 8, 10, 12, 15, 18, 19, 23, 24, 30, 59, 60)
//
// Hai con số cuối lệch nhau ở BẢY dòng, và bảy dòng ấy chia làm hai lớp lý do khác hẳn nhau:
//   • 1, 5, 7 — phép đo HÔM NAY đóng chúng (chúng đã đóng từ lâu, không ai đánh dấu);
//   • 50, 24, 30, 59 — không ai đọc SAI mã cả, người ta đọc sai CHỮ: 50 đã đóng nhưng viết bằng
//     một cách thứ năm, 24 và 30 mang dấu đọc như đã đóng trong khi chúng còn mở, 59 thì không
//     bộ đọc nào thấy. Lớp thứ hai này là lý do P1 và P2 tồn tại.
// Câu ⑵ sai theo hướng DỄ CHỊU với cả ba cách đếm: nó khai ít nợ hơn số nợ thật.
//
// Không lớp nào bắt được, vì không lớp nào ĐỌC hai khẳng định ấy cùng lúc. Cùng hình dạng với
// *"16/50"* (S1.18 bắt ở `docs/TEST-PLAN.md`) và *"mười chín ADR"* (S1.20 bắt ở chính tệp này):
// **một con số tóm tắt không có ai đọc nó.** Lần thứ ba thì nó thôi là sự trùng hợp.
//
// ----------------------------------------------------------------------------------------------
// ~~NĂM~~ **[S1.28] CÁC** TÍNH CHẤT, VÀ VÌ SAO MỖI CÁI TỒN TẠI
//
// Danh sách dưới đây là năm tính chất ĐẦU, viết cho `docs/STATE.md`. P0 và P6 thêm vào sau (xem
// chú thích tại chỗ), và P7–P10 — phần phủ `Handoff.md`, khoản nợ 61 — có khối lý do RIÊNG ở
// giữa tệp, ngay trên `demSoNo`. Con số "năm" ở đây từng đúng và nay không; nó được gạch chứ
// không được xoá, đúng quy ước của kho.
// ----------------------------------------------------------------------------------------------
//   P1 **Mọi dòng có ĐÚNG BA CỘT.** Đo trước khi sửa: dòng 59 có MỘT cột nội dung (thiếu hẳn cột
//      con trỏ) và dòng 52 có BỐN (một `|` trần bên trong một đoạn mã). Markdown vẫn dựng bảng,
//      nên mắt người không thấy — còn mọi bộ đọc thì bỏ qua dòng 59 TRONG IM LẶNG. Đây là chiều
//      hỏng đắt nhất của cả tệp này: một dòng sổ nợ vô hình với chính lớp canh sổ nợ.
//
//   P2 **Mọi dòng KHAI trạng thái bằng một từ khoá đóng**, đặt ở đầu thân. Trước vòng này trạng
//      thái là văn phong: `ĐÃ ĐÓNG`, `ĐÓNG 2026-…`, `ĐÃ ĐO`, `MỞ VÀ ĐÓNG CÙNG VÒNG`, và *còn mở*
//      thì KHÔNG có dấu nào cả — một khoản mở và một khoản quên ghi trạng thái trông giống hệt
//      nhau.
//
//   P3 **Tập dòng khai MỞ hoặc NỬA bằng đúng tập số ở dòng tổng kết.** Đây là vế đóng khiếm
//      khuyết ở trên, và nó đóng theo CẢ HAI CHIỀU: khai thiếu là đỏ, khai thừa cũng đỏ.
//
//   P4 **Mọi đường dẫn ở cột con trỏ phải giải được trong tập tệp GIT THEO DÕI.** Đo trước khi
//      sửa: mười đường hỏng, trong đó dòng 55 trỏ tới `apps/api/src/bucket-bo-nho.ts` — tệp mà
//      THÂN CỦA CHÍNH DÒNG ẤY nói đã bị xoá. Một con trỏ chết làm khoản nợ không đọc lại được,
//      tức nó âm thầm biến một khoản nợ thành một câu chuyện. Vế *"git theo dõi"* chứ không
//      *"có trên đĩa"* là kết quả của lượt CI đầu tiên — xem `DUOC_THEO_DOI`.
//
//   P5 **Số ADR mà `docs/STATE.md` khai bằng số đầu mục `## ADR-` trong sổ quyết định.** S1.20
//      bắt được *"mười chín ADR"* trong khi sổ đã tới 28 — bắt được vì tình cờ đọc tới, không vì
//      có lớp. Nay có lớp.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO ĐỘT BIẾN Ở ĐÂY LÀ ĐỘT BIẾN TRÊN VĂN BẢN, KHÔNG PHẢI TRÊN ĐĨA
// ----------------------------------------------------------------------------------------------
// Chủ thể kiểm tra là NỘI DUNG một tệp tài liệu. Nên mỗi phép kiểm là một hàm THUẦN trên chuỗi,
// và mũi đột biến chạy ĐÚNG hàm ấy trên một chuỗi đã bị sửa một chỗ. Không mũi nào ghi ra đĩa —
// một test ghi vào `docs/` rồi khôi phục là một test hỏng dở dang khi nó bị ngắt giữa chừng
// (bài học của khoản nợ 59: `apps/api/src/routes.test.ts` viết probe thật vào cây nguồn).
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

const TIEU_DE_SO_NO = "## Nợ kỹ thuật";
const NHAN_TONG_KET = "**CÒN MỞ TÍNH TỚI HEAD:**";

/** Ba trạng thái, và chỉ ba. `NỬA` là thật: khoản nợ 30 đóng một nửa và nửa kia có tên. */
const TRANG_THAI = ["ĐÓNG", "MỞ", "NỬA"] as const;
type TrangThai = (typeof TRANG_THAI)[number];

interface DongSoNo {
  readonly so: number;
  readonly dongTep: number;
  readonly o: readonly string[];
  readonly than: string;
  readonly conTro: string;
}

function docTep(duong: string): string {
  return readFileSync(join(GOC, duong), "utf8").replace(/\r\n/g, "\n");
}

/**
 * Khối văn bản của một mục `##`, cắt tới đầu mục `##` kế tiếp.
 *
 * NÉM khi không tìm thấy tiêu đề — một mục bị đổi tên phải làm cổng ĐỎ, không được làm nó xanh
 * trên một khối rỗng. Đây là cùng kỷ luật fail-closed với vế *"không tìm thấy lời khai nào"* ở P5.
 */
function khoiMuc(
  van: string,
  tieuDe: string,
  nhan: string,
): { readonly dong: readonly string[]; readonly tuDong: number } {
  const dong = van.split("\n");
  const dau = dong.findIndex((l) => l.startsWith(tieuDe));
  if (dau < 0) throw new Error(`không tìm thấy "${tieuDe}" trong ${nhan}`);
  const sau = dong.findIndex((l, i) => i > dau && l.startsWith("## "));
  return { dong: dong.slice(dau, sau < 0 ? dong.length : sau), tuDong: dau + 1 };
}

/** Khối văn bản của mục *Nợ kỹ thuật*, cắt tới đầu mục `##` kế tiếp. */
export function khoiSoNo(state: string): { readonly dong: readonly string[]; readonly tuDong: number } {
  return khoiMuc(state, TIEU_DE_SO_NO, "docs/STATE.md");
}

/**
 * Cắt một dòng bảng thành các ô, TÔN TRỌNG `\|` — một `|` trần bên trong đoạn mã đã từng làm
 * dòng 52 mọc thêm một cột mà không ai thấy.
 */
function cacO(dongBang: string): readonly string[] {
  const tho = dongBang.split(/(?<!\\)\|/);
  return tho.slice(1, tho.length - 1).map((o) => o.trim());
}

export function docCacDong(state: string): readonly DongSoNo[] {
  const { dong, tuDong } = khoiSoNo(state);
  const ra: DongSoNo[] = [];
  for (const [i, l] of dong.entries()) {
    const m = /^\|\s*(\d+)\s*\|/.exec(l);
    if (m === null) continue;
    const o = cacO(l);
    ra.push({
      so: Number(m[1]),
      dongTep: tuDong + i,
      o,
      than: o[1] ?? "",
      conTro: o[2] ?? "",
    });
  }
  return ra;
}

// ---- P0 --------------------------------------------------------------------------------------
const O_TIEU_DE = /^\|\s*#\s*\|/;
const O_NGAN_CACH = /^\|[\s:|-]+\|$/;

/**
 * [review lượt 13, H13-3] MỌI HÀNG BẢNG TRONG KHỐI SỔ NỢ PHẢI ĐƯỢC `docCacDong` NHẬN.
 *
 * Không có phép kiểm này, `docCacDong` tái tạo lại đúng khiếm khuyết mà P1 ra đời để bắt: một
 * hàng hợp lệ với GFM nhưng không khớp `^\|\s*\d+\s*\|` — **một dấu cách ở đầu dòng là đủ**, GFM
 * cho phép tới ba — biến mất khỏi P1, P2 VÀ P4 mà không một thông điệp nào, rồi P3 cũng xanh vì
 * số của nó không có ở dòng tổng kết. Tức một khoản nợ MỞ vô hình với chính lớp canh sổ nợ.
 *
 * Nới `docCacDong` mà không thêm phép kiểm này chỉ dời cái lỗ đi một bước.
 */
export function viPhamNhanDien(state: string): readonly string[] {
  const { dong, tuDong } = khoiSoNo(state);
  const daNhan = new Set(docCacDong(state).map((d) => d.dongTep));
  const loi: string[] = [];
  for (const [i, l] of dong.entries()) {
    const t = l.trim();
    if (!t.startsWith("|") || O_TIEU_DE.test(t) || O_NGAN_CACH.test(t)) continue;
    if (!daNhan.has(tuDong + i)) {
      loi.push(`dòng ${tuDong + i}: là một hàng bảng nhưng KHÔNG được nhận diện — ${t.slice(0, 50)}`);
    }
  }
  return loi;
}

// ---- P1 --------------------------------------------------------------------------------------
export function viPhamHinhDang(state: string): readonly string[] {
  const dong = docCacDong(state);
  const loi = dong
    .filter((d) => d.o.length !== 3)
    .map((d) => `dòng ${d.dongTep} (khoản ${d.so}): ${d.o.length} cột, phải là 3`);
  // [review lượt 13, H13-13] Số khoản phải DUY NHẤT: hai dòng cùng số với hai trạng thái khác
  // nhau đi qua P3 sạch sẽ, vì P3 so bằng phép thuộc-tập chứ không đếm.
  const dem = new Map<number, number>();
  for (const d of dong) dem.set(d.so, (dem.get(d.so) ?? 0) + 1);
  for (const [so, n] of dem) if (n > 1) loi.push(`khoản ${so}: xuất hiện ${n} lần, phải là đúng 1`);
  return loi;
}

// ---- P2 --------------------------------------------------------------------------------------
/** Từ vựng đóng, dựng THẲNG từ `TRANG_THAI` — thêm một trạng thái là sửa đúng một chỗ. */
const RE_NHAN = new RegExp(`\\*\\*\\[(${TRANG_THAI.join("|")})\\]\\*\\*`, "g");

export function viPhamKhaiTrangThai(state: string): readonly string[] {
  const loi: string[] = [];
  for (const d of docCacDong(state)) {
    const tatCa = [...`${d.than} ${d.conTro}`.matchAll(RE_NHAN)];
    if (tatCa.length !== 1) {
      loi.push(`khoản ${d.so} (dòng ${d.dongTep}): ${tatCa.length} nhãn trạng thái, phải là đúng 1`);
      continue;
    }
    if (!d.than.startsWith(`**[${tatCa[0]![1]!}]**`)) {
      loi.push(`khoản ${d.so} (dòng ${d.dongTep}): nhãn trạng thái không đứng ở ĐẦU thân`);
    }
  }
  return loi;
}

export function trangThaiCua(d: DongSoNo): TrangThai {
  const m = RE_NHAN.exec(d.than);
  RE_NHAN.lastIndex = 0;
  if (m === null) throw new Error(`khoản ${d.so} không khai trạng thái`);
  return m[1] as TrangThai;
}

// ---- P3 --------------------------------------------------------------------------------------
export function viPhamHaiCachDem(state: string): readonly string[] {
  const suyRa = docCacDong(state)
    .filter((d) => trangThaiCua(d) !== "ĐÓNG")
    .map((d) => d.so)
    .sort((a, b) => a - b);

  const { dong } = khoiSoNo(state);
  const dongKhai = dong.filter((l) => l.startsWith(NHAN_TONG_KET));
  if (dongKhai.length !== 1) {
    return [`phải có ĐÚNG MỘT dòng bắt đầu bằng "${NHAN_TONG_KET}", đếm được ${dongKhai.length}`];
  }
  const duoi = dongKhai[0]!.slice(NHAN_TONG_KET.length).trim();
  if (!/^\d+(\s+·\s+\d+)*$/.test(duoi)) {
    return [`dòng tổng kết phải là danh sách số ngăn bằng " · ", đọc được: ${JSON.stringify(duoi)}`];
  }
  const khai = duoi.split("·").map((x) => Number(x.trim())).sort((a, b) => a - b);

  const thieu = suyRa.filter((n) => !khai.includes(n));
  const thua = khai.filter((n) => !suyRa.includes(n));
  const loi: string[] = [];
  if (thieu.length > 0) loi.push(`bảng khai MỞ/NỬA nhưng dòng tổng kết KHÔNG kể: ${thieu.join(", ")}`);
  if (thua.length > 0) loi.push(`dòng tổng kết kể nhưng bảng khai ĐÓNG: ${thua.join(", ")}`);
  return loi;
}

// ---- P4 --------------------------------------------------------------------------------------
const DUOI_TEP = /\.(ts|mts|mjs|cjs|js|sql|md|json|yml|yaml|toml)$/;

/** Một token trong đấu huyền được coi là ĐƯỜNG DẪN khi nó có `/` hoặc mang một đuôi tệp đã biết. */
function laDuongDan(tok: string): boolean {
  return tok.includes("/") || DUOI_TEP.test(tok);
}

/**
 * [review lượt 13, H13-11] Mọi đường phải nằm TRONG worktree.
 *
 * `join(GOC, "../../ai-do/tep.ts")` xác thực bằng hệ thống tệp NGOÀI kho — nên một con trỏ như
 * thế xanh trên máy này và đỏ trên CI, hoặc ngược lại. Một phép kiểm phụ thuộc máy là một phép
 * kiểm không nói được điều gì.
 */
function trongKho(duong: string): boolean {
  const tuyet = resolve(GOC, duong);
  return tuyet === resolve(GOC) || tuyet.startsWith(resolve(GOC) + sep);
}

/**
 * [lượt CI đầu tiên của vòng này] NGUỒN LÀ `git ls-files`, KHÔNG PHẢI ĐĨA — và đây là một phép đo,
 * không phải một sở thích.
 *
 * Bản trước hỏi `existsSync`. Nó XANH trên máy phát triển và **ĐỎ trên cả hai runner của CI**, vì
 * hai con trỏ vừa được "sửa" trong chính vòng này trỏ tới
 * `.superpowers/sdd/…/task-10-report.md` — tệp có thật trên đĩa của tôi và **không có trong kho**
 * (`.superpowers/sdd/.gitignore` là `*`). Tức P4 khi ấy đang đo CÁI ĐĨA CỦA NGƯỜI CHẠY NÓ, không
 * đo cái kho — đúng lớp khiếm khuyết mà review lượt 13 (H13-11) nêu ở dạng nhẹ hơn, và CI đưa ra
 * bản nặng hơn: một con trỏ chỉ giải được ở đúng một chỗ trên đời.
 *
 * Đọc tập tệp ĐƯỢC THEO DÕI cũng bịt luôn hai thứ khác: không còn lối thoát thư mục nào để mà lo
 * (mọi đường trong tập đều là đường tương đối trong kho), và không còn `readdirSync` nào chạy
 * trên một tên lấy từ tài liệu.
 */
const DUOC_THEO_DOI: ReadonlySet<string> = new Set(
  execFileSync("git", ["ls-files"], { cwd: GOC, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/)
    .filter((d) => d !== "")
    .map((d) => d.replace(/\\/g, "/")),
);

function giaiDuoc(duong: string): boolean {
  const sach = duong.replace(/\/$/, "");
  if (!trongKho(sach)) return false;
  if (!sach.includes("*")) {
    return DUOC_THEO_DOI.has(sach) || [...DUOC_THEO_DOI].some((t) => t.startsWith(`${sach}/`));
  }
  // [review lượt 13, H13-12] `new RegExp` dựng từ chuỗi trong tài liệu: một mẫu bắt đầu bằng `?`
  // làm nó NÉM `SyntaxError`. Hỏng ồn ào vẫn tốt hơn hỏng im, nhưng nó phải hỏng thành MỘT VI
  // PHẠM CÓ TÊN, không thành một stack trace ở giữa bộ test.
  let mau: RegExp;
  try {
    mau = new RegExp(`^${sach.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
  } catch {
    return false;
  }
  return [...DUOC_THEO_DOI].some((t) => mau.test(t));
}

function cacDuongTrong(o: string): readonly string[] {
  return [...o.matchAll(/`([^`]+)`/g)]
    .map((tok) => tok[1]!.split(":")[0]!.split(" ")[0]!.trim())
    .filter(laDuongDan);
}

export function viPhamConTro(state: string): readonly string[] {
  const loi: string[] = [];
  for (const d of docCacDong(state)) {
    // Đoạn đã GẠCH là nguyên văn đã bị bác bỏ — quy ước của kho là giữ nguyên chữ, nên đường dẫn
    // bên trong nó ĐƯỢC PHÉP chết. Đó chính là ý nghĩa của dấu gạch.
    const sach = d.conTro.replace(/~~[\s\S]*?~~/g, "");
    const song = cacDuongTrong(sach);
    for (const duong of song) {
      if (!giaiDuoc(duong)) {
        loi.push(`khoản ${d.so} (dòng ${d.dongTep}): con trỏ không giải được — ${duong}`);
      }
    }
    // [review lượt 13, H13-9] CỬA `~~` KHÔNG ĐƯỢC DÙNG ĐỂ LÀM IM MỘT CON TRỎ CHẾT. Nếu ô con trỏ
    // có một đường ĐÃ GẠCH thì nó phải còn ít nhất một đường CHƯA gạch — nếu không, cách "sửa"
    // rẻ nhất cho một con trỏ hỏng là gạch nó đi, và cổng vẫn xanh trên một dòng đã rỗng ruột.
    const daGach = cacDuongTrong(d.conTro.match(/~~[\s\S]*?~~/g)?.join(" ") ?? "");
    if (daGach.length > 0 && song.length === 0) {
      loi.push(
        `khoản ${d.so} (dòng ${d.dongTep}): con trỏ đã gạch (${daGach[0]!}) mà không còn đường sống nào`,
      );
    }
  }
  return loi;
}

// ---- P5 --------------------------------------------------------------------------------------
const DON_VI: Record<string, number> = {
  không: 0, một: 1, mốt: 1, hai: 2, ba: 3, bốn: 4, tư: 4, năm: 5, lăm: 5,
  sáu: 6, bảy: 7, tám: 8, chín: 9,
};

/** Đọc số đếm tiếng Việt 1–99. Trả `null` khi không đọc được — người gọi phải xử ca ấy. */
export function docSoTiengViet(chu: string): number | null {
  const t = chu.trim().toLowerCase().split(/\s+/);
  if (t.length === 1) return DON_VI[t[0]!] ?? null;
  if (t[0] === "mười") {
    const dv = DON_VI[t[1]!];
    return t.length === 2 && dv !== undefined ? 10 + dv : null;
  }
  if (t[1] === "mươi") {
    const chuc = DON_VI[t[0]!];
    if (chuc === undefined) return null;
    if (t.length === 2) return chuc * 10;
    const dv = DON_VI[t[2]!];
    return t.length === 3 && dv !== undefined ? chuc * 10 + dv : null;
  }
  return null;
}

/**
 * MỌI lời khai chưa bị gạch phải khớp số thật — không chỉ một.
 *
 * Lượt chạy đầu của phép kiểm này tìm ra vì sao vế *"mọi"* mới đúng: `docs/STATE.md` mang HAI lời
 * khai ở hai chỗ (mục *Cột mốc* và bảng *Tham chiếu*), **28** và **27**, tức chúng còn không khớp
 * NHAU. Một phép kiểm chỉ đọc lời khai đầu tiên sẽ xanh trên đúng tệp đang sai.
 */
/** Đọc một số đếm viết bằng CHỮ hoặc bằng CHỮ SỐ — `**28 ADR**` và `**hai mươi tám ADR**`. */
function docSo(chu: string): number | null {
  const t = chu.trim();
  return /^\d+$/.test(t) ? Number(t) : docSoTiengViet(t);
}

/**
 * [khoản nợ 61] Một lời khai ĐÃ CẬP NHẬT trong kho này luôn mang tiền tố vòng: `**[S1.28] 34 ADR**`.
 *
 * Không nhận tiền tố ấy thì mọi lời khai viết theo đúng quy ước của kho trở nên VÔ HÌNH với lớp
 * canh — tức lớp canh xanh trên đúng những dòng vừa được sửa. Đo được: cả bốn lời khai mà vòng
 * này đưa vào `Handoff.md` đều mang tiền tố, và không cái nào khớp mẫu cũ.
 */
const TIEN_TO_VONG = String.raw`(?:\[S[\d.]+\]\s*)?`;

/**
 * [khoản nợ 61] BỎ ĐOẠN MÃ TRƯỚC KHI ĐỌC — và đây là một phép đo, không phải một sở thích.
 *
 * Một `` `~~` `` viết trong đoạn mã là một dấu được TRÍCH DẪN, không phải một dấu đang gạch. Đo
 * ngày 2026-09-09, trước khi viết hàm này:
 *
 *   `Handoff.md`     : 89 dấu (**LẺ**) → bỏ đoạn mã còn **88** (chẵn)
 *   `docs/STATE.md`  : 344 dấu (chẵn) → bỏ đoạn mã còn **340** (chẵn)
 *
 * Tức `Handoff.md` KHÔNG có cặp gạch hở nào; số lẻ ấy hoàn toàn do MỘT `` `~~` `` ở §15, nằm
 * trong một đoạn mã đang **nói về chính cửa `~~` này**. (Số đếm ở trên là số đo TẠI `0a3cc6b`,
 * trước khi vòng này sửa hai tệp; tính chất thì không đổi — chênh lệch vẫn là một dấu trích dẫn
 * duy nhất. Cố ý KHÔNG ghi số dòng: một con trỏ dòng trong chú thích là thứ trôi ngay vòng sau.)
 * Và `docs/STATE.md` đang xanh vì số dấu
 * nằm trong đoạn mã của nó **tình cờ CHẴN** (bốn dấu) — một lần thêm hoặc bớt MỘT dấu trích dẫn
 * là cổng đỏ mà không có khiếm khuyết nào. Đây là chiều hỏng ĐẮT HƠN chiều nó đi bắt: một phép
 * kiểm đỏ oan sẽ bị nới ra, và nới xong thì nó không còn nói gì.
 *
 * Bỏ đoạn mã cũng làm phép cắt đoạn ĐÃ GẠCH đúng hơn: `/~~[\s\S]*?~~/` ghép nhầm cặp khi một dấu
 * trích dẫn xen vào giữa, và khi ấy một lời khai đang SỐNG rơi vào khoảng bị xoá.
 */
function boDoanMa(van: string): string {
  return van
    .replace(/```[\s\S]*?```/g, "")
    .replace(/``[^`]*``/g, "")
    .replace(/`[^`\n]*`/g, "");
}

/** Phần văn bản CÒN HIỆU LỰC: bỏ đoạn mã, rồi bỏ mọi khoảng đã gạch. */
function conHieuLuc(van: string): string {
  return boDoanMa(van).replace(/~~[\s\S]*?~~/g, "");
}

/**
 * [review lượt 13, H13-8] MỘT DẤU `~~` LẺ LÀM LỆCH MỌI CẶP PHÍA SAU.
 *
 * `docs/STATE.md` dùng `~~` hàng trăm lần, có đoạn gạch nhiều dòng. Một `~~` lẻ — kể cả do gõ
 * nhầm — dời mọi cặp sau nó đi một nhịp, và một lời khai đang SỐNG rơi vào một khoảng bị xoá ⇒
 * phép kiểm xanh trên đúng tệp đang sai. Rẻ nhất là đếm: số dấu phải CHẴN.
 *
 * [khoản nợ 61] Đếm trên văn bản ĐÃ BỎ ĐOẠN MÃ — xem `boDoanMa`.
 */
export function viPhamCapGach(van: string, nhan: string): readonly string[] {
  const n = (boDoanMa(van).match(/~~/g) ?? []).length;
  return n % 2 === 0
    ? []
    : [`${nhan} có ${n} dấu \`~~\` ngoài đoạn mã — số LẺ, tức có một cặp gạch hở`];
}

export function viPhamSoADR(van: string, quyetDinh: string, nhan: string): readonly string[] {
  const le = viPhamCapGach(van, nhan);
  if (le.length > 0) return le;
  const reADR = new RegExp(`\\*\\*${TIEN_TO_VONG}([a-zà-ỹ ]+|\\d+) ADR\\*\\*`, "gi");
  const khai = [...conHieuLuc(van).matchAll(reADR)];
  if (khai.length === 0) return [`không tìm thấy lời khai "**<số> ADR**" nào trong ${nhan}`];
  const that = (quyetDinh.match(/^## ADR-/gm) ?? []).length;
  const loi: string[] = [];
  for (const k of khai) {
    const so = docSo(k[1]!);
    if (so === null) loi.push(`không đọc được số đếm: ${JSON.stringify(k[1])}`);
    else if (so !== that) loi.push(`${nhan} khai ${so} ADR, docs/DECISIONS.md có ${that} đầu mục`);
  }
  return loi;
}

// ---- P6 --------------------------------------------------------------------------------------
/**
 * [review lượt 13, H13-4] LỜI KHAI *"Sổ đăng ký n bất biến"* — cùng hình dạng, cách lời khai ADR
 * ĐÚNG MỘT HÀNG BẢNG, và nó đang thiu ba đơn vị ở cả hai con số khi P5 được viết.
 *
 * Nguồn đếm được: số HÀNG của sổ đăng ký trong `docs/TEST-PLAN.md` — mỗi hàng mở đầu bằng một mã
 * `| **X9** |`. Nhóm `H` là hàng rào, `A`–`G` là nghiệp vụ.
 */
export function viPhamSoBatBien(van: string, testPlan: string, nhan: string): readonly string[] {
  const le = viPhamCapGach(van, nhan);
  if (le.length > 0) return le;
  const ma = [...testPlan.matchAll(/^\|\s*\*\*([A-H])(\d+)\*\*\s*\|/gm)].map((m) => m[1]!);
  const hangRao = ma.filter((n) => n === "H").length;
  const nghiepVu = ma.length - hangRao;
  const reBB = new RegExp(
    `\\*\\*${TIEN_TO_VONG}Sổ đăng ký (\\d+) bất biến\\*\\*` +
      String.raw`\s*\((\d+) nghiệp vụ \+ \*{0,2}(\d+)\*{0,2} hàng rào`,
    "g",
  );
  const khai = [...conHieuLuc(van).matchAll(reBB)];
  if (khai.length === 0) {
    return [
      `không tìm thấy lời khai "**Sổ đăng ký n bất biến** (x nghiệp vụ + y hàng rào" nào trong ${nhan}`,
    ];
  }
  const loi: string[] = [];
  for (const k of khai) {
    const [tong, nv, hr] = [Number(k[1]), Number(k[2]), Number(k[3])];
    if (tong !== ma.length || nv !== nghiepVu || hr !== hangRao) {
      loi.push(
        `${nhan} khai ${tong} (${nv} + ${hr}), sổ đăng ký có ` +
          `${ma.length} (${nghiepVu} + ${hangRao})`,
      );
    }
  }
  return loi;
}

// ---- P7 · P8 · P9 — `Handoff.md`, khoản nợ 61 -------------------------------------------------
//
// VÌ SAO P4 KHÔNG CHUYỂN SANG ĐƯỢC NGUYÊN XI, VÀ ĐÓ LÀ PHÁT HIỆN CỦA VÒNG NÀY.
//
// Cách đóng hiển nhiên là quét mọi đường dẫn trong đấu huyền của `Handoff.md` như P4 làm. **Đã
// đo trước khi viết: 121 con trỏ chưa gạch, 38 "không giải được" — và 36 trong 38 KHÔNG PHẢI
// LỖI.** Chúng là tên gói và tên team (`@testcontainers/postgresql`, `@trustprocure/bao-mat` —
// một team mà chính câu ấy nói CHƯA TỒN TẠI), đường HTTP (`/auth/link`), chuỗi phiên bản
// (`Chrome/151.0.7922.200`), một mẫu glob đang được TRÍCH (`*.sql` trong câu về `.gitattributes`),
// một QUY ƯỚC ĐẶT TÊN (`src/index.ts`), và một tệp mà câu văn nói thẳng là **không vào git**
// (`.superpowers/sdd/.gitignore`). Một phép kiểm sai 36 lần trong lượt chạy đầu không phải một
// phép kiểm: cách duy nhất làm nó xanh là một danh sách miễn trừ dài bằng chính danh sách phát
// hiện, và khi ấy nó là một DANH SÁCH, không phải một LỚP.
//
// Đọc lại P4 thì thấy nó chưa bao giờ quét văn xuôi: nó đọc **cột con trỏ của bảng sổ nợ** — một
// VỊ TRÍ ĐÃ KHAI. Nên chuyển P4 sang `Handoff.md` nghĩa là tìm những vị trí đã khai tương đương,
// không phải quét cả tệp. Có đúng một: bảng của §13 *Đọc gì, theo thứ tự*, cột đầu là tài liệu.
//
// Phần còn lại của khoản nợ 61 KHÔNG cần cơ chế mới. Ba con số mà `Handoff.md` khai là **bản sao
// của ba con số `[INV-H20]` ĐÃ suy ra được** cho `docs/STATE.md`, và cả ba đã trôi (đo 2026-09-09,
// trước khi sửa):
//
//   số ADR         : `Handoff.md` khai **mười tám**, `docs/DECISIONS.md` có **34**
//   số bất biến    : khai **47** (34 + 13),        sổ đăng ký có **55** (34 + 21)
//   số khoản nợ    : §13 khai **61 khoản, 14 mở**, sổ có **71 khoản, 14 mở**
//
// Đó đúng là thứ ADR-029 gọi tên: *một bản sao không được đối chiếu thì trôi*. Nên P7 và P8 KHÔNG
// phải hàm mới — chúng là `viPhamSoADR`/`viPhamSoBatBien` gọi trên một tệp thứ hai. Việc phải làm
// là tham số hoá cái NHÃN, không phải viết lại phép kiểm.

/** Số khoản nợ có trong bảng, và số khoản KHÔNG mang trạng thái `ĐÓNG`. */
function demSoNo(state: string): { readonly tong: number; readonly mo: number } {
  const dong = docCacDong(state);
  return { tong: dong.length, mo: dong.filter((d) => trangThaiCua(d) !== "ĐÓNG").length };
}

/** `**71 khoản, trong đó 14 còn mở**` và `**[S1.21] 61 khoản nợ, 14 còn mở**` — cùng một lời khai. */
const RE_KHOAN_NO = new RegExp(
  `\\*\\*${TIEN_TO_VONG}` + String.raw`(\d+) khoản(?: nợ)?,\s*(?:trong đó\s*)?(\d+) còn mở\*\*`,
  "g",
);

export function viPhamSoKhoanNo(van: string, state: string, nhan: string): readonly string[] {
  const le = viPhamCapGach(van, nhan);
  if (le.length > 0) return le;
  const khai = [...conHieuLuc(van).matchAll(RE_KHOAN_NO)];
  if (khai.length === 0) {
    return [`không tìm thấy lời khai "**<n> khoản, trong đó <m> còn mở**" nào trong ${nhan}`];
  }
  const { tong, mo } = demSoNo(state);
  const loi: string[] = [];
  for (const k of khai) {
    const [kTong, kMo] = [Number(k[1]), Number(k[2])];
    if (kTong !== tong || kMo !== mo) {
      loi.push(`${nhan} khai ${kTong} khoản / ${kMo} mở, sổ nợ có ${tong} khoản / ${mo} mở`);
    }
  }
  return loi;
}

/**
 * Ba con số về HÌNH DẠNG KHO, suy từ `git ls-files` — không phải từ đĩa (ADR-029 ⑺).
 *
 * Đo 2026-09-09: §3 khai *"Bảy migration"* trong khi có **48** tệp đánh số, và *"Bảy gói + hai
 * công cụ"* trong khi có **13** gói và **5** công cụ. Đây là lời khai trôi XA NHẤT của cả tệp.
 */
function hinhDangKho(): { readonly migration: number; readonly goi: number; readonly congCu: number } {
  const dem = (mau: RegExp): number => {
    const ten = new Set<string>();
    for (const t of DUOC_THEO_DOI) {
      const m = mau.exec(t);
      if (m !== null) ten.add(m[1]!);
    }
    return ten.size;
  };
  return {
    migration: dem(/^db\/migrations\/(\d+)_[^/]*\.sql$/),
    // Một GÓI là một thư mục TỰ KHAI mình là gói — nguồn chặt hơn "có tệp nào đó bên dưới", và
    // đo được: cả 13 thư mục con của `packages/` đều có `package.json`, nên hai cách cho cùng
    // một số HÔM NAY; cách này còn đúng vào cái ngày ai đó để một tệp lạc vào `packages/`.
    goi: dem(/^packages\/([^/]+)\/package\.json$/),
    // CÔNG CỤ thì KHÔNG dùng được tiêu chí ấy, và đây là một phép đo chứ không phải một ngoại lệ
    // cho tiện: `tools/bench-kms` và `tools/do-webcrypto` là một tệp `.mjs` trần, không có
    // `package.json` (3/5 công cụ có). Đếm theo thư mục là đúng thứ đang được đếm.
    congCu: dem(/^tools\/([^/]+)\//),
  };
}

const RE_MIGRATION = new RegExp(`\\*\\*${TIEN_TO_VONG}(\\d+) migration đánh số\\*\\*`, "g");
const RE_GOI_CONG_CU = new RegExp(
  `\\*\\*${TIEN_TO_VONG}(\\d+) gói \\+ (\\d+) công cụ\\*\\*`,
  "g",
);

export function viPhamHinhDangKho(van: string, nhan: string): readonly string[] {
  const le = viPhamCapGach(van, nhan);
  if (le.length > 0) return le;
  const song = conHieuLuc(van);
  const that = hinhDangKho();
  const loi: string[] = [];

  const kMig = [...song.matchAll(RE_MIGRATION)];
  if (kMig.length === 0) loi.push(`không tìm thấy lời khai "**<n> migration đánh số**" trong ${nhan}`);
  for (const k of kMig) {
    if (Number(k[1]) !== that.migration) {
      loi.push(`${nhan} khai ${k[1]} migration đánh số, kho có ${that.migration}`);
    }
  }

  const kGoi = [...song.matchAll(RE_GOI_CONG_CU)];
  if (kGoi.length === 0) loi.push(`không tìm thấy lời khai "**<n> gói + <m> công cụ**" trong ${nhan}`);
  for (const k of kGoi) {
    if (Number(k[1]) !== that.goi || Number(k[2]) !== that.congCu) {
      loi.push(
        `${nhan} khai ${k[1]} gói + ${k[2]} công cụ, kho có ${that.goi} gói + ${that.congCu} công cụ`,
      );
    }
  }
  return loi;
}

// ---- P10 — cột tài liệu của một bảng ĐÃ KHAI --------------------------------------------------

/**
 * Hàng DỮ LIỆU của bảng GFM đầu tiên trong một khối: mọi hàng SAU dòng ngăn cách.
 *
 * Dùng chính ngữ nghĩa của GFM (dòng ngăn cách chia đầu bảng với thân) thay vì đoán xem hàng nào
 * là tiêu đề. Không có dòng ngăn cách thì NÉM — cùng lý do `khoiMuc` ném.
 */
function hangDuLieu(
  dong: readonly string[],
  nhan: string,
): readonly { readonly viTri: number; readonly van: string }[] {
  const nganCach = dong.findIndex((l) => O_NGAN_CACH.test(l.trim()));
  if (nganCach < 0) throw new Error(`${nhan}: khối này không có bảng nào (thiếu dòng ngăn cách)`);
  const ra: { viTri: number; van: string }[] = [];
  // DỪNG ở dòng đầu tiên không phải hàng bảng, thay vì lọc cả khối. Lọc cả khối thì một bảng THỨ
  // HAI trong cùng mục sẽ bị kéo vào — kể cả hàng TIÊU ĐỀ của nó, thứ không có con trỏ nào — và
  // cổng đỏ oan. Một phép kiểm đỏ oan sẽ bị nới, và nới xong thì nó không còn nói gì.
  for (let i = nganCach + 1; i < dong.length; i += 1) {
    const t = dong[i]!.trim();
    if (!t.startsWith("|")) break;
    ra.push({ viTri: i, van: t });
  }
  return ra;
}

/**
 * [khoản nợ 61] MỌI HÀNG CỦA BẢNG §13 PHẢI TRỎ TỚI MỘT TỆP GIẢI ĐƯỢC TRONG TẬP GIT THEO DÕI.
 *
 * Đây là P4 áp lên vị trí tương đương ở tệp thứ hai — một CỘT ĐÃ KHAI, không phải văn xuôi. Đo
 * trước khi sửa: một hàng trỏ tới `docs/superpowers/specs/2026-08-26-…-design.md`, trong đó `…`
 * là một chỗ lược bằng mắt người; tệp thật tên `2026-08-26-trustprocure-s0-s1-design.md`.
 *
 * Vế *"mọi hàng phải cho ra ít nhất một đường"* là phần fail-closed, và nó học từ P0: một hàng
 * mất con trỏ mà vẫn được coi là hợp lệ thì cách rẻ nhất để làm xanh một hàng hỏng là **xoá con
 * trỏ của nó**.
 */
export function viPhamConTroTaiLieu(van: string, tieuDe: string, nhan: string): readonly string[] {
  const { dong, tuDong } = khoiMuc(van, tieuDe, nhan);
  const hang = hangDuLieu(dong, nhan);
  const loi: string[] = [];
  for (const { viTri, van } of hang) {
    const soDong = tuDong + viTri;
    const o = cacO(van);
    const sach = (o[0] ?? "").replace(/~~[\s\S]*?~~/g, "");
    const duong = cacDuongTrong(sach);
    if (duong.length === 0) {
      loi.push(`${nhan} dòng ${soDong}: hàng bảng không có con trỏ SỐNG nào — ${van.slice(0, 60)}`);
      continue;
    }
    for (const d of duong) {
      if (!giaiDuoc(d)) loi.push(`${nhan} dòng ${soDong}: con trỏ không giải được — ${d}`);
    }
  }
  if (hang.length === 0) loi.push(`${nhan}: bảng của "${tieuDe}" không có hàng dữ liệu nào`);
  return loi;
}

// ==============================================================================================

const STATE = docTep("docs/STATE.md");
const QUYET_DINH = docTep("docs/DECISIONS.md");
const TEST_PLAN = docTep("docs/TEST-PLAN.md");
const HANDOFF = docTep("Handoff.md");
const TIEU_DE_DOC_GI = "## 13. Đọc gì, theo thứ tự";

/** Đổi đúng MỘT chỗ trong văn bản thật, và ném nếu chỗ ấy không có — đột biến phải TRÚNG. */
function dotBien(goc: string, cu: string, moi: string): string {
  const dem = goc.split(cu).length - 1;
  if (dem !== 1) throw new Error(`neo đột biến khớp ${dem} lần, phải là 1: ${cu.slice(0, 60)}`);
  return goc.replace(cu, moi);
}

describe("[INV-H20] sổ nợ tự đối chiếu", () => {
  it("P0 — mọi hàng bảng trong khối sổ nợ đều được bộ đọc NHẬN", () => {
    expect(viPhamNhanDien(STATE)).toEqual([]);
  });

  it("P0 đột biến — một dòng nợ thụt vào MỘT dấu cách (GFM vẫn dựng bảng) thì ĐỎ", () => {
    const cuoi = docCacDong(STATE).at(-1)!;
    const neo = `| ${cuoi.so} | ${cuoi.than} | ${cuoi.conTro} |`;
    const hong = dotBien(STATE, neo, `${neo}\n | 62 | **[MỞ]** một khoản vô hình | \`Handoff.md\` |`);
    expect(viPhamNhanDien(hong)).toHaveLength(1);
    // và đây là điều làm nó đắt: bốn phép kiểm kia KHÔNG thấy gì cả.
    expect([
      viPhamHinhDang(hong),
      viPhamKhaiTrangThai(hong),
      viPhamHaiCachDem(hong),
      viPhamConTro(hong),
    ]).toEqual([[], [], [], []]);
  });

  it("P1 — mọi dòng sổ nợ có đúng ba cột", () => {
    expect(viPhamHinhDang(STATE)).toEqual([]);
  });

  it("P1 đột biến — bỏ cột con trỏ của một dòng thì ĐỎ (đúng hình dạng lỗi của dòng 59)", () => {
    const dong = docCacDong(STATE).at(-1)!;
    const cu = `| ${dong.so} | ${dong.than} | ${dong.conTro} |`;
    expect(viPhamHinhDang(dotBien(STATE, cu, `| ${dong.so} | ${dong.than}`))).toHaveLength(1);
  });

  it("P2 — mọi dòng khai trạng thái, và nhãn đứng ở đầu thân", () => {
    expect(viPhamKhaiTrangThai(STATE)).toEqual([]);
  });

  it("P2 đột biến — gỡ nhãn của một dòng thì ĐỎ", () => {
    const dong = docCacDong(STATE)[0]!;
    const nhan = `**[${trangThaiCua(dong)}]** `;
    expect(viPhamKhaiTrangThai(dotBien(STATE, `| ${dong.so} | ${nhan}`, `| ${dong.so} | `)))
      .toHaveLength(1);
  });

  it("P3 — tập khoản MỞ/NỬA suy từ bảng bằng đúng dòng tổng kết", () => {
    expect(viPhamHaiCachDem(STATE)).toEqual([]);
  });

  it("P3 đột biến CHIỀU KHAI THIẾU — đóng một khoản trong bảng mà quên sửa dòng tổng kết thì ĐỎ", () => {
    const mo = docCacDong(STATE).find((d) => trangThaiCua(d) === "MỞ")!;
    const hong = dotBien(STATE, `| ${mo.so} | **[MỞ]** `, `| ${mo.so} | **[ĐÓNG]** `);
    expect(viPhamHaiCachDem(hong)).toEqual([
      `dòng tổng kết kể nhưng bảng khai ĐÓNG: ${mo.so}`,
    ]);
  });

  it("P3 đột biến CHIỀU KHAI THỪA — mở một khoản trong bảng mà quên sửa dòng tổng kết thì ĐỎ", () => {
    const dong = docCacDong(STATE).find((d) => trangThaiCua(d) === "ĐÓNG")!;
    const hong = dotBien(STATE, `| ${dong.so} | **[ĐÓNG]** `, `| ${dong.so} | **[MỞ]** `);
    expect(viPhamHaiCachDem(hong)).toEqual([
      `bảng khai MỞ/NỬA nhưng dòng tổng kết KHÔNG kể: ${dong.so}`,
    ]);
  });

  it("P4 — mọi con trỏ chưa bị gạch đều giải được TRONG TẬP TỆP GIT THEO DÕI", () => {
    expect(viPhamConTro(STATE)).toEqual([]);
  });

  it("P4 đột biến — một con trỏ trỏ tới tệp đã xoá thì ĐỎ (đúng ca dòng 55)", () => {
    const dong = docCacDong(STATE).find((d) => d.conTro.includes("`packages/"))!;
    const hong = dotBien(STATE, dong.conTro, "`packages/khong-he-ton-tai/src/mo-hoi.ts`");
    expect(viPhamConTro(hong)).toHaveLength(1);
  });

  it("P5 — số ADR khai ở STATE bằng số đầu mục ADR ở sổ quyết định", () => {
    expect(viPhamSoADR(STATE, QUYET_DINH, "docs/STATE.md")).toEqual([]);
  });

  it("P5 đột biến — thêm một ADR mà quên sửa con số thì ĐỎ ở MỌI lời khai", () => {
    const them = `${QUYET_DINH}\n## ADR-999 — một quyết định không có ai đếm\n`;
    const loi = viPhamSoADR(STATE, them, "docs/STATE.md");
    const soMoi = (them.match(/^## ADR-/gm) ?? []).length;
    // `docs/STATE.md` mang HAI lời khai (mục *Cột mốc* và bảng *Tham chiếu*). Mũi này khẳng định
    // cả hai cùng ĐỎ — vì đúng chiều hỏng đã xảy ra hai lần là *một* trong hai bị bỏ quên.
    expect(loi.length).toBeGreaterThanOrEqual(2);
    expect(loi.every((l) => l.includes(`có ${soMoi} đầu mục`))).toBe(true);
  });

  it("P1 đột biến — hai dòng cùng một số khoản thì ĐỎ", () => {
    const cuoi = docCacDong(STATE).at(-1)!;
    const neo = `| ${cuoi.so} | ${cuoi.than} | ${cuoi.conTro} |`;
    const hong = dotBien(STATE, neo, `${neo}\n| ${cuoi.so} | **[ĐÓNG]** bản sao | \`Handoff.md\` |`);
    expect(viPhamHinhDang(hong)).toEqual([`khoản ${cuoi.so}: xuất hiện 2 lần, phải là đúng 1`]);
  });

  it("P4 đột biến — GẠCH một con trỏ chết thay vì thay nó thì vẫn ĐỎ", () => {
    const dong = docCacDong(STATE).find((d) => cacDuongTrong(d.conTro).length === 1)!;
    const hong = dotBien(STATE, `| ${dong.conTro} |`, `| ~~${dong.conTro}~~ |`);
    expect(viPhamConTro(hong)).toHaveLength(1);
    expect(viPhamConTro(hong)[0]).toContain("không còn đường sống nào");
  });

  it("P5 đột biến — một dấu ~~ LẺ làm lệch mọi cặp gạch phía sau, và nó phải ĐỎ", () => {
    const hong = dotBien(STATE, "## Nợ kỹ thuật", "## Nợ kỹ thuật ~~");
    expect(viPhamCapGach(hong, "docs/STATE.md")).toHaveLength(1);
    expect(viPhamSoADR(hong, QUYET_DINH, "docs/STATE.md")).toEqual(
      viPhamCapGach(hong, "docs/STATE.md"),
    );
  });

  it("P6 — số bất biến khai ở STATE bằng số HÀNG của sổ đăng ký ở TEST-PLAN", () => {
    expect(viPhamSoBatBien(STATE, TEST_PLAN, "docs/STATE.md")).toEqual([]);
  });

  it("P6 đột biến — thêm một hàng vào sổ đăng ký mà quên sửa con số thì ĐỎ", () => {
    const them = `${TEST_PLAN}\n| **H99** | một hàng rào không ai đếm | \`x.ts\` | **T1** |\n`;
    const loi = viPhamSoBatBien(STATE, them, "docs/STATE.md");
    expect(loi).toHaveLength(1);
    // Con số phải SUY từ chính `them`, không chép tay: bản trước ghim "55 (34 + 21)" và nó ĐỎ ở
    // đúng vòng sau, khi sổ đăng ký lớn thêm một hàng — cùng lớp lỗi mà tệp này đi đóng.
    const soHang = (them.match(/^\|\s*\*\*[A-H]\d+\*\*\s*\|/gm) ?? []).length;
    const soHangRao = (them.match(/^\|\s*\*\*H\d+\*\*\s*\|/gm) ?? []).length;
    expect(loi[0]).toContain(`sổ đăng ký có ${soHang} (${soHang - soHangRao} + ${soHangRao})`);
  });

  it("P5 — bộ đọc số đếm tiếng Việt đọc đúng cả bốn dạng đã từng xuất hiện ở STATE", () => {
    expect([
      docSoTiengViet("chín"),
      docSoTiengViet("mười hai"),
      docSoTiengViet("mười chín"),
      docSoTiengViet("hai mươi tám"),
      docSoTiengViet("hai mươi lăm"),
      docSoTiengViet("ba mươi"),
      docSoTiengViet("không phải số"),
    ]).toEqual([9, 12, 19, 28, 25, 30, null]);
  });

  // ---- khoản nợ 61 — `Handoff.md` vào tầm -----------------------------------------------------

  it("cửa `~~` — dấu TRÍCH DẪN trong đoạn mã không làm đỏ, dấu THẬT thì có", () => {
    // Chiều ĐỎ OAN trước, vì nó là chiều đắt hơn: một phép kiểm đỏ oan sẽ bị nới, và nới xong
    // thì nó không còn nói gì. Đo được: `Handoff.md` có một `` `~~` `` trong một đoạn mã đang
    // NÓI VỀ chính cửa này, và đếm thô cho ra số LẺ dù không có cặp nào hở.
    const trichDan = dotBien(HANDOFF, "## 1. Một câu", "## 1. Một câu\n\nVí dụ: `~~` là dấu gạch.");
    expect(viPhamCapGach(trichDan, "Handoff.md")).toEqual([]);
    expect(viPhamCapGach(dotBien(STATE, "## Nợ kỹ thuật", "## Nợ kỹ thuật\n\n`~~`"), "docs/STATE.md"))
      .toEqual([]);

    // …và chiều ĐỎ THẬT vẫn nguyên: một dấu ngoài đoạn mã là một cặp hở.
    expect(viPhamCapGach(dotBien(HANDOFF, "## 1. Một câu", "## 1. Một câu ~~"), "Handoff.md"))
      .toHaveLength(1);
  });

  it("P7 — số ADR khai ở `Handoff.md` bằng số đầu mục ADR ở sổ quyết định", () => {
    expect(viPhamSoADR(HANDOFF, QUYET_DINH, "Handoff.md")).toEqual([]);
  });

  it("P7 đột biến — thêm một ADR mà quên sửa `Handoff.md` thì ĐỎ", () => {
    const them = `${QUYET_DINH}\n## ADR-999 — một quyết định không có ai đếm\n`;
    const loi = viPhamSoADR(HANDOFF, them, "Handoff.md");
    expect(loi).toHaveLength(1);
    expect(loi[0]).toContain(`có ${(them.match(/^## ADR-/gm) ?? []).length} đầu mục`);
  });

  it("P7 đột biến — XOÁ lời khai để làm im cổng thì vẫn ĐỎ", () => {
    const m = /\*\*(\[S[\d.]+\] \d+ ADR)\*\*/.exec(HANDOFF)!;
    expect(viPhamSoADR(dotBien(HANDOFF, m[0], m[1]!), QUYET_DINH, "Handoff.md")).toEqual([
      'không tìm thấy lời khai "**<số> ADR**" nào trong Handoff.md',
    ]);
  });

  it("P8 — số bất biến khai ở `Handoff.md` bằng số HÀNG của sổ đăng ký", () => {
    expect(viPhamSoBatBien(HANDOFF, TEST_PLAN, "Handoff.md")).toEqual([]);
  });

  it("P8 đột biến — thêm một hàng sổ đăng ký mà quên sửa `Handoff.md` thì ĐỎ", () => {
    const them = `${TEST_PLAN}\n| **H99** | một hàng rào không ai đếm | \`x.ts\` | **T1** |\n`;
    const loi = viPhamSoBatBien(HANDOFF, them, "Handoff.md");
    expect(loi).toHaveLength(1);
    const soHang = (them.match(/^\|\s*\*\*[A-H]\d+\*\*\s*\|/gm) ?? []).length;
    expect(loi[0]).toContain(`sổ đăng ký có ${soHang}`);
  });

  it("P9 — số khoản nợ khai ở `Handoff.md` bằng bảng sổ nợ của STATE", () => {
    expect(viPhamSoKhoanNo(HANDOFF, STATE, "Handoff.md")).toEqual([]);
  });

  it("P9 đột biến — đóng một khoản trong sổ mà quên sửa `Handoff.md` thì ĐỎ ở MỌI lời khai", () => {
    const mo = docCacDong(STATE).find((d) => trangThaiCua(d) === "MỞ")!;
    const hong = dotBien(STATE, `| ${mo.so} | **[MỞ]** `, `| ${mo.so} | **[ĐÓNG]** `);
    const loi = viPhamSoKhoanNo(HANDOFF, hong, "Handoff.md");
    // `Handoff.md` mang lời khai này ở HAI chỗ (§10 và §13). Mũi này khẳng định CẢ HAI cùng đỏ —
    // đúng vế ⑷ của ADR-029: mọi lời khai, không phải lời khai đầu tiên.
    expect(loi.length).toBeGreaterThanOrEqual(2);
    const { tong, mo: soMo } = demSoNo(hong);
    expect(loi.every((l) => l.includes(`sổ nợ có ${tong} khoản / ${soMo} mở`))).toBe(true);
  });

  it("P9 đột biến — XOÁ mọi lời khai số khoản nợ thì vẫn ĐỎ", () => {
    const hong = HANDOFF.replace(/\*\*(\[S[\d.]+\]\s*)?(\d+) khoản/g, "$1$2 khoản");
    expect(viPhamSoKhoanNo(hong, STATE, "Handoff.md")).toHaveLength(1);
  });

  it("P9b — số migration / gói / công cụ khai ở `Handoff.md` suy từ `git ls-files`", () => {
    expect(viPhamHinhDangKho(HANDOFF, "Handoff.md")).toEqual([]);
  });

  it("P9b đột biến — khai thiếu MỘT migration thì ĐỎ, và con số ĐỐI CHỨNG suy từ kho", () => {
    const khai = /\*\*\[S[\d.]+\] (\d+) migration đánh số\*\*/.exec(HANDOFF)![1]!;
    const hong = dotBien(HANDOFF, `${khai} migration đánh số`, `${Number(khai) - 1} migration đánh số`);
    const loi = viPhamHinhDangKho(hong, "Handoff.md");
    expect(loi).toHaveLength(1);
    expect(loi[0]).toContain(`kho có ${khai}`);
  });

  it("P9b đột biến — XOÁ lời khai gói/công cụ thì vẫn ĐỎ", () => {
    const m = /\*\*(\[S[\d.]+\] \d+ gói \+ \d+ công cụ)\*\*/.exec(HANDOFF)!;
    const loi = viPhamHinhDangKho(dotBien(HANDOFF, m[0], m[1]!), "Handoff.md");
    expect(loi).toHaveLength(1);
    expect(loi[0]).toContain("không tìm thấy lời khai");
  });

  it("P10 — mọi hàng bảng §13 của `Handoff.md` trỏ tới một tệp GIT THEO DÕI", () => {
    expect(viPhamConTroTaiLieu(HANDOFF, TIEU_DE_DOC_GI, "Handoff.md")).toEqual([]);
  });

  it("P10 đột biến — một hàng trỏ tới tệp không tồn tại thì ĐỎ", () => {
    const hong = dotBien(HANDOFF, "| `docs/PRODUCT.md` |", "| `docs/khong-he-co.md` |");
    const loi = viPhamConTroTaiLieu(hong, TIEU_DE_DOC_GI, "Handoff.md");
    expect(loi).toHaveLength(1);
    expect(loi[0]).toContain("con trỏ không giải được — docs/khong-he-co.md");
  });

  it("P10 đột biến — GỠ con trỏ khỏi một hàng, cách 'sửa' rẻ nhất, thì vẫn ĐỎ", () => {
    const hong = dotBien(HANDOFF, "| `docs/PRODUCT.md` |", "| PRODUCT |");
    const loi = viPhamConTroTaiLieu(hong, TIEU_DE_DOC_GI, "Handoff.md");
    expect(loi).toHaveLength(1);
    expect(loi[0]).toContain("không có con trỏ SỐNG nào");
  });

  it("P10 — một bảng THỨ HAI trong cùng mục KHÔNG bị kéo vào (chiều đỏ oan)", () => {
    // Bản đầu của `hangDuLieu` lọc MỌI dòng bắt đầu bằng `|` trong cả khối, nên một bảng thứ
    // hai — kể cả hàng TIÊU ĐỀ của nó, thứ không có con trỏ nào — bị đọc như hàng dữ liệu và
    // cổng đỏ mà không có khiếm khuyết nào. Mũi này giữ bản vá *dừng ở cuối bảng thứ nhất*.
    const cuoi = HANDOFF.split("\n").find((l) => l.includes("trustprocure-s0-s1-design.md"))!;
    const hong = dotBien(HANDOFF, cuoi, `${cuoi}\n\n| Cột | Cột |\n|---|---|\n| không phải con trỏ | gì cả |`);
    expect(viPhamConTroTaiLieu(hong, TIEU_DE_DOC_GI, "Handoff.md")).toEqual([]);
  });

  it("P10 đột biến — đổi tên mục §13 thì NÉM, không xanh trên một khối rỗng", () => {
    const hong = dotBien(HANDOFF, TIEU_DE_DOC_GI, "## 13. Doc gi theo thu tu");
    expect(() => viPhamConTroTaiLieu(hong, TIEU_DE_DOC_GI, "Handoff.md")).toThrow(/không tìm thấy/);
  });
});
