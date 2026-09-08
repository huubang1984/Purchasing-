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
// Khoá vẫn CÓ HẠN theo hai chiều: chờ tối đa `HAN_CHO_MS` rồi NÉM (một lượt treo im lặng còn tệ
// hơn một lượt đỏ), và một khoá mà CHỦ của nó đã chết bị thu hồi ngay lập tức.
// ==============================================================================================

import { mkdirSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
 * CHỈ là lưới đỡ cho khe giữa `mkdir` và lúc ghi xong tệp `pid` — khe ấy dài vài micro-giây, nên
 * 30 s đã là thừa mứa. Vế thật của "khoá rác" là ⑶: chủ khoá còn sống hay không. Con số này BẮT
 * BUỘC nhỏ hơn `HAN_CHO_MS`, nếu không thì một khoá rác đầu độc mọi lượt chạy tới khi hết hạn.
 */
const HAN_KHOA_MS = 30_000;
const NHIP_MS = 50;

/** Ngủ ĐỒNG BỘ — `Atomics.wait` là cách duy nhất làm việc đó mà không quay vòng đốt CPU. */
function nguDongBo(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function maLoi(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code;
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

/** Đếm mức lồng: một tiến trình ĐANG cầm khoá mà gọi lồng thì sẽ tự khoá chết chính mình. */
let mucLong = 0;

/**
 * Chạy `fn` với khoá `depcruise` trong tay. Mọi lời gọi `depcruise` đọc CÂY NGUỒN phải đi qua đây.
 *
 * `duongKhoa` chỉ để PHÉP ĐO về chính lớp khoá này tiêm được một đường khác vào — xem
 * `khoa-depcruise.test.ts`. Mã sản xuất của lớp test không bao giờ truyền nó.
 */
export function voiKhoaDepcruise<T>(fn: () => T, duongKhoa: string = DUONG_KHOA): T {
  if (mucLong > 0) return fn(); // đã cầm khoá rồi — vào thẳng, đừng chờ chính mình

  const han = Date.now() + HAN_CHO_MS;
  for (;;) {
    try {
      mkdirSync(duongKhoa, { recursive: false });
      break;
    } catch (e) {
      // Chỉ `EEXIST` mới nghĩa là "có người đang giữ". Mọi mã lỗi khác (`ENOENT` vì thư mục cha
      // không tồn tại, `EACCES`, `EPERM`) là hỏng THẬT: ném ngay, mang theo lỗi gốc. Đây là chỗ
      // `catch {}` trần của bản đầu nuốt mất chẩn đoán rồi quay vòng vô hạn — xem ⑴.
      if (maLoi(e) !== "EEXIST") throw e;

      // HẠN ĐỨNG TRƯỚC MỌI NHÁNH KHÁC. Không nhánh nào dưới đây được phép `continue` vượt qua nó.
      if (Date.now() > han) {
        throw new Error(
          `[khoản nợ 59] chờ khoá depcruise quá ${HAN_CHO_MS} ms tại ${duongKhoa}. ` +
            "Một lượt treo im lặng còn tệ hơn một lượt đỏ, nên chỗ này NÉM.",
        );
      }

      if (laKhoaRac(duongKhoa)) rmSync(duongKhoa, { recursive: true, force: true });
      nguDongBo(NHIP_MS); // không có đường nào ra khỏi `catch` mà không đi qua đây
    }
  }

  // Ghi tên chủ NGAY sau khi giành được. Ghi hỏng thì phải nhả khoá ra, không giữ một khoá vô chủ.
  try {
    writeFileSync(join(duongKhoa, "pid"), String(process.pid), "utf8");
  } catch (e) {
    rmSync(duongKhoa, { recursive: true, force: true });
    throw e;
  }

  mucLong += 1;
  try {
    return fn();
  } finally {
    mucLong -= 1;
    // Chỉ xoá khoá CỦA MÌNH. Nếu ai đó đã thu hồi nó (ta bị treo lâu tới mức bị coi là chết) thì
    // khoá hiện tại là của người khác, và xoá nó là dựng lại đúng đua tranh mà lớp này đi đóng.
    if (chuKhoa(duongKhoa) === process.pid) rmSync(duongKhoa, { recursive: true, force: true });
  }
}

// [review lượt 16, INFO] `DUONG_KHOA_DE_DO` đã bị GỠ. Nó tự khai *"chỉ dùng cho phép đo về chính
// khoá này — xem khoa-depcruise.test.ts"*, nhưng tệp ấy không hề import nó: một export CHẾT mang
// một chú thích nói dối là có người dùng. Phép đo nay tiêm thẳng `duongKhoa` vào lời gọi, nên
// hằng này không còn lý do tồn tại.
