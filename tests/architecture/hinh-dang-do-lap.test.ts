// ==============================================================================================
// [khoản nợ 67] HÌNH DẠNG QUYỀN CỦA `do-lap.yml` — TOKEN GHI ISSUE KHÔNG NẰM CÙNG JOB VỚI MÃ BÊN THỨ BA
//
// Bản trước khai `permissions` ở mức WORKFLOW (`contents: read` + `issues: write`), nên token của CHÍNH job chạy
// `pnpm install --frozen-lockfile` (script vòng đời của cả cây phụ thuộc) và `pnpm test:int` mang `issues: write`. Đóng: quyền mặc
// định của workflow RỖNG; `lap` chạy mã và chỉ `contents: read`; `bao-dong` cầm `issues: write`, không chạy mã, và coi output của
// `lap` là dữ liệu KHÔNG TIN.
//
// VÌ SAO PHẦN LỚN LÀ GHIM, KHÔNG PHẢI DÒ MẪU. Bản đầu của test này dò theo mẫu — khối `permissions`, danh sách đen lệnh chạy mã, chuỗi
// con `needs.lap.outputs.`, kiểm theo dòng. Lượt soi 55 đưa ra những văn bản HỢP LỆ làm nó xanh trong khi bảo đảm vỡ: một job id viết
// hoa bị gộp vào thân `lap`; `env:` mức workflow mang một PAT; `needs['lap'].outputs[…]` hay `toJSON(needs)`; giá trị thô trên CÙNG
// dòng với phép kiểm; bước dạng `- run:`; chú thích ` #` cắt mất phần sau. Nên:
//   ⑴ cấu trúc ghim theo TẬP KHOÁ: mức cao nhất đúng {name, on, permissions, jobs} với `permissions: {}`; sự kiện đúng {schedule,
//      workflow_dispatch}; job đúng [lap, bao-dong], và mọi dòng thụt 2 dưới `jobs:` phải là một khai báo job hợp lệ;
//   ⑵ `lap`: khoá mức job đúng tập đã khai; khối quyền, khối outputs và bước fail-closed cuối GHIM NGUYÊN VĂN; checkout giữ
//      `persist-credentials: false`; không `secrets`, `github.token` hay `GITHUB_TOKEN` ở dòng nào không phải chú thích;
//   ⑶ `bao-dong`: CẢ THÂN — tới hết tệp, kể cả chú thích — GHIM NGUYÊN VĂN. Một job nhỏ cầm quyền ghi thì mọi thay đổi của nó phải hiện
//      ra như một thay đổi của test, và người duyệt đọc được cả hai.
// Cấu trúc đọc trên dòng có nghĩa: bỏ dòng trống và dòng chú thích NGUYÊN DÒNG, không cắt gì giữa dòng. Đọc bằng regex như
// `hinh-dang-ci.test.ts` — dự án không có phụ thuộc YAML; cái giá (bám cách viết) ở đây là chủ đích.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const VAN = readFileSync(fileURLToPath(new URL("../../.github/workflows/do-lap.yml", import.meta.url)), "utf8").replace(/\r\n/gu, "\n");

const MUC_CAO_NHAT = ["name", "on", "permissions", "jobs"];
const SU_KIEN = ["schedule", "workflow_dispatch"];
const CAC_JOB = ["lap", "bao-dong"];
const KHOA_LAP = ["name", "runs-on", "timeout-minutes", "permissions", "outputs", "steps"];
const QUYEN_LAP = ["    permissions:", "      contents: read"];
const OUTPUTS_LAP = [
  "    outputs:",
  "      ty_le: ${{ steps.do.outputs.ty_le }}",
  "      so_do: ${{ steps.do.outputs.so_do }}",
  "      so_do_that: ${{ steps.do.outputs.so_do_that }}",
  "      ten_do: ${{ steps.do.outputs.ten_do }}",
];
const BUOC_CUOI_LAP = [
  "      - name: Fail-closed — ty le khac 0 thi job DO",
  "        env:",
  "          SO_DO: ${{ steps.do.outputs.so_do }}",
  '        run: test "${SO_DO:-x}" = "0"',
];
const BAO_DONG = [
  "  bao-dong:",
  "    name: Bao dong — mo hoac binh luan mot issue mang con so",
  "    needs: lap",
  "    # [khoan no 65] Chay CA khi `lap` do — do la toan bo diem cua no.",
  "    # [luot soi 55 N2] Dieu kien la \"`lap` KHONG xanh, HOAC so do khac 0\". Ban mot viet \"so do khac 0 VA khac rong\": khi",
  "    # `lap` chet TRUOC khi ghi outputs (qua han, buoc dem hong, runner mat trong luc tai log), khoa `so_do` VANG, va phep so",
  "    # sanh cua bieu thuc ep gia tri vang ve 0 — `so_do != '0'` SAI, nen bao dong im lang dung luc can nhat. `always()`, khong",
  "    # phai `!cancelled()`: mot luot bi huy cung mo issue \"KHONG HOAN TAT\" — on hon mot lan qua han im lang.",
  "    if: always() && (needs.lap.result != 'success' || needs.lap.outputs.so_do != '0')",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 10",
  "    permissions:",
  "      issues: write",
  "    steps:",
  "      - name: Bao dong — mo hoac binh luan mot issue mang con so",
  "        env:",
  "          GH_TOKEN: ${{ github.token }}",
  "          # Khong checkout nen `gh` khong suy ra kho tu `.git` — neu thang.",
  "          GH_REPO: ${{ github.repository }}",
  "          TY_LE_THO: ${{ needs.lap.outputs.ty_le }}",
  "          SO_DO_THO: ${{ needs.lap.outputs.so_do }}",
  "          SO_DO_THAT_THO: ${{ needs.lap.outputs.so_do_that }}",
  "          TEN_DO_THO: ${{ needs.lap.outputs.ten_do }}",
  "          KET_QUA_LAP_THO: ${{ needs.lap.result }}",
  "          # [luot soi 55 L4] Nhan \"mui dot bien\" lay tu SU KIEN (input kieu boolean cua `workflow_dispatch`), khong tu output",
  "          # cua `lap`: ma ben thu ba trong `lap` khong duoc tu dan nhan \"khong phai mot phep do\" len mot bao dong that.",
  "          DOT_BIEN_SU_KIEN: ${{ github.event.inputs.dot_bien || 'false' }}",
  "        run: |",
  "          # [khoan no 67] Cac gia tri *_THO do job `lap` ghi, hay do GitHub ghi ve `lap` — job chay ma ben thu ba — nen la du",
  "          # lieu KHONG TIN: moi gia tri qua env (khong noi suy vao than script) va bi kiem hinh dang TRON CHUOI truoc khi dung:",
  "          # `[[ =~ ^...$ ]]` va `case`, khong `grep -x` — grep so THEO DONG, nen \"2/10<xuong dong>rac\" van lot (do tren bash",
  "          # 5.2 cua runner ubuntu va Git Bash 5.3, §S1.62). Kiem hinh dang bao ve KENH ISSUE, khong bao ve TINH DUNG cua phep do.",
  "          khong_hop_le=\"\"",
  "          if [[ \"$TY_LE_THO\" =~ ^[0-9]{1,3}/[0-9]{1,3}$ ]]; then TY_LE=\"$TY_LE_THO\"; else TY_LE=\"khong hop le\"; khong_hop_le=1; fi",
  "          if [[ \"$SO_DO_THO\" =~ ^[0-9]{1,3}$ ]]; then co_so_do=1; else co_so_do=\"\"; khong_hop_le=1; fi",
  "          if [[ \"$SO_DO_THAT_THO\" =~ ^[0-9]{1,3}$ ]]; then SO_DO_THAT=\"$SO_DO_THAT_THO\"; else SO_DO_THAT=\"khong hop le\"; khong_hop_le=1; fi",
  "          case \"$KET_QUA_LAP_THO\" in success|failure|cancelled|skipped) KET_QUA_LAP=\"$KET_QUA_LAP_THO\" ;; *) KET_QUA_LAP=\"khong hop le\" ;; esac",
  "          case \"$DOT_BIEN_SU_KIEN\" in true) LA_DOT_BIEN=\"true\" ;; *) LA_DOT_BIEN=\"false\" ;; esac",
  "          TEN_DO=\"$(printf '%s' \"$TEN_DO_THO\" | tr -c 'A-Za-z0-9._/() -' '?' | cut -c1-400)\"",
  "          moc=\"[flaky-tang-tich-hop]\"",
  "          nhan=\"flaky-tang-tich-hop\"",
  "          url=\"${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}\"",
  "          them=\"\"",
  "          if [ -z \"$co_so_do\" ]; then",
  "            # [luot soi 55 N2] `lap` khong de lai so do dung duoc: qua han, buoc dem hong, runner mat, hay output sai hinh dang.",
  "            dau=\"Luot do KHONG HOAN TAT — khong co so do dung duoc (job lap: ${KET_QUA_LAP})\"",
  "          # Chi duoc dan nhan \"khong phai mot phep do\" khi KHONG co luot do that nao. Nguoc lai,",
  "          # day la mot bao dong THAT co kem mot mui do — va tieu de phai noi dieu quan trong hon.",
  "          elif [ \"$LA_DOT_BIEN\" = \"true\" ] && [ \"${SO_DO_THAT:-0}\" = \"0\" ]; then",
  "            dau=\"MUI DOT BIEN (khoan no 65) — day KHONG phai mot phep do\"",
  "          else",
  "            dau=\"Ty le flaky cua tang tich hop KHAC 0\"",
  "            if [ \"$LA_DOT_BIEN\" = \"true\" ]; then",
  "              # Phai dung `printf` chu khong phai mot chuoi co \"\\n\": `$them` di vao mot doi so `%s`",
  "              # cua printf ben duoi, va printf KHONG dien giai escape trong DOI SO — mot \"\\n\" viet",
  "              # thang se hien nguyen chu `\\n` trong than issue.",
  "              them=\"$(printf '\\n\\n> **Luot nay CO kem mot mui dot bien**, nhung so luot do THAT la `%s` — day la mot bao dong that.' \"${SO_DO_THAT}\")\"",
  "            fi",
  "          fi",
  "          if [ -n \"$khong_hop_le\" ]; then",
  "            them=\"$them$(printf '\\n\\n> Mot gia tri tu job `lap` sai hinh dang hay vang — da thay bang `khong hop le`. Doc log luot chay.')\"",
  "          fi",
  "          than=\"$(printf '%s\\n\\n- **Ty le do:** `%s`\\n- **Ket qua job lap:** `%s`\\n- **Tep do:** `%s`\\n- **Luot chay:** %s\\n- **Commit:** `%s`\\n\\n%s\\n' \\",
  "            \"$dau\" \"$TY_LE\" \"$KET_QUA_LAP\" \"${TEN_DO:-khong doc duoc ten}\" \"$url\" \"$GITHUB_SHA\" \\",
  "            \"Job \\`do-lap\\` la fail-closed CO CHU DICH. Issue nay ton tai vi mot lan do ma khong ai doc thi chi la fail-lang — xem khoan no 65 trong docs/STATE.md.$them\")\"",
  "          # [review an ninh luot 16, L2] Neo vao thu CHI workflow nay tao duoc. Ban dau tim bang",
  "          # `--search \"$moc in:title\"` — mot phep khop token tren tieu de TU DO, khong loc tac gia.",
  "          # Tren kho cong khai, bat ky ai co quyen DOC cung mo duoc mot issue tua",
  "          # \"[flaky-tang-tich-hop] ...\"; tu luc do moi bao dong cua khoan no 65 roi vao luong do HO",
  "          # mo, ho dat khung cau chuyen o binh luan dau, va nguoi truc doc con so trong boi canh ho",
  "          # dung. Nhan chi gan duoc boi nguoi co quyen triage/write, va kiem them tac gia thi phai",
  "          # co quyen write moi gia mao duoc.",
  "          # [luot soi 55 I4 — DO] `gh` 2.98 tra `author.login` cua issue do GITHUB_TOKEN mo la `app/github-actions`, KHONG phai",
  "          # `github-actions`: issue #22 (workflow nay mo o S1.25) mang dung `app/github-actions`, loc cu tren 50 issue gan nhat",
  "          # ra rong, va `--app github-actions` cung ra rong — nhanh binh luan KHONG THE chay, moi bao dong mo mot issue moi.",
  "          gh label create \"$nhan\" --color B60205 \\",
  "            --description \"Bao dong ty le flaky tang tich hop (khoan no 65)\" 2>/dev/null || true",
  "          cu=\"$(gh issue list --state open --label \"$nhan\" --json number,author \\",
  "                  --jq 'map(select(.author.login == \"app/github-actions\")) | .[0].number // empty' || true)\"",
  "          if [ -n \"$cu\" ]; then",
  "            gh issue comment \"$cu\" --body \"$than\"",
  "            echo \"da binh luan vao issue #$cu\"",
  "          else",
  "            gh issue create --title \"$moc $dau\" --body \"$than\" --label \"$nhan\"",
  "          fi",
  "",
].join("\n");

const thut = (d: string): number => d.length - d.trimStart().length;
const trungTap = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Dòng có nghĩa: bỏ dòng trống và dòng chú thích NGUYÊN DÒNG; không cắt gì giữa dòng. */
function dongCoNghia(van: string): string[] {
  return van.split("\n").filter((d) => d.trim() !== "" && !d.trimStart().startsWith("#"));
}

/** Khối con của dòng `i`: các dòng tiếp theo thụt SÂU hơn nó. */
function khoiCon(dong: readonly string[], i: number): string[] {
  const ra: string[] = [];
  for (let j = i + 1; j < dong.length && thut(dong[j]!) > thut(dong[i]!); j++) ra.push(dong[j]!);
  return ra;
}

/** Khoá của các dòng thụt ĐÚNG `muc`; dòng nào không phải `khoá:` hợp lệ thì thành lỗi (fail-closed). */
function khoaOMuc(dong: readonly string[], muc: number, nhan: string, loi: string[]): string[] {
  const mau = new RegExp(`^ {${muc}}([A-Za-z_][A-Za-z0-9_-]*):(?: .*)?$`, "u");
  const ra: string[] = [];
  for (const d of dong.filter((x) => thut(x) === muc)) {
    const m = mau.exec(d);
    if (m) ra.push(m[1]!);
    else loi.push(`${nhan}: dòng không nhận ra: ${d.trim()}`);
  }
  return ra;
}

function kiem(van: string): string[] {
  const loi: string[] = [];
  const dong = dongCoNghia(van);

  const cao = khoaOMuc(dong, 0, "mức cao nhất", loi);
  if (!trungTap(cao, MUC_CAO_NHAT)) loi.push(`mức cao nhất phải đúng {name, on, permissions, jobs} — đang là {${cao.join(", ")}}`);
  if (!dong.includes("permissions: {}")) loi.push("quyền mức workflow phải là đúng `permissions: {}`");

  const iOn = dong.indexOf("on:");
  const suKien = iOn < 0 ? [] : khoaOMuc(khoiCon(dong, iOn), 2, "on", loi);
  if (!trungTap(suKien, SU_KIEN)) loi.push(`sự kiện phải đúng {schedule, workflow_dispatch} — đang là {${suKien.join(", ")}}`);

  const iJobs = dong.indexOf("jobs:");
  const con = iJobs < 0 ? [] : khoiCon(dong, iJobs);
  if (con.some((d) => thut(d) < 2)) loi.push("jobs: có dòng thụt lề lạ");
  const dau = con.flatMap((d, k) => (thut(d) === 2 ? [k] : []));
  const ids = dau.map((k) => /^ {2}([A-Za-z_][A-Za-z0-9_-]*):$/u.exec(con[k]!)?.[1] ?? `<không nhận ra: ${con[k]!.trim()}>`);
  if (JSON.stringify(ids) !== JSON.stringify(CAC_JOB)) loi.push(`job phải đúng [lap, bao-dong] theo thứ tự — đang là [${ids.join(", ")}]`);

  const k = ids.indexOf("lap");
  if (k >= 0) {
    const lap = con.slice(dau[k]! + 1, dau[k + 1] ?? con.length);
    const khoa = khoaOMuc(lap, 4, "lap", loi);
    if (!trungTap(khoa, KHOA_LAP)) loi.push(`lap: khoá mức job phải đúng {${KHOA_LAP.join(", ")}} — đang là {${khoa.join(", ")}}`);
    const khoi = (ten: string): string[] => {
      const i = lap.findIndex((d) => thut(d) === 4 && d.startsWith(`    ${ten}:`));
      return i < 0 ? [] : [lap[i]!, ...khoiCon(lap, i)];
    };
    const quyen = khoi("permissions");
    if (JSON.stringify(quyen) !== JSON.stringify(QUYEN_LAP)) {
      loi.push(`lap: quyền phải đúng contents: read — đang là ${JSON.stringify(quyen.map((d) => d.trim()))}`);
    }
    if (JSON.stringify(khoi("outputs")) !== JSON.stringify(OUTPUTS_LAP)) loi.push("lap: outputs phải đúng khối đã ghim");
    if (JSON.stringify(lap.slice(-BUOC_CUOI_LAP.length)) !== JSON.stringify(BUOC_CUOI_LAP)) {
      loi.push("lap: bước cuối phải đúng bước fail-closed đã ghim");
    }
    if (!lap.includes("          persist-credentials: false")) loi.push("lap: checkout phải giữ persist-credentials: false");
    const cham = lap.filter((d) => /secrets|github\.token|GITHUB_TOKEN/iu.test(d));
    if (cham.length > 0) loi.push(`lap: chạm secrets hay token — ${cham.map((d) => d.trim()).join(" / ")}`);
  }

  const iBd = van.indexOf("\n  bao-dong:\n");
  const bd = iBd < 0 ? "" : van.slice(iBd + 1);
  if (bd !== BAO_DONG) {
    const a = bd.split("\n");
    const b = BAO_DONG.split("\n");
    const lech = a.findIndex((x, j) => x !== b[j]);
    const vt = lech < 0 ? Math.min(a.length, b.length) : lech;
    loi.push(`bao-dong: thân phải đúng nguyên văn đã ghim — lệch từ dòng ${vt + 1} của job: ${JSON.stringify(a[vt] ?? "<hết>")}`);
  }
  return loi;
}

/** Thay ĐÚNG MỘT lần — neo khớp 0 hay 2 lần là lỗi của chính test (hàm thay thế: `$` trong `moi` không là mẫu JS). */
function doi(goc: string, cu: string, moi: string): string {
  const dem = goc.split(cu).length - 1;
  if (dem !== 1) throw new Error(`neo đột biến khớp ${dem} lần, phải là 1: ${cu}`);
  return goc.replace(cu, () => moi);
}

describe("[khoản nợ 67] hình dạng quyền của do-lap.yml", () => {
  it("[khoản nợ 67] workflow thật: cấu trúc ghim theo tập khoá, lap chỉ đọc và giữ fail-closed, bao-dong đúng nguyên văn đã ghim", () => {
    expect(kiem(VAN)).toEqual([]);
  });

  it("[khoản nợ 67] bộ dò không rỗng ruột — mỗi đột biến trên CHÍNH tệp thật đỏ đúng vế của nó; chú thích nguyên dòng thì không", () => {
    const LAP_QUYEN = "    permissions:\n      contents: read\n";
    const ca: [string, string, string][] = [
      ["env mức workflow mang PAT", doi(VAN, "\npermissions: {}\n", "\nenv:\n  GH_TOKEN: ${{ secrets.PAT_BAO_DONG }}\npermissions: {}\n"), "mức cao nhất phải đúng"],
      ["quyền mức workflow cũ", doi(VAN, "\npermissions: {}\n", "\npermissions:\n  contents: read\n  issues: write\n"), "quyền mức workflow"],
      ["thêm sự kiện pull_request_target", doi(VAN, "\n  workflow_dispatch:\n", "\n  pull_request_target:\n  workflow_dispatch:\n"), "sự kiện phải đúng"],
      [
        "job id viết hoa chen giữa",
        doi(VAN, "\n  bao-dong:\n", "\n  Xuat_bao_cao:\n    needs: lap\n    runs-on: ubuntu-latest\n    permissions:\n      issues: write\n    steps:\n      - run: echo hi\n\n  bao-dong:\n"),
        "job phải đúng [lap, bao-dong]",
      ],
      ["job id có ngoặc kép", doi(VAN, "\n  bao-dong:\n", '\n  "dong-issue":\n    runs-on: ubuntu-latest\n\n  bao-dong:\n'), "không nhận ra"],
      ["lap cầm issues: write", doi(VAN, LAP_QUYEN, `${LAP_QUYEN}      issues: write\n`), "lap: quyền phải đúng"],
      ["lap write-all một dòng", doi(VAN, LAP_QUYEN, "    permissions: write-all\n"), "lap: quyền phải đúng"],
      ["lap env mức job mang secrets", doi(VAN, LAP_QUYEN, `${LAP_QUYEN}    env:\n      GH_TOKEN: \${{ secrets.PAT }}\n`), "lap: khoá mức job"],
      ["lap container", doi(VAN, LAP_QUYEN, `${LAP_QUYEN}    container: node:22-slim\n`), "lap: khoá mức job"],
      ["lap mất so_do ở outputs", doi(VAN, "      so_do: ${{ steps.do.outputs.so_do }}\n", ""), "lap: outputs"],
      ["fail-closed đọc hằng 0", doi(VAN, "          SO_DO: ${{ steps.do.outputs.so_do }}\n", '          SO_DO: "0"\n'), "lap: bước cuối"],
      ["bỏ persist-credentials", doi(VAN, "          persist-credentials: false\n", ""), "persist-credentials"],
      ["lap bước dùng github.token", doi(VAN, "          SO_LUOT: ${{", "          GH_TOKEN: ${{ github.token }}\n          SO_LUOT: ${{"), "lap: chạm secrets hay token"],
      ["bao-dong if bỏ nhánh lap đỏ", doi(VAN, "needs.lap.result != 'success' || ", ""), "bao-dong: thân phải đúng"],
      ["bao-dong toJSON(needs)", doi(VAN, '"$dau" "$TY_LE" "$KET_QUA_LAP"', '"$dau" "${{ toJSON(needs) }}" "$KET_QUA_LAP"'), "bao-dong: thân phải đúng"],
      ["bao-dong dùng giá trị thô cùng dòng", doi(VAN, 'else TY_LE="khong hop le"', 'else TY_LE="khong hop le: $TY_LE_THO"'), "bao-dong: thân phải đúng"],
      ["bao-dong đổi sau dấu # giữa dòng", doi(VAN, 'echo "da binh luan vao issue #$cu"', 'echo "da binh luan vao issue #$TEN_DO_THO"'), "bao-dong: thân phải đúng"],
    ];
    expect(kiem(VAN), "đối chứng: tệp thật").toEqual([]);
    for (const [ten, van, mong] of ca) {
      expect(kiem(van), ten).toEqual(expect.arrayContaining([expect.stringContaining(mong)]));
    }
    expect(kiem(doi(VAN, LAP_QUYEN, `${LAP_QUYEN}    # KHONG issues: write o day\n`)), "chú thích nguyên dòng").toEqual([]);
  });
});
