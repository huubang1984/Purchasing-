// ==============================================================================================
// [khoản nợ 59] MỘT KHOÁ LIÊN TIẾN TRÌNH CHO `depcruise` — VÌ CÂY NGUỒN LÀ TÀI NGUYÊN DÙNG CHUNG
//
// Khoản nợ 59, nguyên văn: khẳng định *"mã nguồn hiện tại không vi phạm quy tắc nào"* KHÔNG
// hermetic. `apps/api/src/routes.test.ts` viết một probe THẬT vào `apps/api/src/routes/` rồi chạy
// `depcruise` trên `apps/api`; `tests/architecture/boundaries.test.ts` chạy `pnpm run depcruise`
// trên TOÀN kho. Hai tệp khác nhau ⇒ vitest chạy chúng ở hai tiến trình song song ⇒ lượt quét
// toàn kho nhìn thấy probe của tệp kia và báo một vi phạm KHÔNG CÓ THẬT.
//
// Đó là một cổng ĐỎ GIẢ, và một cổng đỏ giả là cổng người ta học cách chạy lại thay vì đọc.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO LÀ KHOÁ, KHÔNG PHẢI MỘT PHÉP LOẠI TRỪ THEO TÊN
// ----------------------------------------------------------------------------------------------
// Đường dễ hơn là cho `pnpm run depcruise` bỏ qua mọi tệp tên `zprobe-*`. Nó đóng được đua tranh,
// nhưng đổi lại: cổng sản xuất thôi nhìn một lớp tệp mà chỉ một quy ước đặt tên giữ cho trống —
// tức mua sự yên tĩnh bằng một lỗ. Khoá thì không đổi thứ gì được đo; nó chỉ nói *"đừng đo trong
// lúc người khác đang sửa cây nguồn"*.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO KHOÁ ĐỒNG BỘ, VÀ VÌ SAO `mkdir`
// ----------------------------------------------------------------------------------------------
// Cả hai chỗ gọi đều dùng `spawnSync`, nên khoá bất đồng bộ sẽ phải đổi hình cả hai lời gọi mà
// không mua thêm gì. `mkdir` là thao tác NGUYÊN TỬ trên cả POSIX lẫn Windows: hai tiến trình cùng
// gọi thì đúng một cái thành công — khác với `existsSync` rồi `mkdir`, cặp đôi có cửa sổ ở giữa.
//
// ==============================================================================================
// BỐN CHỖ HỎNG CỦA BẢN ĐẦU TIÊN, tìm ra ở review an ninh lượt 16 (S1.25). Ghi lại vì cả bốn đều
// là cùng MỘT lớp lỗi: **một lớp canh dựng để chống treo, mà bản thân nó treo được.**
//
// ⑴ **VÒNG QUAY VÔ HẠN, KHÔNG HẠN, KHÔNG NGỦ (mức MEDIUM).** `catch` của `statSync` kết bằng
//    `continue`, mà `continue` nhảy thẳng lên đầu `for(;;)` — **vượt qua CẢ kiểm tra hạn CẢ giấc
//    ngủ**. Hễ `statSync` ném lặp lại là vòng quay 100% CPU vĩnh viễn; và vì hàm này ĐỒNG BỘ, nó
//    chặn event loop nên `timeout` của chính `it()` cũng không bao giờ bắn được. Đường kích hoạt
//    KHÔNG cần kẻ tấn công: `mkdirSync` ở đây là bản không `recursive`, nên một `TMPDIR` trỏ vào
//    thư mục đã bị dọn là đủ — `mkdirSync` ném `ENOENT`, `statSync` ném `ENOENT`, và `catch {}`
//    trần ở `mkdirSync` nuốt mất chẩn đoán duy nhất. Một cấu hình môi trường tầm thường biến
//    `pnpm test` thành một lần treo KHÔNG THÔNG ĐIỆP thay vì một lần đỏ — đúng điều mà chú thích
//    ngay bên dưới tuyên bố là không được phép xảy ra.
//
// ⑵ **`HAN_CHO_MS` (180 s) NGẮN HƠN `HAN_KHOA_MS` (300 s) ⇒ MỘT LẦN `Ctrl-C` ĐẦU ĐỘC ~2 PHÚT.**
//    Một tiến trình bị giết để lại thư mục khoá mới tinh. Lượt sau phải chờ 300 s mới được coi nó
//    là rác, nhưng NÉM ở mốc 180 s. Tức mọi lượt chạy trong cửa sổ ấy ĐỎ vì hạ tầng khoá, không vì
//    mã có lỗi — lại đúng một cổng đỏ giả, thứ khoản nợ 59 sinh ra để diệt.
//
// ⑶ **HẠN THEO ĐỒNG HỒ LÀ MỘT PHỎNG ĐOÁN; CHỦ KHOÁ CÒN SỐNG HAY KHÔNG LÀ MỘT SỰ KIỆN.** Bản đầu
//    hỏi *"khoá này già hơn 300 giây chưa"*. Câu hỏi ấy sai cả hai chiều: một lượt cruise toàn kho
//    chạy quá 300 s sẽ bị tiến trình khác coi là rác và **xoá khoá đang sống**, rồi khi nó xong,
//    `finally` xoá nhầm **khoá của người kế tiếp**. Nay hỏi thẳng: *"tiến trình ghi tên trong khoá
//    còn sống không"* — `process.kill(pid, 0)`. Đồng hồ chỉ còn là lưới đỡ cho đúng khe micro-giây
//    giữa `mkdir` và lúc ghi xong tệp `pid`, nên `HAN_KHOA_MS` hạ về 30 s và **nhỏ hơn**
//    `HAN_CHO_MS` — ⑵ đóng theo.
//
// ⑷ **KHOÁ NẰM Ở `os.tmpdir()`, TÊN ĐOÁN ĐƯỢC, SUY TỪ 12 BYTE CUỐI ĐƯỜNG DẪN KHO.** Trên máy dựng
//    Linux dùng chung, `/tmp` ai cũng ghi được: một người dùng khác giành trước cái tên ấy rồi
//    `touch` nó theo nhịp là đủ làm mọi lượt chạy ĐỎ. Và 12 byte cuối của một đường dẫn worktree
//    (`…/worktrees/s0-foundation/`) VA CHẠM giữa hai cây nguồn khác nhau. Nay khoá nằm ở
//    `node_modules/.cache/trustprocure/` — thuộc quyền người chạy, riêng cho từng cây nguồn.
//    Đã kiểm chứ không suy: mục tiêu cruise là `packages apps tools tests db` (`package.json:9`)
//    nên `node_modules` **không phải mục tiêu**, và `doNotFollow: "(^|/)node_modules(/|$)"`
//    (`.dependency-cruiser.cjs:674`) chặn duyệt tiếp — khoá ở đó vô hình với chính công cụ này.
//
//
// ==============================================================================================
// ⑸ CHỖ HỎNG THỨ NĂM — VÀ NÓ KHÔNG ĐẾN TỪ MỘT LƯỢT SOI, NÓ ĐẾN TỪ CI. [khoản 222]
//
// `EPERM` BỊ PHÂN LOẠI LÀ *HỎNG THẬT*, NHƯNG WINDOWS TRẢ ĐÚNG `EPERM` CHO MỘT TRANH CHẤP.
//
// Đo: PR #105, run 35625587011, job `T1+T2 (windows-latest)` ĐỎ đúng một ca — `EPERM: operation
// not permitted, mkdir '…/node_modules/.cache/trustprocure/depcruise.lock'` ở PROBE của
// `apps/api/src/routes.test.ts` — trong khi ubuntu-latest, T0, T0b và T3 của CÙNG commit đều
// SUCCESS, và `pnpm test` ở máy (cũng Windows) xanh hai lượt.
//
// `routes.test.ts` giữ khoá trọn vòng đời probe còn `boundaries.test.ts` giành-nhả khoá ở MỖI
// lượt cruise, nên trên đường dẫn ấy có một dòng `mkdir`/`rmdir` liên tục. Trên Windows, `mkdir`
// vào một thư mục đã `rmdir` mà handle cuối chưa đóng (*pending delete*) trả
// `ERROR_ACCESS_DENIED`, và libuv map nó thành `EPERM` — KHÔNG phải `EEXIST`. Nên lớp dựng để
// diệt cổng đỏ giả vừa dựng một cái, đúng lớp lỗi mà bốn mục trên vừa kể.
//
// Bản vá hẹp, hai vế, và vế thứ hai giữ tính chất ⑴:
//   • `EPERM` mà TÊN CÓ TRONG THƯ MỤC CHA ⇒ coi như có người đang giữ (chờ tiếp);
//   • `EPERM` mà tên KHÔNG có ⇒ vẫn NÉM ngay (đó là quyền thật), và ngay cả vế trên cũng chỉ
//     được tha trong `CUA_SO_EPERM_MS` rồi ném CHÍNH lỗi gốc — một mã lỗi được tha không được
//     biến thành một lần chờ 180 giây.
//
// Vị từ hỏi `readdir` CỦA THƯ MỤC CHA, không hỏi `lstat` của chính đường dẫn: một thư mục đang
// chờ xoá cũng làm `lstat` ném `EPERM` (cùng một `CreateFileW`), còn `readdir` vẫn liệt kê nó.
//
// Khoá vẫn CÓ HẠN theo hai chiều: chờ tối đa `HAN_CHO_MS` rồi NÉM (một lượt treo im lặng còn tệ
// hơn một lượt đỏ), và một khoá mà CHỦ của nó đã chết bị thu hồi ngay lập tức.
// ==============================================================================================

import { mkdirSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Khoá nằm NGOÀI tầm nhìn của `depcruise` nhưng TRONG cây làm việc: một thư mục trong `packages|
 * apps|tools|tests|db` sẽ tự nó thành thứ công cụ nhìn thấy, còn `os.tmpdir()` thì dùng chung với
 * mọi người dùng khác trên máy (xem ⑷ ở trên).
 */
const DUONG_KHOA = join(GOC, "node_modules", ".cache", "trustprocure", "depcruise.lock");

// Thư mục CHA dựng một lần lúc nạp module, và CỐ Ý không bọc `try`: nếu chỗ này không tạo được
// thì không lượt chạy nào khoá được, và một lỗi nạp module ồn ào đúng hơn hẳn một lần treo im.
// Chính `DUONG_KHOA` thì KHÔNG `recursive` — nó phải giữ tính nguyên tử của `mkdir`.
mkdirSync(dirname(DUONG_KHOA), { recursive: true });

/**
 * Đo được ngày 2026-09-08, và con số này là thứ quyết định hạn chờ chứ không phải một ước lượng:
 * `tests/architecture/boundaries.test.ts` chạy RIÊNG mất **79,6 giây** cho 68 test, và gần như mỗi
 * test là một lượt cruise thật GIỮ KHOÁ. Nên một chỗ gọi khác đợi sau nó phải chịu được cỡ ấy —
 * 180 giây để lại hơn hai lần biên. Vượt biên thì NÉM kèm thông điệp, không treo.
 */
const HAN_CHO_MS = 180_000;

/**
 * Trần thời gian cho MỘT test giữ khoá này rồi chạy một công cụ quét (depcruise, eslint) trong tiến
 * trình con. Nó phải phủ CẢ HAI khoảng: chờ khoá tới `HAN_CHO_MS` (180 s) cộng một lượt quét giữ
 * khoá — đo tới 131 s trên CI (S1.118). Trần cũ 120 s nhỏ hơn cả MỘT lượt quét đo được, nên runner
 * Windows chậm đỏ ở `routes.test.ts` và `phuc-vu.test.ts` trên PR không chạm mã TypeScript nào
 * (PR #127, #128). 360 s = 180 + 131 cộng biên; vượt nó thì test NÉM, không treo.
 */
export const TRAN_TEST_GIU_KHOA_MS = 360_000;
/**
 * CHỈ là lưới đỡ cho khe giữa `mkdir` và lúc ghi xong tệp `pid` — khe ấy dài vài micro-giây, nên
 * 30 s đã là thừa mứa. Vế thật của "khoá rác" là ⑶: chủ khoá còn sống hay không. Con số này BẮT
 * BUỘC nhỏ hơn `HAN_CHO_MS`, nếu không thì một khoá rác đầu độc mọi lượt chạy tới khi hết hạn.
 */
const HAN_KHOA_MS = 30_000;
/**
 * [khoản 222] CỬA SỔ NHẪN NẠI CHO `EPERM` — hai giây, và con số NHỎ là chủ ý.
 *
 * Một thư mục Windows *đang chờ xoá* biến mất ngay khi cái handle cuối cùng đóng, tức vài
 * mili-giây; cửa sổ này không phải một hạn chờ, nó là bề rộng của một khe đua tranh. Hết cửa
 * sổ thì NÉM CHÍNH LỖI GỐC — tính chất ⑴ (*hỏng TO chứ không treo im*) không được đổi thành
 * một lần chờ `HAN_CHO_MS` chỉ vì có thêm một mã lỗi được tha. Đo các lần LIÊN TIẾP: một
 * nhịp `EEXIST` xen vào là bằng chứng khoá đang được dùng bình thường, nên cửa sổ mở lại.
 */
const CUA_SO_EPERM_MS = 2_000;
const NHIP_MS = 50;

/** Ngủ ĐỒNG BỘ — `Atomics.wait` là cách duy nhất làm việc đó mà không quay vòng đốt CPU. */
function nguDongBo(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function maLoi(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code;
}

/**
 * [khoản 222] Cái TÊN này có nằm trong thư mục cha không — kể cả khi nó đang chờ xoá.
 *
 * `readdir` đọc thư mục cha bằng `NtQueryDirectoryFile`, vốn vẫn liệt kê một mục *pending
 * delete*; `lstat` của chính đường dẫn thì mở handle nên nó ném `EPERM` cùng lý do với
 * `mkdir`. Hỏi sai chỗ ở đây là biến vị từ thành một hằng `false` trên đúng ca cần nó.
 *
 * Không đọc được thư mục cha ⇒ `false`: "không chắc" phải đi về phía NÉM, vì chiều kia là
 * một lần chờ.
 */
function tenConTonTai(duong: string): boolean {
  try {
    return readdirSync(dirname(duong)).includes(basename(duong));
  } catch {
    return false;
  }
}

/**
 * `process.kill(pid, 0)` KHÔNG gửi tín hiệu nào — nó chỉ hỏi hệ điều hành *"tiến trình này tồn tại
 * và tôi có quyền báo hiệu cho nó không"*. `EPERM` nghĩa là **có tồn tại** nhưng của người khác,
 * nên nó là CÒN SỐNG; chỉ `ESRCH` mới là đã chết.
 */
function conSong(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return maLoi(e) === "EPERM";
  }
}

/** Đọc chủ khoá. `undefined` = không đọc được (chưa ghi xong, hoặc khoá vừa biến mất). */
function chuKhoa(duong: string): number | undefined {
  try {
    const pid = Number(readFileSync(join(duong, "pid"), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Khoá này có phải RÁC của một tiến trình đã chết không. Trả `false` khi KHÔNG CHẮC — thu hồi nhầm
 * một khoá đang sống còn tệ hơn chờ thêm một nhịp, và hạn `HAN_CHO_MS` ở vòng ngoài bảo đảm ta
 * không chờ mãi.
 */
function laKhoaRac(duong: string): boolean {
  let noi;
  try {
    noi = lstatSync(duong);
  } catch {
    return false; // vừa biến mất — vòng ngoài sẽ thử `mkdir` lại ngay
  }
  // `lstat`, không phải `stat`: một symlink trỏ ra ngoài KHÔNG được coi là khoá của ai cả, và
  // càng không được đem đi dọn. Nó là dấu hiệu có người đang nghịch, nên cứ để hạn chờ xử.
  if (!noi.isDirectory()) return false;
  const pid = chuKhoa(duong);
  if (pid !== undefined) return !conSong(pid);
  return Date.now() - noi.mtimeMs > HAN_KHOA_MS;
}

/**
 * Lượt `mkdir` THẬT, và nó KHÔNG `recursive` — tính nguyên tử của `mkdir` là toàn bộ lý do
 * lớp này dùng `mkdir` chứ không dùng `existsSync` rồi `mkdir`.
 */
function taoThuMucKhoa(duong: string): void {
  mkdirSync(duong, { recursive: false });
}

/** Đếm mức lồng: một tiến trình ĐANG cầm khoá mà gọi lồng thì sẽ tự khoá chết chính mình. */
let mucLong = 0;

/** Trạng thái chờ của MỘT lượt giành khoá — chung cho bản đồng bộ và bản bất đồng bộ. */
interface TrangThaiCho {
  readonly han: number;
  hanEperm: number | undefined;
}

/**
 * Thử giành khoá MỘT lần. `true` = đã giữ (và đã ghi tên chủ); `false` = có người đang giữ, người gọi
 * ngủ một nhịp rồi thử lại. Mọi hỏng thật và mọi lần quá hạn đều NÉM ở đây — hai vòng chờ bên dưới chỉ
 * khác nhau ở CÁCH ngủ, không ở luật.
 */
function thuGianhKhoa(duongKhoa: string, tao: (duong: string) => void, tt: TrangThaiCho): boolean {
  try {
    tao(duongKhoa);
  } catch (e) {
    // Chỉ `EEXIST` mới nghĩa là "có người đang giữ" — và [khoản 222] `EPERM` trên một cái TÊN
    // ĐANG TỒN TẠI, vì đó là thư mục khoá đang chờ xoá trên Windows. Mọi mã lỗi khác (`ENOENT`
    // vì thư mục cha không tồn tại, `EACCES`, và cả `EPERM` trên một cái tên KHÔNG có) là hỏng
    // THẬT: ném ngay, mang theo lỗi gốc. Đây là chỗ `catch {}` trần của bản đầu nuốt mất chẩn
    // đoán rồi quay vòng vô hạn — xem ⑴.
    const ma = maLoi(e);
    if (ma !== "EEXIST" && !(ma === "EPERM" && tenConTonTai(duongKhoa))) throw e;

    // [khoản 222] Cửa sổ nhẫn nại đo các lần `EPERM` LIÊN TIẾP; hết cửa sổ thì ném lỗi GỐC,
    // không phải lỗi hạn chờ — một người đọc phải thấy `EPERM` chứ không thấy "quá 180 giây".
    if (ma === "EPERM") {
      tt.hanEperm ??= Date.now() + CUA_SO_EPERM_MS;
      if (Date.now() > tt.hanEperm) throw e;
    } else {
      tt.hanEperm = undefined;
    }

    // HẠN ĐỨNG TRƯỚC MỌI NHÁNH KHÁC. Không nhánh nào dưới đây được phép `continue` vượt qua nó.
    if (Date.now() > tt.han) {
      throw new Error(
        `[khoản nợ 59] chờ khoá depcruise quá ${HAN_CHO_MS} ms tại ${duongKhoa}. ` +
          "Một lượt treo im lặng còn tệ hơn một lượt đỏ, nên chỗ này NÉM.",
      );
    }

    if (laKhoaRac(duongKhoa)) rmSync(duongKhoa, { recursive: true, force: true });
    return false;
  }

  // Ghi tên chủ NGAY sau khi giành được. Ghi hỏng thì phải nhả khoá ra, không giữ một khoá vô chủ.
  try {
    writeFileSync(join(duongKhoa, "pid"), String(process.pid), "utf8");
  } catch (e) {
    rmSync(duongKhoa, { recursive: true, force: true });
    throw e;
  }
  return true;
}

/**
 * Chỉ xoá khoá CỦA MÌNH. Nếu ai đó đã thu hồi nó (ta bị treo lâu tới mức bị coi là chết) thì
 * khoá hiện tại là của người khác, và xoá nó là dựng lại đúng đua tranh mà lớp này đi đóng.
 */
function nhaKhoa(duongKhoa: string): void {
  if (chuKhoa(duongKhoa) === process.pid) rmSync(duongKhoa, { recursive: true, force: true });
}

/**
 * Chạy `fn` với khoá `depcruise` trong tay. Mọi lời gọi `depcruise` đọc CÂY NGUỒN phải đi qua đây.
 *
 * `duongKhoa` chỉ để PHÉP ĐO về chính lớp khoá này tiêm được một đường khác vào — xem
 * `khoa-depcruise.test.ts`. Mã sản xuất của lớp test không bao giờ truyền nó.
 *
 * [khoản 222] `tao` là cửa THỨ HAI cùng hạng, và nó có lý do hẹp: sự kiện của hệ điều hành
 * làm ⑸ đỏ — `mkdir` vào một thư mục đang chờ xoá — là một đua tranh KHÔNG dựng lại theo ý
 * muốn được, nên phép đo về cách xử nó phải TIÊM lỗi. Mã sản xuất không bao giờ truyền nó.
 *
 * GIỚI HẠN, đo được trên CI (S1.118): bản này NGỦ ĐỒNG BỘ khi chờ, tức chặn event loop của worker
 * vitest suốt lúc một worker khác giữ khoá — tới 131 giây với probe `g9-` của `apps/api/src/routes.test.ts`.
 * Quá hạn RPC của vitest thì worker ra `Timeout calling "onTaskUpdate"` và job đỏ dù mọi test đều qua.
 * Test chạy trong worker vitest dùng `voiKhoaDepcruiseAsync` ngay dưới; bản này giữ cho các phép đo về
 * chính lớp khoá và cho tiến trình con viết sẵn trong `khoa-depcruise.test.ts`.
 */
export function voiKhoaDepcruise<T>(
  fn: () => T,
  duongKhoa: string = DUONG_KHOA,
  tao: (duong: string) => void = taoThuMucKhoa,
): T {
  if (mucLong > 0) return fn(); // đã cầm khoá rồi — vào thẳng, đừng chờ chính mình

  const tt: TrangThaiCho = { han: Date.now() + HAN_CHO_MS, hanEperm: undefined };
  while (!thuGianhKhoa(duongKhoa, tao, tt)) nguDongBo(NHIP_MS); // không đường nào vòng lại mà không ngủ

  mucLong += 1;
  try {
    return fn();
  } finally {
    mucLong -= 1;
    nhaKhoa(duongKhoa);
  }
}

/**
 * CÙNG luật với `voiKhoaDepcruise`, nhưng CHỜ bằng `setTimeout` — event loop của worker vitest rảnh suốt
 * lúc chờ, nên lời gọi RPC của vitest không hết hạn trong khi một worker khác giữ khoá. Xem GIỚI HẠN ở trên.
 *
 * Không có nhánh lồng: `mucLong` là trạng thái của một luồng đồng bộ và không nói được gì về một lời hứa
 * đang chờ. Gọi lồng hàm này trong `fn` của chính nó là tự khoá chết cho tới hạn — và hạn NÉM.
 */
export async function voiKhoaDepcruiseAsync<T>(fn: () => T | Promise<T>, duongKhoa: string = DUONG_KHOA): Promise<T> {
  const tt: TrangThaiCho = { han: Date.now() + HAN_CHO_MS, hanEperm: undefined };
  while (!thuGianhKhoa(duongKhoa, taoThuMucKhoa, tt)) {
    await new Promise<void>((xong) => setTimeout(xong, NHIP_MS));
  }
  try {
    return await fn();
  } finally {
    nhaKhoa(duongKhoa);
  }
}
