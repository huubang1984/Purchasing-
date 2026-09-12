// ==============================================================================================
// [S1.66 / lượt soi ngang 59b-5] MỌI TỆP GIT THEO DÕI LÀ VĂN BẢN VỚI GIT — TRỪ DANH SÁCH NHỊ PHÂN ĐÃ KHAI
//
// Khoản 10 (S1.63) đo được: một byte NUL thô làm Git phân loại tệp là nhị phân (`git ls-files --eol` báo `-text`), và ripgrep
// quét theo thư mục bỏ qua tệp ấy. Vế ⑵ của test khoản 10 (`xuong-dong-ts.test.ts`) chỉ đòi điều đó cho tệp TypeScript, và ⑶ của
// nó cố ý để `.md`, `.json`, `.yml` không ghim. Người soi 59b chỉ ra lớp rộng hơn: một tệp cấu hình mang NUL thì `git log -p` không
// in nội dung, nên bước quét bí mật theo lịch sử git ở T0 nhiều khả năng cũng không đọc nó — SUY LUẬN về cách gitleaks đọc lịch sử,
// chưa đo trên gitleaks. Thứ đo được hôm nay: kho không có tệp nào mà Git gọi là nhị phân (`git ls-files --eol`, 0 dòng `-text`).
// Cổng này giữ tính chất ấy — một tệp nhị phân mới là một quyết định nhìn thấy được, kèm lý do, không phải một điểm mù lặng lẽ.
//
// [S1.66 / lượt soi 60a-6] Hai đường, không một. Git gọi một tệp là nhị phân theo NỘI DUNG (`ls-files --eol`) và theo THUỘC TÍNH:
// `binary`, `-diff`, `-text`, hay một bộ diff tuỳ biến trong `.gitattributes`. Một dòng `*.pem binary` làm `git log -p` in "Binary files
// … differ" cho một tệp VĂN BẢN, trong khi `ls-files --eol` vẫn báo `i/lf w/lf` (đọc tài liệu Git; phần gitleaks vẫn là suy luận). Hôm
// nay `.gitattributes` chỉ đặt `text` cho `*.sql`, `*.ts` và `evidence/INV-matrix.md`.
// ==============================================================================================
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));
const TAB = String.fromCharCode(9);
const NUL = String.fromCharCode(0);
const TRAN_DAU_RA = 64 * 1024 * 1024;

/** Tệp được phép là nhị phân với Git — theo nội dung hay theo thuộc tính — kèm lý do. RỖNG là trạng thái đo được ở S1.66. */
const NHI_PHAN_DA_KHAI: Readonly<Record<string, string>> = {};

interface DongEol {
  readonly duong: string;
  readonly i: string;
  readonly w: string;
}

/** Đọc đầu ra `git ls-files --eol`: `i/<x> w/<y> attr/<z>` rồi TAB rồi đường dẫn. */
export function docDongEol(van: string): readonly DongEol[] {
  return van
    .split(String.fromCharCode(10))
    .map((d) => (d.endsWith(String.fromCharCode(13)) ? d.slice(0, -1) : d))
    .filter((d) => d.includes(TAB))
    .map((d) => {
      const tab = d.indexOf(TAB);
      const thongTin = d.slice(0, tab).split(" ").filter((x) => x !== "");
      const truong = (tien: string): string => thongTin.find((x) => x.startsWith(tien))?.slice(tien.length) ?? "?";
      return { duong: d.slice(tab + 1), i: truong("i/"), w: truong("w/") };
    });
}

/** Mọi tệp mà chỉ mục HAY cây làm việc của Git gọi là nhị phân, trừ tệp đã khai. */
export function tepNhiPhanChuaKhai(dong: readonly DongEol[], khai: Readonly<Record<string, string>>): readonly string[] {
  return dong.filter((e) => (e.i === "-text" || e.w === "-text") && !(e.duong in khai)).map((e) => `${e.duong}: i/${e.i} w/${e.w}`);
}

/** Dòng khai trỏ tới một tệp không còn được theo dõi. */
export function dongKhaiThiu(dong: readonly DongEol[], khai: Readonly<Record<string, string>>): readonly string[] {
  const theoDoi = new Set(dong.map((e) => e.duong));
  return Object.keys(khai).filter((t) => !theoDoi.has(t));
}

interface DongThuocTinh {
  readonly duong: string;
  readonly thuocTinh: string;
  readonly giaTri: string;
}

/** Đọc đầu ra `git check-attr -z --stdin <thuộc tính…>`: từng bộ ba ngăn bởi NUL — đường dẫn, thuộc tính, giá trị. */
export function docCheckAttrZ(van: string): readonly DongThuocTinh[] {
  const phan = van.split(NUL);
  const kq: DongThuocTinh[] = [];
  for (let i = 0; i + 2 < phan.length; i += 3) kq.push({ duong: phan[i]!, thuocTinh: phan[i + 1]!, giaTri: phan[i + 2]! });
  return kq;
}

/** Thuộc tính làm Git giấu nội dung của một tệp khi hiện diff và log: `binary`, `-text`, `-diff` hay một bộ diff tuỳ biến — trừ tệp đã khai. */
export function thuocTinhGiauNoiDung(dong: readonly DongThuocTinh[], khai: Readonly<Record<string, string>>): readonly string[] {
  return dong
    .filter(
      (d) =>
        ((d.thuocTinh === "binary" && d.giaTri === "set") ||
          (d.thuocTinh === "text" && d.giaTri === "unset") ||
          (d.thuocTinh === "diff" && d.giaTri !== "unspecified" && d.giaTri !== "set")) &&
        !(d.duong in khai),
    )
    .map((d) => `${d.duong}: ${d.thuocTinh}=${d.giaTri}`);
}

const DONG_THAT = docDongEol(execFileSync("git", ["ls-files", "--eol"], { cwd: GOC, encoding: "utf8", maxBuffer: TRAN_DAU_RA }));
const TEP_THEO_DOI = execFileSync("git", ["ls-files", "-z"], { cwd: GOC, encoding: "utf8", maxBuffer: TRAN_DAU_RA })
  .split(NUL)
  .filter((t) => t !== "");
const THUOC_TINH_THAT = docCheckAttrZ(
  execFileSync("git", ["check-attr", "-z", "--stdin", "binary", "diff", "text"], {
    cwd: GOC,
    encoding: "utf8",
    input: TEP_THEO_DOI.join(NUL),
    maxBuffer: TRAN_DAU_RA,
  }),
);

describe("[S1.66 / lượt soi ngang 59b-5] tệp git theo dõi là văn bản với Git", () => {
  it("bộ đọc không rỗng ruột — thấy đủ tệp theo dõi, gồm cả tệp không phải TypeScript", () => {
    expect(DONG_THAT.length).toBeGreaterThan(200);
    expect(DONG_THAT.map((e) => e.duong)).toEqual(expect.arrayContaining(["docs/STATE.md", ".github/workflows/ci.yml", "package.json"]));
  });

  it("không tệp theo dõi nào là nhị phân với Git, ngoài danh sách đã khai (rỗng)", () => {
    expect(tepNhiPhanChuaKhai(DONG_THAT, NHI_PHAN_DA_KHAI)).toEqual([]);
  });

  it("mọi dòng của danh sách khai trỏ tới một tệp đang được theo dõi — khai thiu thì đỏ", () => {
    expect(dongKhaiThiu(DONG_THAT, NHI_PHAN_DA_KHAI)).toEqual([]);
  });

  it("đối chứng trên văn bản giả: i/-text và w/-text đều bị nêu (từng vế riêng), trừ khi khai; tệp văn bản thường thì không; dòng kết thúc CR đọc đúng đường dẫn; dòng khai thiu bị nêu", () => {
    const CR = String.fromCharCode(13);
    const gia = docDongEol(
      [
        `i/lf    w/lf    attr/                 ${TAB}docs/binh-thuong.md`,
        `i/-text w/-text attr/                 ${TAB}config/mang-nul.json`,
        `i/lf    w/-text attr/                 ${TAB}config/cay-lam-viec-nul.yml${CR}`,
        `i/-text w/lf    attr/                 ${TAB}config/chi-muc-nul.toml`,
        `i/-text w/-text attr/                 ${TAB}assets/da-khai.png`,
      ].join(String.fromCharCode(10)),
    );
    expect(gia).toHaveLength(5);
    const khai = { "assets/da-khai.png": "ảnh — nhị phân có chủ đích", "assets/da-xoa.png": "khai thiu" };
    expect(tepNhiPhanChuaKhai(gia, khai)).toEqual([
      "config/mang-nul.json: i/-text w/-text",
      "config/cay-lam-viec-nul.yml: i/lf w/-text",
      "config/chi-muc-nul.toml: i/-text w/lf",
    ]);
    expect(dongKhaiThiu(gia, khai)).toEqual(["assets/da-xoa.png"]);
  });

  it("[lượt soi 60a-6] bộ đọc thuộc tính không rỗng ruột — đủ ba thuộc tính cho mọi tệp theo dõi, và thấy `text` đặt cho tệp `.ts`", () => {
    expect(TEP_THEO_DOI.length).toBeGreaterThan(200);
    expect(THUOC_TINH_THAT).toHaveLength(TEP_THEO_DOI.length * 3);
    expect(THUOC_TINH_THAT.some((d) => d.duong.endsWith(".ts") && d.thuocTinh === "text" && d.giaTri === "set")).toBe(true);
  });

  it("[lượt soi 60a-6] không tệp theo dõi nào mang thuộc tính giấu nội dung (`binary`, `-text`, `-diff`, bộ diff tuỳ biến), ngoài danh sách đã khai", () => {
    expect(thuocTinhGiauNoiDung(THUOC_TINH_THAT, NHI_PHAN_DA_KHAI)).toEqual([]);
  });

  it("[lượt soi 60a-6] đối chứng thuộc tính trên văn bản giả: binary, -text, -diff và bộ diff tuỳ biến đều bị nêu, trừ khi khai; text đặt hay không nêu thì không", () => {
    const bo = (duong: string, thuocTinh: string, giaTri: string): string => [duong, thuocTinh, giaTri].join(NUL);
    const gia = docCheckAttrZ(
      [
        bo("khoa.pem", "binary", "set"),
        bo("khoa.pem", "text", "unset"),
        bo("khoa.pem", "diff", "unset"),
        bo("anh.jpg", "diff", "exif"),
        bo("ma.ts", "text", "set"),
        bo("ma.ts", "diff", "unspecified"),
        bo("ma.ts", "binary", "unspecified"),
        bo("logo.png", "binary", "set"),
      ].join(NUL) + NUL,
    );
    expect(gia).toHaveLength(8);
    expect(thuocTinhGiauNoiDung(gia, { "logo.png": "ảnh — nhị phân có chủ đích" })).toEqual([
      "khoa.pem: binary=set",
      "khoa.pem: text=unset",
      "khoa.pem: diff=unset",
      "anh.jpg: diff=exif",
    ]);
  });
});
