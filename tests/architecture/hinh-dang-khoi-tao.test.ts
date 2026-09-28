// ==============================================================================================
// [S1.9103 / ADR-111] HÌNH DẠNG CỦA ĐƯỜNG KHỞI TẠO TỔ CHỨC TRÊN PROD — WORKFLOW, IAM, TASK, IMAGE
//
// Bảo đảm của đường này rải ở năm tệp cấu hình, và mỗi tệp cần mốc chết của nó:
//   ⑴ `khoi-tao.yml`: chỉ workflow_dispatch; quyền mặc định RỖNG; ~~CHUNG nhóm concurrency với deploy.yml~~ **[lượt soi]** nhóm
//      concurrency RIÊNG (một lần khởi tạo chờ duyệt không chặn hotfix); đúng hai job [build, chay]; build không
//      id-token/environment/AWS, chọn mã tổ chức và KIỂM ĐẦU VÀO trước docker build; chay ở environment `prod-khoi-tao`, role
//      tp-deploy, sau build, và **[lượt soi]** kiểm người duyệt TRƯỚC khi lấy quyền AWS.
//   ⑵ `inputs.*` chỉ ở dòng `env:` — không nội suy vào `run:` —, và hai job nhận ĐÚNG ~~sáu~~ **[lượt soi]** bảy đầu vào ấy.
//   ⑶ `uses:` ghim SHA; checkout không giữ credential; pnpm/npm/docker build chỉ ở build; không secrets; ~~không GITHUB_TOKEN~~
//      **[lượt soi]** `github.token` ở ĐÚNG một bước — bước đọc lịch sử duyệt (`actions: read`).
//   ⑷ stack 30: tp-deploy tin ĐÚNG [prod, prod-khoi-tao] (tên environment của workflow), worker chỉ prod-worker; DeleteSecret
//      CHỈ trên `tp/khoi-tao/ban-khai/*` và chỉ ở tp-deploy; ~~đọc log chỉ `/tp/khoi-tao`~~ **[lượt soi]** tp-deploy không đọc log
//      nào; PassRole có tp-khoi-tao; task role khởi tạo chỉ đọc `tp/khoi-tao/*`.
//   ⑸ stack 90: task `tp-khoi-tao` mang role tp-khoi-tao, log `/tp/khoi-tao`, MỘT secret (DATABASE_URL từ
//      tp/khoi-tao/database-url), region cho Secrets Manager; SG nói được với CSDL; output `bien_github_khoi_tao` là ĐÚNG hai
//      biến workflow đọc.
//   ⑹ image: đích `khoi-tao` có ENTRYPOINT là công cụ và KHÔNG CMD; workflow build đúng đích ấy; tên container trong lệnh của
//      script = họ task definition; **[lượt soi]** hình dạng mà `dang-ky` ghim cho họ `tp-khoi-tao` = task definition của stack 90.
// Đọc bằng regex như `hinh-dang-deploy.test.ts` — dự án không có phụ thuộc YAML/HCL; cái giá (bám cách viết) là chủ đích.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const doc = (duong: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${duong}`, import.meta.url)), "utf8").replace(/\r\n/gu, "\n");

const VAN = doc(".github/workflows/khoi-tao.yml");
const TF30 = doc("infra/terraform/30-prod-iam/main.tf");
const TF90 = doc("infra/terraform/90-ecs/main.tf");
const CHUNG = doc("infra/terraform/chung/main.tf");
const DOCKER = doc("deploy/Dockerfile");
const SCRIPT = doc("deploy/trien-khai.sh");

const coNghia = (van: string): string[] => van.split("\n").filter((d) => d.trim() !== "" && !d.trimStart().startsWith("#"));

function thanJob(ten: string): string {
  const batDau = VAN.indexOf(`\n  ${ten}:\n`);
  expect(batDau, `không tìm thấy job "${ten}"`).toBeGreaterThan(-1);
  const sau = VAN.slice(batDau + 1);
  const ketThuc = sau.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/u);
  return ketThuc === -1 ? sau : sau.slice(0, ketThuc + 1);
}

function giaTriChung(khoa: string): string {
  const m = new RegExp(`\\b${khoa}\\s*=\\s*"([^"]+)"`, "u").exec(CHUNG);
  expect(m, `không đọc được ${khoa} trong infra/terraform/chung`).not.toBeNull();
  return m?.[1] ?? "";
}

/** Khối `<ten> = {` … `}` trong `local.deploy` của stack 30. */
function khoiDeploy(ten: string): string {
  const m = new RegExp(`\\n {4}${ten} = \\{\\n([\\s\\S]*?)\\n {4}\\}`, "u").exec(TF30);
  expect(m, `không đọc được local.deploy.${ten}`).not.toBeNull();
  return m?.[1] ?? "";
}

const DAU_VAO = ["CHE_DO", "BI_MAT", "PHIEN_BAN", "BAM", "TO_CHUC", "SO_NGUOI", "VAI"];

describe("[S1.9103] hình dạng của khoi-tao.yml", () => {
  const dong = coNghia(VAN);

  it("⑴ mức cao nhất {name, on, permissions, concurrency, jobs}; `permissions: {}`; chỉ workflow_dispatch; nhóm concurrency RIÊNG", () => {
    expect(dong.filter((d) => /^[A-Za-z]/u.test(d)).map((d) => d.split(":")[0])).toEqual(["name", "on", "permissions", "concurrency", "jobs"]);
    expect(dong).toContain("permissions: {}");
    const suKien = dong.filter((d) => /^ {2}[a-z_]+:/u.test(d) && dong.indexOf(d) < dong.indexOf("permissions: {}"));
    expect(suKien.map((d) => d.trim())).toEqual(["workflow_dispatch:"]);
    // [lượt soi] Nhóm RIÊNG: một lần khởi tạo chờ duyệt (tới 30 ngày) không giữ nhóm của deploy.yml. Chạy trùng migrate thì an
    // toàn: hardening thu hồi rồi cấp lại trong MỘT giao dịch, nên task khởi tạo không thấy quyền nửa vời.
    expect(VAN).toMatch(/\nconcurrency:\n {2}group: khoi-tao-prod\n {2}cancel-in-progress: false\n/u);
    expect(doc(".github/workflows/deploy.yml")).toMatch(/\nconcurrency:\n {2}group: deploy-prod\n/u);
  });

  it("⑴ job đúng [build, chay]; build không AWS, kiểm đầu vào TRƯỚC docker build; chay ở prod-khoi-tao, role tp-deploy, sau build", () => {
    const jobs = dong.slice(dong.indexOf("jobs:") + 1).filter((d) => /^ {2}[A-Za-z0-9_-]+:/u.test(d));
    expect(jobs.map((d) => d.trim())).toEqual(["build:", "chay:"]);
    const build = thanJob("build");
    expect(build).not.toMatch(/id-token|environment:|configure-aws-credentials|role-to-assume/u);
    expect(build).toMatch(/ {4}permissions:\n {6}contents: read\n {4}outputs:\n/u);
    expect(build).toMatch(/if: github\.ref == 'refs\/heads\/master'/u);
    const chon = build.indexOf("if [ \"$CHE_DO\" = tao ]; then ma=$(cat /proc/sys/kernel/random/uuid); fi");
    const kiem = build.indexOf('run: bash deploy/trien-khai.sh kiem-khoi-tao >> "$GITHUB_STEP_SUMMARY"');
    expect(chon).toBeGreaterThan(-1);
    expect(kiem).toBeGreaterThan(chon);
    expect(build.indexOf("docker build -f deploy/Dockerfile --target khoi-tao")).toBeGreaterThan(kiem);
    expect(build).toContain("\n    outputs:\n      ma_to_chuc: ${{ steps.chon.outputs.ma_to_chuc }}\n");

    const chay = thanJob("chay");
    expect(chay).toMatch(/\n {4}needs: build\n/u);
    expect(chay).toMatch(/\n {4}environment: prod-khoi-tao\n/u);
    expect(chay).toMatch(/ {4}permissions:\n {6}contents: read\n {6}actions: read\n {6}id-token: write\n/u);
    expect([...VAN.matchAll(/actions: read/gu)]).toHaveLength(1);
    // [lượt soi] Lịch sử duyệt được kiểm TRƯỚC khi job có quyền AWS.
    const duyet = chay.indexOf('bash deploy/trien-khai.sh kiem-nguoi-duyet "$RUNNER_TEMP/duyet.json"');
    expect(duyet).toBeGreaterThan(-1);
    expect(chay.indexOf("configure-aws-credentials")).toBeGreaterThan(duyet);
    expect(chay).toContain('gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/approvals" > "$RUNNER_TEMP/duyet.json"');
    expect([...VAN.matchAll(/id-token: write/gu)]).toHaveLength(1);
    const prod = giaTriChung("prod");
    expect(chay).toMatch(new RegExp(`role-to-assume: arn:aws:iam::${prod}:role/${giaTriChung("deploy")}\\n`, "u"));
    expect([...VAN.matchAll(/role-to-assume:/gu)]).toHaveLength(1);
    for (const t of [...VAN.matchAll(/TAI_KHOAN: "(\d+)"/gu)]) expect(t[1]).toBe(prod);
    // Thứ tự của chay: đẩy image → đăng ký họ tp-khoi-tao với ĐÚNG role tp-khoi-tao → chạy và xoá.
    const day = chay.indexOf("trien-khai.sh day anh/khoi-tao.tar.gz tp-khoi-tao");
    const dangKy = chay.indexOf(`trien-khai.sh dang-ky tp-khoi-tao "$anh_kt" ${giaTriChung("khoi_tao")})`);
    const chayTask = chay.indexOf('bash deploy/trien-khai.sh khoi-tao "$td_kt" | tee -a "$GITHUB_STEP_SUMMARY"');
    expect(day).toBeGreaterThan(-1);
    expect(dangKy).toBeGreaterThan(day);
    expect(chayTask).toBeGreaterThan(dangKy);
  });

  it("⑵ inputs.* và mọi giá trị ngoài chỉ ở dòng env: (không nội suy vào run:); hai job nhận ĐÚNG bảy đầu vào", () => {
    const dongInput = dong.filter((d) => /\$\{\{ (inputs|needs|steps)\./u.test(d) && !d.includes("outputs:") && !/^ {6}ma_to_chuc:/u.test(d));
    expect(dongInput.length).toBeGreaterThan(0);
    for (const d of dongInput) expect(d, d).toMatch(/^ {10}[A-Z_]+: \$\{\{ (inputs\.[a-z_]+|steps\.chon\.outputs\.ma_to_chuc|needs\.build\.outputs\.ma_to_chuc) \}\}$/u);
    for (const d of dong.filter((x) => /^ {8}run:|^ {10}\S/u.test(x) && x.includes("${{"))) {
      expect(d, d).not.toMatch(/^ {8}run:.*\$\{\{/u);
    }
    for (const job of ["build", "chay"]) {
      const khoi = thanJob(job).split("\n    steps:")[1] ?? "";
      const ten = [...khoi.matchAll(/^ {10}([A-Z_]+): \$\{\{ inputs\.([a-z_]+) \}\}$/gmu)].map((m) => [m[1], m[2]]);
      const buocCuoi = ten.slice(ten.length - DAU_VAO.length);
      expect(buocCuoi, job).toEqual(DAU_VAO.map((b) => [b, b.toLowerCase()]));
    }
    // Mã tổ chức: job build chọn, job chay đọc qua needs; người bấm đi kèm ở cả hai.
    expect(thanJob("build")).toContain("          MA_TO_CHUC: ${{ steps.chon.outputs.ma_to_chuc }}\n");
    expect(thanJob("chay")).toContain("          MA_TO_CHUC: ${{ needs.build.outputs.ma_to_chuc }}\n");
    for (const job of ["build", "chay"]) {
      expect(thanJob(job), job).toContain("          ACTOR: ${{ github.actor }}\n          TRIGGERING_ACTOR: ${{ github.triggering_actor }}\n");
    }
    const khai = [...VAN.matchAll(/^ {6}([a-z_]+):\n {8}description:/gmu)].map((m) => m[1]);
    expect(khai).toEqual(DAU_VAO.map((b) => b.toLowerCase()));
    expect(VAN).not.toMatch(/\$\{\{ github\.event\.inputs/u);
  });

  it("⑶ uses ghim SHA; checkout không giữ credential; mã bên thứ ba chỉ ở build; không secrets", () => {
    const uses = dong.filter((d) => /\buses:/u.test(d));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40}( #.*)?$/u);
    const checkout = VAN.split("\n").filter((d) => d.includes("actions/checkout@")).length;
    expect([...VAN.matchAll(/persist-credentials: false/gu)]).toHaveLength(checkout);
    expect(coNghia(thanJob("chay")).join("\n")).not.toMatch(/\b(pnpm|npm|npx|yarn)\b|docker build/u);
    expect(coNghia(VAN).join("\n")).not.toMatch(/secrets\.|GITHUB_TOKEN|pull_request_target/u);
    // [lượt soi] `github.token` ở đúng một dòng, của bước đọc lịch sử duyệt — trước khi có quyền AWS.
    const token = dong.filter((d) => d.includes("github.token"));
    expect(token).toEqual(["          GH_TOKEN: ${{ github.token }}"]);
  });
});

describe("[S1.9103] IAM của stack 30 cho đường khởi tạo", () => {
  it("⑷ tp-deploy tin đúng [prod, prod-khoi-tao] — tên environment của workflow; worker chỉ prod-worker", () => {
    expect(khoiDeploy("deploy")).toMatch(/\n? {6}environments += \["prod", "prod-khoi-tao"\]\n/u);
    expect(khoiDeploy("deploy_worker")).toMatch(/\n? {6}environments += \["prod-worker"\]\n/u);
    expect(TF30).toContain('values   = [for e in each.value.environments : "repo:${module.chung.github_repo}:environment:${e}"]');
    expect(VAN).toContain("\n    environment: prod-khoi-tao\n");
    expect(doc(".github/workflows/deploy.yml")).not.toContain("prod-khoi-tao");
  });

  it("⑷ DeleteSecret CHỈ trên tp/khoi-tao/ban-khai/* và chỉ ở tp-deploy; tp-deploy không đọc log; PassRole có tp-khoi-tao", () => {
    expect(khoiDeploy("deploy")).toMatch(/\n {6}xoa_secret = \["\$\{local\.secret_arn\}\/khoi-tao\/ban-khai\/\*"\]/u);
    expect(khoiDeploy("deploy_worker")).toMatch(/\n {6}xoa_secret += \[\]/u);
    expect([...TF30.matchAll(/secretsmanager:DeleteSecret/gu)]).toHaveLength(1);
    expect(TF30).toMatch(/actions += \["secretsmanager:DeleteSecret"\]\n {6}resources = each\.value\.xoa_secret\n/u);
    expect(khoiDeploy("deploy")).toMatch(/\n {6}doc_log = \[\]/u);
    expect(SCRIPT).not.toMatch(/filter-log-events|logs /u);
    expect(khoiDeploy("deploy")).toMatch(/pass_roles += \[[^\]]*local\.role_arn\.khoi_tao\]/u);
    expect(khoiDeploy("deploy_worker")).not.toMatch(/khoi_tao/u);
    expect(TF30).toMatch(/repo_app += \[[^\]]*"tp-khoi-tao"\]/u);
  });

  it("⑷ task role khởi tạo đọc đúng nhánh tp/khoi-tao/*; tên role một chỗ ở infra/terraform/chung", () => {
    expect(giaTriChung("khoi_tao")).toBe("tp-khoi-tao");
    expect(TF30).toMatch(/\n {4}khoi_tao = "khoi-tao"\n/u);
    expect(TF30).toContain('resources = ["${local.secret_arn}/${each.value}/*"]');
  });
});

describe("[S1.9103] task tp-khoi-tao của stack 90 và image", () => {
  it("⑸ task: role tp-khoi-tao, log khoi-tao, một secret DATABASE_URL, region cho Secrets Manager; SG nói được với CSDL", () => {
    expect(TF90).toContain('khoi_tao = { ho = "tp-khoi-tao", role = local.role_arn.khoi_tao, cpu = 256, mem = 512, log = "khoi-tao", cong = [] }');
    const biMat = /\n {4}khoi_tao = \[\n([\s\S]*?)\n {4}\]/gu;
    const khoi = [...TF90.matchAll(biMat)].map((m) => m[1] ?? "");
    expect(khoi).toHaveLength(2); // env và bi_mat
    expect(khoi[0]).toContain('{ name = "TRUSTPROCURE_KHOI_TAO_REGION", value = local.region }');
    expect(khoi[1]!.trim().split("\n")).toEqual(['{ name = "DATABASE_URL", valueFrom = data.aws_secretsmanager_secret.khoi_tao_db.arn },']);
    expect(TF90).toMatch(/^data "aws_secretsmanager_secret" "khoi_tao_db" \{ name = "tp\/khoi-tao\/database-url" \}$/mu);
    expect(TF90).toMatch(/\n {4}khoi_tao = aws_security_group\.khoi_tao\.id\n/u);
    expect(TF90).toMatch(/for_each += toset\(\[[^\]]*"tp-khoi-tao"\]\)/u);
    expect(TF90).toMatch(/for_each += toset\(\[[^\]]*"khoi-tao"\]\)\n {2}name += "\/tp\/\$\{each\.key\}"/u);
  });

  it("⑸ output bien_github_khoi_tao = ĐÚNG hai biến workflow đọc", () => {
    const out = /output "bien_github_khoi_tao" \{[\s\S]*?value = \{\n([\s\S]*?)\n {2}\}/u.exec(TF90)?.[1] ?? "";
    const bien = [...out.matchAll(/^ {4}([A-Z_]+) += /gmu)].map((m) => m[1]);
    expect(bien).toEqual(["TP_SUBNETS_UNG_DUNG", "TP_SG_KHOI_TAO"]);
    expect([...VAN.matchAll(/\$\{\{ vars\.([A-Z_]+) \}\}/gu)].map((m) => m[1]).sort()).toEqual([...bien].sort());
  });

  it("⑹ image: đích khoi-tao — ENTRYPOINT là công cụ, KHÔNG CMD, user node, bó CA của RDS; cài phụ thuộc sản xuất của đúng gói", () => {
    const dich = DOCKER.slice(DOCKER.indexOf("FROM ${NODE_IMAGE} AS khoi-tao"));
    expect(dich.startsWith("FROM ${NODE_IMAGE} AS khoi-tao\n")).toBe(true);
    expect(dich).not.toMatch(/\nFROM /u);
    expect(dich).toContain("COPY --from=cai-khoi-tao --chown=root:root /app /app\nUSER node\n");
    expect(dich).toContain("NODE_EXTRA_CA_CERTS=/app/rds-ca.pem");
    expect(dich).toContain('ENTRYPOINT ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", "./tools/khoi-tao-to-chuc/register-ts-resolve.mjs", "tools/khoi-tao-to-chuc/src/index.ts"]');
    expect(dich).not.toMatch(/^CMD /mu);
    expect(DOCKER).toContain('FROM nguon AS cai-khoi-tao\nRUN pnpm install --frozen-lockfile --prod --filter "@trustprocure/khoi-tao-to-chuc..." && rm -rf /pnpm/store\n');
    expect(DOCKER).toContain("COPY tools/khoi-tao-to-chuc tools/khoi-tao-to-chuc\n");
  });

  it("⑹ tên container trong lệnh của script = họ task definition của stack 90", () => {
    const ten = /\{containerOverrides: \[\{name: "([^"]+)",/u.exec(SCRIPT)?.[1];
    expect(ten).toBe("tp-khoi-tao");
    expect(TF90).toContain(`ho = "${ten ?? ""}"`);
  });

  it("⑹ hình dạng mà dang-ky ghim cho họ tp-khoi-tao = task definition của stack 90 (biến, secret, root fs, log, execution role)", () => {
    // Biến và secret của task khởi tạo ở stack 90.
    const khoi = [...TF90.matchAll(/\n {4}khoi_tao = \[\n([\s\S]*?)\n {4}\]/gu)].map((m) => m[1] ?? "");
    expect(khoi[0]!.trim().split("\n").map((d) => d.trim())).toEqual([
      '{ name = "NODE_ENV", value = "production" },', '{ name = "TRUSTPROCURE_KHOI_TAO_REGION", value = local.region },']);
    expect(SCRIPT).toContain('== [["NODE_ENV", "production"], ["TRUSTPROCURE_KHOI_TAO_REGION", $region]]');
    expect(SCRIPT).toContain('([$c.secrets[]? | .name] == ["DATABASE_URL"])');
    expect(SCRIPT).toContain(':secret:tp/khoi-tao/database-url-[A-Za-z0-9]{6}$');
    expect(SCRIPT).toContain('$c.readonlyRootFilesystem == true');
    expect(TF90).toMatch(/\n {4}readonlyRootFilesystem = true\n/u);
    expect(SCRIPT).toContain('$c.logConfiguration.options["awslogs-group"] == "/tp/khoi-tao"');
    expect(SCRIPT).toContain('--arg exec "arn:aws:iam::${TAI_KHOAN}:role/tp-ecs-execution"');
    expect(giaTriChung("ecs_execution")).toBe("tp-ecs-execution");
    expect(TF90).toMatch(/execution_role_arn += local\.role_arn\.ecs_execution\n/u);
  });
});
