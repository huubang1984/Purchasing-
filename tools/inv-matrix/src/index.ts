// =============================================================================================
// BỘ SINH MA TRẬN BẤT BIẾN VÀ EVIDENCE PACK
//
// `evidence/INV-matrix.md` KHÔNG phải một báo cáo tiện tay: nó là BẰNG CHỨNG KIỂM TOÁN, cùng
// hạng với một file `.sql` hay tên một test. Mọi ô trong nó phải đúng nghĩa đen. Dự án này đã
// bắt MƯỜI TÁM câu phát biểu rộng hơn thứ được đo, và BA CÂU CUỐI CÙNG nằm trong chính tài sản
// đem đi trình cho kiểm toán viên: câu thứ mười sáu là một nhãn `[INV-B2]` gắn lên một test đo
// B3; câu thứ mười bảy là ô ✅ của `D1` (mệnh đề HỘI bốn vế, hai vế chưa có một dòng mã nào);
// câu thứ mười tám là dòng §3 dưới đây tự nói rằng danh sách "không bao giờ nở ra trong im
// lặng" trong khi hai mũi đo được cho thấy nó nở ra được. Cả ba đã bị sửa, không bị xoá dấu.
//
// HAI FILE, HAI BẢN CHẤT KHÁC NHAU — ĐÂY LÀ MỘT QUYẾT ĐỊNH, KHÔNG PHẢI TIỆN TAY:
//   evidence/INV-matrix.md    TẤT ĐỊNH, vào git. Không SHA, không dấu thời gian. Nhờ vậy
//                             `pnpm evidence:check` mới so được file đã commit với lần sinh
//                             lại — nếu file mang `new Date().toISOString()` thì nó đổi MỖI
//                             LẦN CHẠY và phép kiểm ấy là bất khả, trong khi `.gitignore` lại
//                             GIỮ file này nên một lần sửa tay sẽ không lớp nào bắt.
//   evidence/run-metadata.md  MỖI LƯỢT MỘT KHÁC, không vào git, tải lên như artefact CI.
//                             Đây là nơi giữ XUẤT XỨ: commit SHA, thời điểm, tổng số khẳng định.
// =============================================================================================

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  MA_DUOC_PHEP_CHUA_PHU,
  MOC_GHIM,
  PHAM_VI_HEP,
  TRICH_BAN_GIAO,
  assertFullSha,
  demVeMenhDe,
  ketQua,
  kiemTraCong,
  kiemTraMocGhim,
} from "./danh-gia.js";
import {
  collectCoverage,
  collectLabelUses,
  countAssertions,
  findUnregisteredLabels,
  parseInvariants,
} from "./parse.js";

const REPO = resolve(import.meta.dirname, "../../..");
const TEST_PLAN = resolve(REPO, "docs/TEST-PLAN.md");
const REPORT = resolve(REPO, "evidence/vitest-report.json");
const OUTPUT = resolve(REPO, "evidence/INV-matrix.md");
const METADATA = resolve(REPO, "evidence/run-metadata.md");

/**
 * XUẤT XỨ CỦA BẰNG CHỨNG.
 *
 * Ràng buộc (11) của harness áp thẳng vào đây: trên Windows, `execFileSync` với một shim
 * `.cmd` trả `status = null` và `stdout = undefined` mà KHÔNG NÉM — cơ chế đã cho năm kết quả
 * "sống sót" GIẢ trong một lô đột biến. `git` ở đây là một tệp thực thi thật, không phải shim,
 * nhưng đúng lớp lỗi đó không được phép sống trong mã sản phẩm dù trên đường nào.
 *
 * Phép kiểm nằm ở `assertFullSha` (hàm THUẦN, có test) chứ không ở đây — xem docblock của nó.
 */
function commitSha(): string {
  return assertFullSha(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: REPO }));
}

function main(): void {
  const invariants = parseInvariants(readFileSync(TEST_PLAN, "utf8"));
  const reportJson = readFileSync(REPORT, "utf8");

  // DẤU HIỆU TÍCH CỰC RẰNG BỘ TEST ĐÃ CHẠY. Một báo cáo JSON hợp lệ nhưng rỗng cho ra ma trận
  // "không mã nào được phủ" — một kết quả ĐỎ GIẢ không phân biệt được với việc mọi test biến mất.
  const soKhangDinh = countAssertions(reportJson);
  if (soKhangDinh === 0) {
    console.error(
      `Báo cáo ${REPORT} không chứa một khẳng định nào. Không sinh ma trận từ một lượt chạy ` +
        `không có dấu hiệu nào rằng bộ test đã chạy.`,
    );
    process.exit(1);
  }

  const coverage = collectCoverage(reportJson);
  const uses = collectLabelUses(reportJson);
  const ids = invariants.map((i) => i.id);
  const nhanLa = findUnregisteredLabels(uses, ids);
  const van = kiemTraCong(invariants, coverage);
  // MỐC GHIM — cổng thứ hai, và nó đo thứ `kiemTraCong` KHÔNG đo được: một hồi quy độ phủ và
  // một lần danh sách nở ra. Hai mũi đã đo đi lọt qua `kiemTraCong` chết ở đây.
  van.push(...kiemTraMocGhim(invariants, coverage));

  // Một nhãn `[INV-…]` không rơi vào hàng nào là đúng lớp khiếm khuyết "nhãn sai che một bất
  // biến" mà Task 9 đã phải trả giá để phát hiện. Nó KHÔNG được bỏ qua trong im lặng.
  const nhanLaTheoMa = new Map<string, string[]>();
  for (const u of nhanLa) {
    nhanLaTheoMa.set(u.base, [...(nhanLaTheoMa.get(u.base) ?? []), u.testName]);
  }
  for (const [ma, ten] of [...nhanLaTheoMa].sort()) {
    van.push(
      `Nhãn \`[INV-${ma}]\` xuất hiện trong ${ten.length} tên test nhưng \`${ma}\` KHÔNG có ` +
        `trong sổ đăng ký \`docs/TEST-PLAN.md\`. Test đầu tiên: "${ten[0]}". ` +
        `Hoặc đăng ký mã, hoặc sửa nhãn — một nhãn không rơi vào hàng nào là một bất biến ` +
        `tưởng đã được canh mà thật ra không ai đếm.`,
    );
  }

  // --- Thân ma trận -------------------------------------------------------------------------
  const nghiepVu = invariants.filter((i) => !i.id.startsWith("H"));
  const hangRao = invariants.filter((i) => i.id.startsWith("H"));
  const daPhu = (id: string): boolean => ketQua(coverage.get(id)).coTest;
  const soPhuNghiepVu = nghiepVu.filter((i) => daPhu(i.id)).length;
  /**
   * 13 mã nghiệp vụ mà `docs/STATE.md` ghi là MỤC TIÊU của S0. Danh sách này là LỊCH SỬ — nó
   * không đổi khi độ phủ đổi. Cái được DẪN XUẤT là phần còn thiếu của nó, để câu văn ở §1 không
   * trôi khỏi sự thật như bản trước đã trôi.
   */
  const MUC_TIEU_S0 = ["B3", "B4", "D1", "D3", "D5", "E3", "F1", "F2", "F3", "G1", "G2", "G3", "G4"];
  const conThieuTrongMucTieuS0 = MUC_TIEU_S0.filter((id) => !daPhu(id));
  const soPhuHangRao = hangRao.filter((i) => daPhu(i.id)).length;

  const veCoHauTo = uses.filter((u) => u.clause !== null);
  const maCoVe = [...new Set(veCoHauTo.map((u) => `${u.base}(${u.clause ?? ""})`))].sort();

  const dong = invariants.map((inv) => {
    const kq = ketQua(coverage.get(inv.id));
    const so = coverage.get(inv.id)?.length ?? 0;
    // Một MỆNH ĐỀ HỘI được gắn cờ KHÁC một mệnh đề đơn, và cờ ấy DẪN XUẤT từ chính câu chữ ở
    // sổ đăng ký (`**và**`) chứ không từ một danh sách phải nuôi tay. Lý do: bộ sinh gom theo
    // NHÃN, nên một test đo MỘT vế cũng thắp ✅ cho CẢ mệnh đề — đúng chuyện đã xảy ra với D1.
    const soVe = demVeMenhDe(inv.statement);
    const ghiChu = MA_DUOC_PHEP_CHUA_PHU.has(inv.id)
      ? "xem §3"
      : PHAM_VI_HEP.has(inv.id)
        ? soVe > 1
          ? `**mệnh đề HỘI ${soVe} vế — phạm vi hẹp hơn, xem §4**`
          : "**phạm vi hẹp hơn mệnh đề — xem §4**"
        : "";
    return `| ${inv.id} | ${inv.statement} | ${inv.enforcement} | ${inv.testLayer} | ${so} | ${kq.nhan} | ${ghiChu} |`;
  });

  const noiDung = [
    "# Ma trận bất biến — Evidence Pack",
    "",
    "> **Sinh tự động** bởi `tools/inv-matrix`. **Không sửa tay** — `pnpm evidence:check` sinh lại",
    "> file này và đỏ nếu bản đã commit lệch một byte.",
    ">",
    "> File này **cố ý tất định**: không mang commit SHA, không mang dấu thời gian. Xuất xứ của",
    "> một lượt chạy cụ thể nằm ở `evidence/run-metadata.md` (không vào git; tải lên như artefact",
    "> của CI). Nếu ma trận mang dấu thời gian thì nó đổi mỗi lần chạy, và phép kiểm chống-sửa-tay",
    "> ở trên là bất khả.",
    "",
    "## 0. Bảng này đếm cái gì",
    "",
    "Dự án có **hai cách đếm bất biến**, cả hai đều đúng trong phạm vi của mình, và việc lẫn lộn",
    "chúng đã sinh ra ba con số khác nhau trong ba tài liệu. Bảng này chốt cách đếm:",
    "",
    `- **${nghiepVu.length} bất biến nghiệp vụ** (nhóm A–G): mệnh đề về hành vi của sản phẩm với`,
    "  dữ liệu của khách hàng. Đây là con số `docs/STATE.md` dùng khi nói S0 *nhắm tới* bao nhiêu.",
    `- **${hangRao.length} bất biến hàng rào** (nhóm H): mệnh đề về việc một biện pháp kiểm soát của`,
    "  chính dự án — hai hook, các họ quy tắc biên giới của dependency-cruiser — có còn răng hay không.",
    `- **Tổng ${invariants.length} mã** cùng chảy vào bảng này. Tiêu chí phân nhóm là *cái này canh CÁI GÌ*.`,
    "",
    "Con số cũ **44** (34 + 10) trong bản kế hoạch S0 đã **thiu**: nhóm H có thêm H11/H12 (Task 9)",
    "và H13 (Task 10). Sổ đăng ký `docs/TEST-PLAN.md` là nguồn sự thật duy nhất; bảng này đọc thẳng",
    "từ đó và **ném** nếu số hàng đọc được lệch với một phép đếm độc lập.",
    "",
    "## 1. Tổng kết",
    "",
    `| Nhóm | Đã phủ | Tổng |`,
    `|---|---|---|`,
    `| Nghiệp vụ (A–G) | **${soPhuNghiepVu}** | ${nghiepVu.length} |`,
    `| Hàng rào (H) | **${soPhuHangRao}** | ${hangRao.length} |`,
    `| **Cộng** | **${soPhuNghiepVu + soPhuHangRao}** | **${invariants.length}** |`,
    "",
    `**${invariants.length - soPhuNghiepVu - soPhuHangRao} mã chưa phủ**, tất cả đều nằm trong danh sách được phép ở §3, mỗi mã một lý do đọc được.`,
    "",
    // *** CÂU DƯỚI ĐÂY TỪNG SAI, VÀ NÓ SAI THEO MỘT KIỂU ĐÁNG GHI LẠI. ***
    // Bản trước viết: `S0 **giao được ${soPhuNghiepVu}**: G2 và G4 không có lớp` — một câu về
    // LỊCH SỬ (S0 giao được bao nhiêu) mà nội suy con số CỦA HÔM NAY. Từ S1.3 nó đọc thành
    // "S0 giao được 14", và ở S1.4 nó sẽ đọc thành "S0 giao được 17" — một lời khai sai trong
    // chính hồ sơ kiểm toán, tự sinh ra mới mỗi lượt chạy. Con số của S0 là 11, cố định.
    // Phần "hôm nay" tách xuống dòng riêng, và danh sách mã còn thiếu được DẪN XUẤT chứ không
    // viết tay — nếu không thì câu mới sẽ trôi đúng như câu cũ.
    "`docs/STATE.md` ghi S0 **nhắm tới** 13 bất biến nghiệp vụ (B3, B4, D1, D3, D5, E3, F1, F2, F3,",
    "G1, G2, G3, G4). **S0 giao được 11** — G2 và G4 không có lớp. Hai con số ấy là LỊCH SỬ và cố",
    "định. `docs/TEST-PLAN.md` là nơi ghi vì sao, và §3 dưới đây ghi ra rằng các hàng trống là",
    "trống *có lý do*, không phải vì quên.",
    "",
    `Hôm nay: **${soPhuNghiepVu}/${nghiepVu.length}** mã nghiệp vụ. Trong 13 mã mục tiêu của S0, số còn chưa phủ: ` +
      `${conThieuTrongMucTieuS0.length === 0 ? "không còn mã nào" : conThieuTrongMucTieuS0.join(", ")}.`,
    "",
    "## 2. Ma trận",
    "",
    "| INV | Mệnh đề | Cưỡng chế | Tầng test | Số test | Kết quả | Ghi chú |",
    "|---|---|---|---|---|---|---|",
    ...dong,
    "",
    "## 3. Mã chưa phủ — **trạng thái đúng, không phải khoảng trống bị quên**",
    "",
    "Mỗi mã dưới đây được **ghim** trong `tools/inv-matrix/src/danh-gia.ts`",
    "(`MA_DUOC_PHEP_CHUA_PHU`). Danh sách này là **ràng buộc hai chiều**: một mã ngoài danh sách mà",
    "chưa phủ làm CI **đỏ thật**, và một mã trong danh sách mà **đã được phủ** cũng làm CI đỏ, kèm",
    "lời nhắc gỡ nó ra.",
    "",
    "> **Bản trước của dòng này viết tiếp:** *\"Nhờ chiều thứ hai, danh sách chỉ co lại — nó không",
    "> bao giờ nở ra trong im lặng.\"* **Câu đó rộng hơn cơ chế, và đã được đo là sai.** Chiều thứ",
    "> hai chỉ kích hoạt khi một mã **vừa có test vừa ở trong danh sách**, nên hai thay đổi bù trừ",
    "> nhau trong cùng một PR đi lọt: xoá test của một mã *và* thêm mã đó vào danh sách cho cổng",
    "> **xanh**; thêm một mã mới vào sổ đăng ký *và* vào danh sách cũng cho cổng **xanh**, danh sách",
    "> nở ra một dòng. Giữ nguyên văn ở đây để đối chiếu, không xoá.",
    "",
    "### 3.1 Mốc ghim — thứ THẬT SỰ giữ cho độ phủ chỉ đi lên",
    "",
    "Chỗ trống câu trên để lại được lấp bằng **hai con số ghim** trong cùng file, đỏ khi lệch về",
    "**bất kỳ chiều nào**:",
    "",
    `- \`MOC_GHIM.soPhuToiThieu = ${MOC_GHIM.soPhuToiThieu}\` — tử số của bảng §1. Tụt xuống là **hồi quy độ phủ**;`,
    "  lên thì phải **nâng mốc bằng tay**, thành một dòng có chữ ký trong diff.",
    `- \`MOC_GHIM.coDanhSachToiDa = ${MOC_GHIM.coDanhSachToiDa}\` — số dòng của chính bảng dưới đây. Nở ra là **đỏ**.`,
    "",
    "Cộng thêm hai phép kiểm cùng họ: năm mã bắt buộc phải giữ ghi chú §4 (`MA_PHAI_CO_CO_HEP`),",
    "và **mọi mệnh đề HỘI đang mang ô ✅ đều phải có ghi chú §4** — vế sau *dẫn xuất* từ chính câu",
    "chữ ở sổ đăng ký, nên một mệnh đề hội mới của S1 tự rơi vào phạm vi ngay hôm nó được viết ra.",
    "",
    "**Điều này vẫn KHÔNG đóng được:** một PR sửa mã, sửa danh sách, *và* sửa cả hai con số cùng",
    "lúc vẫn xanh. Không phép đo nào chặn được điều đó. Khác biệt là lúc ấy nó là một **dòng phải",
    "sửa, có tên, trong một file có chủ sở hữu** (`.github/CODEOWNERS`) — không phải một sự im lặng.",
    "",
    "**Nguy hiểm không nằm ở chỗ các hàng này trống.** Nó đến khi ai đó **lấp chúng bằng nhãn thay vì",
    "bằng lớp** — gắn `[INV-G2]` lên một test đo thứ khác. Chuyện đó đã xảy ra một lần: năm test mang",
    "`[INV-G2]` thật ra đo quy tắc biên giới depcruise, và vòng fix 1 của Task 9 đã sửa nhãn về `[INV-H11]`.",
    "",
    "| INV | Vì sao chưa phủ |",
    "|---|---|",
    ...invariants
      .filter((i) => MA_DUOC_PHEP_CHUA_PHU.has(i.id))
      .map((i) => `| **${i.id}** | ${MA_DUOC_PHEP_CHUA_PHU.get(i.id) ?? ""} |`),
    "",
    "## 4. Mã đã phủ mà **bảo đảm thật hẹp hơn mệnh đề**",
    "",
    "Một ô ✅ cạnh một mệnh đề rộng **là** một phát biểu rộng hơn thứ được đo, trừ khi phần chênh",
    "được ghi ra. Đây là phần đó.",
    "",
    "Những mệnh đề viết bằng **phép HỘI** được đánh dấu riêng ở cột *Ghi chú* (`mệnh đề HỘI n vế`),",
    "vì chúng hỏng theo một cách khác: bộ sinh gom theo **nhãn** và **không hề biết** mệnh đề là",
    "phép hội, nên một test đo **một** vế cũng thắp ✅ cho **cả** mệnh đề. Với những hàng đó, mục",
    "dưới đây phải nói rõ **vế nào được đo** và **vế nào chưa có chủ ngữ**.",
    "",
    ...invariants
      .filter((i) => PHAM_VI_HEP.has(i.id))
      .flatMap((i) => [`- **${i.id}** — ${PHAM_VI_HEP.get(i.id) ?? ""}`, ""]),
    "### 4.1 B3 và B4 — phát biểu bàn giao, trích nguyên văn",
    "",
    "Hai phát biểu dưới đây đã được hiệu chuẩn qua hai vòng fix ở Task 6 và được **chép lại nguyên",
    "văn** từ sổ tay tiến trình, kể cả chính tả không dấu: chúng là bằng chứng, không phải văn bản",
    "để viết lại cho đẹp. Đây là câu trả lời đúng khi kiểm toán viên hỏi *một chuỗi hash hợp lệ",
    "chứng minh điều gì*.",
    "",
    ...TRICH_BAN_GIAO.flatMap((t) => ["```text", t.trich, "```", ""]),
    "## 5. Nhãn vế `[INV-XX(k)]` — cố ý **không** được tính là độ phủ",
    "",
    maCoVe.length === 0
      ? "Không có nhãn vế nào trong lượt chạy này."
      : `Lượt chạy này có **${veCoHauTo.length} test** mang nhãn vế: ${maCoVe.map((m) => `\`[INV-${m}]\``).join(", ")}.`,
    "",
    "Chúng **không** được cộng vào ô *Số test* của mã gốc, và đó là một quyết định, không phải",
    "một thiếu sót. E3 có **năm** vế; nếu nhãn vế được tính thì một mã có bốn vế có lớp và một vế",
    "**không có một dòng mã nào** sẽ hiện ra y hệt một mã đã phủ trọn vẹn. Nới regex để mua một",
    "con số đẹp chính là thứ quy tắc QT2 của dự án cấm.",
    "",
    "## 6. Một ô ✅ chứng minh gì — và **không** chứng minh gì",
    "",
    "**Chứng minh:** tồn tại ít nhất một test mang nhãn `[INV-<mã>]` trong tên, test đó **đã chạy**",
    "trong lượt này (không bị bỏ qua) và **đã đạt**; và mã đó có mặt trong sổ đăng ký.",
    "",
    "**Không chứng minh:**",
    "",
    "1. **rằng test ấy đo đúng mệnh đề ở cột kế bên.** Bộ sinh gom theo **nhãn**, và nhãn do người",
    "   viết đặt. Lớp phòng thủ duy nhất chống nhãn sai là đọc tên test — bộ sinh chỉ đóng được",
    "   trường hợp nhãn trỏ vào một mã **không tồn tại**, và nó đóng chặt.",
    "2. **rằng mệnh đề được phủ trọn vẹn.** Xem §4: một mệnh đề năm vế có thể ✅ với bốn vế (E3),",
    "   và một mệnh đề **hội** bốn vế có thể ✅ khi chỉ hai vế được đo — **riêng rẽ, chưa từng",
    "   cùng lúc** — còn hai vế kia không có một dòng mã nào (D1).",
    "3. **rằng lớp cưỡng chế ở cột *Cưỡng chế* là thứ đang chặn.** Cột đó chép từ sổ đăng ký, không",
    "   được bộ sinh kiểm chứng. Test chỉ **phát hiện**; cưỡng chế mới **ngăn chặn**.",
    "4. **bất cứ điều gì về mã chưa phủ.** Một hàng ⏳ không nói sản phẩm sai — nó nói *chưa có bằng chứng*.",
    "",
    "---",
    "",
    "**Cách đo:** một bất biến được coi là phủ khi có ít nhất một test mang nhãn `[INV-<mã>]` **trần**",
    "(không hậu tố vế) trong `fullName` của báo cáo `vitest --reporter=json`, và mọi test mang nhãn đó",
    "đều đạt. Báo cáo phải đến từ `pnpm test:report`, chạy **cả hai tầng** (`vitest run`, không loại trừ",
    "`*.int.test.ts`) — nếu chỉ chạy tầng đơn vị thì phần lớn B3/B4/D1/D3/F1 hiện là chưa phủ, một **đỏ giả**.",
    "",
  ].join("\n");

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, noiDung, "utf8");

  const metadata = [
    "# Evidence pack — xuất xứ lượt chạy",
    "",
    "> File này KHÔNG vào git (`.gitignore`). Nó tồn tại để `evidence/INV-matrix.md` giữ được",
    "> tính tất định. Tải lên cùng ma trận như artefact CI.",
    "",
    `- Commit: \`${commitSha()}\``,
    `- Thời điểm sinh: ${new Date().toISOString()}`,
    `- Tổng số khẳng định trong báo cáo: ${soKhangDinh}`,
    `- Bất biến trong sổ đăng ký: ${invariants.length} (${nghiepVu.length} nghiệp vụ + ${hangRao.length} hàng rào)`,
    `- Đã phủ: ${soPhuNghiepVu + soPhuHangRao}`,
    `- Nhãn ngoài sổ đăng ký: ${nhanLa.length}`,
    `- Vấn đề chặn merge: ${van.length}`,
    "",
  ].join("\n");
  writeFileSync(METADATA, metadata, "utf8");

  console.log(`Đã ghi ${OUTPUT}`);
  console.log(`Đã ghi ${METADATA}`);
  console.log(
    `${soPhuNghiepVu + soPhuHangRao}/${invariants.length} bất biến được kiểm chứng ` +
      `(${soPhuNghiepVu}/${nghiepVu.length} nghiệp vụ + ${soPhuHangRao}/${hangRao.length} hàng rào), ` +
      `đọc từ ${soKhangDinh} khẳng định.`,
  );

  if (van.length > 0) {
    console.error(`\n${van.length} vấn đề CHẶN MERGE:`);
    for (const v of van) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log("Cổng evidence: XANH.");
}

main();
