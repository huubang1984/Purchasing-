// ==============================================================================================
// [ADR-067] HÌNH DẠNG QUYỀN CỦA `deploy.yml` — TOKEN OIDC KHÔNG NẰM CÙNG JOB VỚI MÃ BÊN THỨ BA
//
// Pipeline deploy cầm hai role có quyền đẩy image và cập nhật service prod; `tp-deploy-worker` PassRole được role có
// kms:Decrypt trên tp-org-wrap (ADR-062). Những bảo đảm của nó đều nằm trong MỘT tệp cấu hình, nên chúng cần mốc chết:
//   ⑴ chỉ `workflow_dispatch`; quyền mặc định của workflow RỖNG; `build` không có `id-token`, không environment;
//   ⑵ `id-token: write` chỉ ở `api` (environment `prod`) và `worker` (environment `prod-worker`) — đúng hai `sub` mà
//      trust policy của stack 30 ghim;
//   ⑶ role ARN trỏ đúng tài khoản prod và đúng tên role khai ở `infra/terraform/chung` — không chép tay một con số;
//   ⑷ mọi `uses:` ghim SHA 40 ký tự; checkout không giữ credential;
//   ⑸ `pnpm`/`npm`/`docker build` chỉ xuất hiện trong `build`.
// Đọc bằng regex như `hinh-dang-ci.test.ts` — dự án không có phụ thuộc YAML; cái giá (bám cách viết) là chủ đích.
// ==============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const doc = (duong: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${duong}`, import.meta.url)), "utf8").replace(/\r\n/gu, "\n");

const VAN = doc(".github/workflows/deploy.yml");
const CHUNG = doc("infra/terraform/chung/main.tf");

/** Dòng có nghĩa: bỏ dòng trống và dòng chú thích nguyên dòng. */
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

describe("[ADR-067] hình dạng của deploy.yml", () => {
  const dong = coNghia(VAN);

  it("⑴ mức cao nhất đúng {name, on, permissions, concurrency, jobs}, `permissions: {}`, chỉ workflow_dispatch", () => {
    const mucCao = dong.filter((d) => /^[A-Za-z]/u.test(d)).map((d) => d.split(":")[0]);
    expect(mucCao).toEqual(["name", "on", "permissions", "concurrency", "jobs"]);
    expect(dong).toContain("permissions: {}");
    const suKien = dong.filter((d) => /^ {2}[a-z_]+:/u.test(d) && dong.indexOf(d) < dong.indexOf("permissions: {}"));
    expect(suKien.map((d) => d.trim())).toEqual(["workflow_dispatch:"]);
    expect(VAN).toMatch(/cancel-in-progress: false/u);
  });

  it("⑴ job đúng [build, api, worker]; build không id-token, không environment, chỉ contents: read", () => {
    const jobs = dong.slice(dong.indexOf("jobs:") + 1).filter((d) => /^ {2}[A-Za-z0-9_-]+:/u.test(d));
    expect(jobs.map((d) => d.trim())).toEqual(["build:", "api:", "worker:"]);
    const build = thanJob("build");
    expect(build).not.toMatch(/id-token/u);
    expect(build).not.toMatch(/environment:/u);
    expect(build).not.toMatch(/configure-aws-credentials/u);
    expect(build).toMatch(/ {4}permissions:\n {6}contents: read\n {4}steps:/u);
    expect(build).toMatch(/if: github\.ref == 'refs\/heads\/master'/u);
  });

  it("⑵ id-token chỉ ở api (prod) và worker (prod-worker)", () => {
    expect([...VAN.matchAll(/id-token: write/gu)]).toHaveLength(2);
    const api = thanJob("api");
    const worker = thanJob("worker");
    expect(api).toMatch(/\n {4}environment: prod\n/u);
    expect(worker).toMatch(/\n {4}environment: prod-worker\n/u);
    expect(api).toMatch(/ {4}permissions:\n {6}contents: read\n {6}id-token: write\n/u);
    expect(worker).toMatch(/ {4}permissions:\n {6}contents: read\n {6}id-token: write\n/u);
    expect(api).toMatch(/needs: build\n/u);
    // [ADR-068] web đi cùng job api và bị đòi KHÔNG mang task role.
    expect(api).toMatch(/trien-khai\.sh dang-ky tp-web "\$anh_web" -\)/u);
  });

  it("⑶ role ARN đúng tài khoản prod và tên role của infra/terraform/chung; api không cầm role worker và ngược lại", () => {
    const prod = giaTriChung("prod");
    const deploy = giaTriChung("deploy");
    const deployWorker = giaTriChung("deploy_worker");
    expect(thanJob("api")).toMatch(new RegExp(`role-to-assume: arn:aws:iam::${prod}:role/${deploy}\\n`, "u"));
    expect(thanJob("worker")).toMatch(new RegExp(`role-to-assume: arn:aws:iam::${prod}:role/${deployWorker}\\n`, "u"));
    expect([...VAN.matchAll(/role-to-assume:/gu)]).toHaveLength(2);
    for (const t of [...VAN.matchAll(/TAI_KHOAN: "(\d+)"/gu)]) expect(t[1]).toBe(prod);
    expect(giaTriChung("github_repo")).toBe("huubang1984/Purchasing-");
  });

  it("⑷ mọi `uses:` ghim SHA 40 ký tự; mọi checkout có persist-credentials: false", () => {
    const uses = dong.filter((d) => /\buses:/u.test(d));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40}( #.*)?$/u);
    const checkout = VAN.split("\n").filter((d) => d.includes("actions/checkout@")).length;
    expect([...VAN.matchAll(/persist-credentials: false/gu)]).toHaveLength(checkout);
  });

  it("⑸ mã bên thứ ba (pnpm/npm/docker build) chỉ chạy trong build; không secrets", () => {
    for (const job of ["api", "worker"]) {
      const than = coNghia(thanJob(job)).join("\n");
      expect(than, job).not.toMatch(/\b(pnpm|npm|npx|yarn)\b|docker build/u);
    }
    expect(coNghia(VAN).join("\n")).not.toMatch(/secrets\.|GITHUB_TOKEN|github\.token/u);
    expect(VAN).not.toMatch(/pull_request_target/u);
  });
});
