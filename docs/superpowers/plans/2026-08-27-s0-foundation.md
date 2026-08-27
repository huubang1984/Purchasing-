# S0 — Foundation & Control Plane · Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng nền móng kỹ thuật cho TrustProcure — hàng rào an toàn hoạt động thật, đa tổ chức cô lập ở tầng DB, sổ kiểm toán chuỗi hash chỉ-ghi-thêm, hạ tầng khóa tách quyền, danh tính có MFA, và bộ khung kiểm thử sinh được evidence pack.

**Architecture:** Monorepo pnpm. Các package thuần TypeScript (`packages/*`) chứa toàn bộ logic; `apps/*` chỉ là vỏ. Mọi cô lập dữ liệu được cưỡng chế ở tầng PostgreSQL (RLS, trigger, GRANT/REVOKE) chứ không ở tầng ứng dụng. Gói `crypto-keys` tách làm hai entrypoint — bọc khóa và mở khóa — để quy tắc kiến trúc trong CI cấm được `apps/api` chạm vào đường giải mã.

**Tech Stack:** Node 22 · pnpm 9 · TypeScript 5.6 (strict) · PostgreSQL 16 · `pg` 8 · Vitest 2 · fast-check 3 · @testcontainers/postgresql 10 · dependency-cruiser 16 · gitleaks

**Spec:** `docs/superpowers/specs/2026-08-26-trustprocure-s0-s1-design.md`
**Bất biến:** `docs/TEST-PLAN.md`

## Global Constraints

- Node `>=22.0.0`, pnpm `>=9.0.0`. Khai báo trong `package.json` → `engines`.
- TypeScript `strict: true`. Cấm `any` tường minh; cấm `@ts-ignore` không kèm lý do.
- PostgreSQL 16. Mọi bảng có cột `org_id` **bắt buộc** bật `ENABLE ROW LEVEL SECURITY` **và** `FORCE ROW LEVEL SECURITY`.
- Hai DB role tách biệt: `app_api`, `app_unseal`. Không role nào bao trùm role kia. Không role nào có `UPDATE`/`DELETE`/`TRUNCATE` trên `audit_events`.
- Không module nào ngoài `apps/unseal-worker/**` được import entrypoint `@trustprocure/crypto-keys/unwrap`.
- Không bao giờ ghi log: giá, mật khẩu, token, mã OTP, khóa, bí mật TOTP.
- **Ngôn ngữ đặt tên.** Mặt tiền công khai của mỗi package — tên hàm export, tên kiểu, tên trường trong interface, mã quyền, tên cột và tên bảng SQL — bằng **tiếng Anh**. Biến cục bộ, tham số nội bộ, tên biến trong hàm SQL, và tên test được dùng **tiếng Việt không dấu hoặc có dấu**, đúng như mã nguồn mẫu trong kế hoạch này. Bình luận, thông báo lỗi hướng người dùng, và commit message bằng tiếng Việt. Đây là ràng buộc đã chốt ngày 2026-08-27 — người review không được coi tên biến cục bộ tiếng Việt là lỗi.
- Mỗi test kiểm chứng một bất biến phải có mã bất biến trong tên test theo dạng `[INV-A1]`. Phạm vi: 34 bất biến nghiệp vụ nhóm A–G (`docs/TEST-PLAN.md` §2) **và** 10 bất biến hàng rào nhóm H (§5). Test hạ tầng thuần tuý, không kiểm chứng bất biến nào, thì không cần tag. Đây là đầu vào của bộ sinh `evidence/INV-matrix.md` (Task 11).
- Commit sau mỗi task. Không gộp nhiều task vào một commit.

## Bản đồ file

| Đường dẫn | Trách nhiệm | Task |
|---|---|---|
| `.claude/hooks/git-safety.mjs` | Chặn lệnh git phá hủy, fail-closed | 1 |
| `.claude/hooks/protect-secrets.mjs` | Chặn ghi vào file bí mật, fail-closed | 1 |
| `.claude/settings.json` | Đăng ký hai hook ở cấp project | 1 |
| `tests/hooks/*.test.ts` | Kiểm chứng hai hook chặn thật | 1 |
| `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts` | Khung monorepo | 2 |
| `.dependency-cruiser.cjs` | Quy tắc ranh giới kiến trúc (T0) | 2 |
| `.github/workflows/ci.yml` | Cổng CI | 2 |
| `packages/db/src/migrate.ts` | Bộ chạy migration SQL thuần | 3 |
| `packages/db/src/pool.ts` | Tạo pool `pg` | 3 |
| `packages/test-support/src/postgres.ts` | Vòng đời Testcontainers | 3 |
| `db/migrations/*.sql` | Lược đồ, RLS, trigger, GRANT | 3–10 |
| `packages/tenancy/src/index.ts` | `withTenant` — gắn `app.org_id` vào transaction | 4 |
| `packages/audit/src/canonical.ts` | JSON chuẩn tắc để băm ổn định | 6 |
| `packages/audit/src/writer.ts` | Ghi sự kiện, nối chuỗi hash | 6 |
| `packages/audit/src/verifier.ts` | Kiểm chứng chuỗi và mốc neo | 6 |
| `packages/crypto-keys/src/index.ts` | `KeyWrapper` — chỉ bọc khóa | 7 |
| `packages/crypto-keys/src/unwrap.ts` | `KeyUnwrapper` — chỉ mở khóa | 7 |
| `packages/identity/src/rbac.ts` | Kiểm tra quyền | 8 |
| `packages/identity/src/totp.ts` | TOTP RFC 6238 | 9 |
| `packages/outbox/src/*.ts` | Transactional outbox và job runner | 10 |
| `tools/inv-matrix/src/index.ts` | Sinh `evidence/INV-matrix.md` | 11 |

---

## Task 1: Sửa hai hook an toàn và chứng minh chúng chặn thật

> **Đây là cổng chặn.** Không task nào khác bắt đầu trước khi task này xong. Lý do ở spec §8.1: hai hook của plugin `ai-eng-os` hiện fail-open vì thiếu `jq`, nên hàng rào an toàn không tồn tại trên thực tế.
>
> Hook mới đặt ở cấp project (`.claude/hooks/`), viết bằng Node — không phụ thuộc `jq`, chạy được trên Windows, và nằm trong version control nên kiểm chứng được. Không sửa file của plugin đã cài: plugin có thể bị ghi đè khi cập nhật, và hook cấp project cộng dồn với hook plugin (bất kỳ hook nào trả về mã 2 đều chặn).

**Bất biến liên quan:** hạ tầng an toàn của phương pháp, `docs/TEST-PLAN.md` §5.

**Files:**
- Create: `.claude/hooks/git-safety.mjs`
- Create: `.claude/hooks/protect-secrets.mjs`
- Create: `.claude/settings.json`
- Create: `tests/hooks/git-safety.test.ts`
- Create: `tests/hooks/protect-secrets.test.ts`
- Create: `package.json` (tối thiểu, đủ chạy vitest)
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: không có (task đầu tiên).
- Produces: hợp đồng hook — đọc JSON trên stdin, thoát `0` cho phép, thoát `2` chặn kèm lý do trên stderr. Task 2 mở rộng `vitest.config.ts` và `package.json` được tạo ở đây.

- [ ] **Step 1: Tạo `package.json` và `vitest.config.ts` tối thiểu**

```json
{
  "name": "trustprocure",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0", "pnpm": ">=9.0.0" },
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.7.0"
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    environment: "node",
  },
});
```

Chạy: `pnpm install`

- [ ] **Step 2: Viết test thất bại cho `git-safety`**

```ts
// tests/hooks/git-safety.test.ts
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("../../.claude/hooks/git-safety.mjs", import.meta.url));

function runHook(payload: string): { status: number; stderr: string } {
  const proc = spawnSync(process.execPath, [HOOK], { input: payload, encoding: "utf8" });
  return { status: proc.status ?? -1, stderr: proc.stderr };
}

function bashPayload(command: string): string {
  return JSON.stringify({ tool_name: "Bash", tool_input: { command } });
}

const BLOCKED = [
  "git reset --hard HEAD~1",
  "git clean -fd",
  "git clean -xdf",
  "git push --force origin main",
  "git push -f origin main",
  "git push --force-with-lease origin main",
  "git checkout -- .",
  "git restore --staged .",
  "git branch -D feature/foo",
  "git filter-branch --tree-filter true HEAD",
  "git stash clear",
  "git stash drop",
  "git reflog expire --expire=now --all",
  "git update-ref -d refs/heads/main",
  "cd /tmp && git reset --hard",
];

const ALLOWED = [
  "git status",
  "git log --oneline",
  "git add -A",
  "git commit -m 'feat: something'",
  "git push origin feature/foo",
  "git reset HEAD~1",
  "npm run build",
];

describe("git-safety hook", () => {
  it.each(BLOCKED)("chặn: %s", (command) => {
    const { status, stderr } = runHook(bashPayload(command));
    expect(status).toBe(2);
    expect(stderr).toMatch(/git-safety/);
  });

  it.each(ALLOWED)("cho qua: %s", (command) => {
    expect(runHook(bashPayload(command)).status).toBe(0);
  });

  it("fail-closed khi JSON hỏng", () => {
    expect(runHook("{ khong-phai-json").status).toBe(2);
  });

  it("fail-closed khi stdin rỗng", () => {
    expect(runHook("").status).toBe(2);
  });

  it("fail-closed khi thiếu tool_input", () => {
    expect(runHook(JSON.stringify({ tool_name: "Bash" })).status).toBe(2);
  });

  it("fail-closed khi command không phải chuỗi", () => {
    expect(runHook(JSON.stringify({ tool_input: { command: 42 } })).status).toBe(2);
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run tests/hooks/git-safety.test.ts`
Kỳ vọng: FAIL — `Cannot find module ... git-safety.mjs`

- [ ] **Step 4: Viết `git-safety.mjs`**

```js
#!/usr/bin/env node
// PreToolUse hook: chặn lệnh git phá hủy.
// Nguyên tắc fail-closed: mọi lỗi đọc/phân tích đầu vào đều CHẶN, không cho qua.
// Bài học từ sự cố jq (spec §8.1): biện pháp kiểm soát thất bại phải thất bại theo hướng an toàn.

const DESTRUCTIVE = [
  { re: /\bgit\s+reset\s+--hard\b/, ten: "git reset --hard" },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, ten: "git clean -f" },
  { re: /\bgit\s+push\b[^|;&]*\s(-f|--force)\b/, ten: "git push --force" },
  { re: /\bgit\s+checkout\s+--\s/, ten: "git checkout -- <path>" },
  { re: /\bgit\s+restore\s+(--staged\s+|--worktree\s+)*\.(\s|$)/, ten: "git restore ." },
  { re: /\bgit\s+branch\s+-D\b/, ten: "git branch -D" },
  { re: /\bgit\s+filter-branch\b/, ten: "git filter-branch" },
  { re: /\bgit\s+stash\s+(clear|drop)\b/, ten: "git stash clear/drop" },
  { re: /\bgit\s+reflog\s+expire\b/, ten: "git reflog expire" },
  { re: /\bgit\s+update-ref\s+-d\b/, ten: "git update-ref -d" },
];

function chan(lyDo) {
  process.stderr.write(`git-safety: ${lyDo}\n`);
  process.exit(2);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("error", () => chan("không đọc được stdin — chặn theo nguyên tắc fail-closed."));
process.stdin.on("end", () => {
  let command;
  try {
    const payload = JSON.parse(raw);
    command = payload?.tool_input?.command;
  } catch {
    chan("payload hook không phải JSON hợp lệ — chặn theo nguyên tắc fail-closed.");
  }

  if (typeof command !== "string") {
    chan("không tìm thấy tool_input.command dạng chuỗi — chặn theo nguyên tắc fail-closed.");
  }

  const hit = DESTRUCTIVE.find((entry) => entry.re.test(command));
  if (hit) {
    chan(
      `chặn lệnh git phá hủy (${hit.ten}). Nếu thực sự cần, hãy tự chạy thủ công ` +
        `— xem CLAUDE.md, Core Engineering Rules > Git safety.`,
    );
  }

  process.exit(0);
});
```

- [ ] **Step 5: Chạy test để xác nhận đạt**

Chạy: `pnpm vitest run tests/hooks/git-safety.test.ts`
Kỳ vọng: PASS — 26 test (15 lệnh bị chặn, 7 cho qua, 4 fail-closed).

- [ ] **Step 6: Viết test thất bại cho `protect-secrets`**

```ts
// tests/hooks/protect-secrets.test.ts
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOK = fileURLToPath(new URL("../../.claude/hooks/protect-secrets.mjs", import.meta.url));

function runHook(payload: string): { status: number; stderr: string } {
  const proc = spawnSync(process.execPath, [HOOK], { input: payload, encoding: "utf8" });
  return { status: proc.status ?? -1, stderr: proc.stderr };
}

function writePayload(filePath: string): string {
  return JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath } });
}

const BLOCKED = [
  "D:/Claude/TrustProcure/.env",
  "D:/Claude/TrustProcure/.env.local",
  "D:/Claude/TrustProcure/.env.production",
  "D:\\Claude\\TrustProcure\\.env",
  "/home/u/app/server.pem",
  "/home/u/app/private.key",
  "/home/u/certs/bundle.p12",
  "/home/u/certs/bundle.pfx",
  "/home/u/certs/store.jks",
  "/home/u/certs/store.keystore",
  "/home/u/.ssh/id_rsa",
  "/home/u/.ssh/id_ed25519",
  "/home/u/.aws/credentials",
  "/home/u/app/credentials.json",
  "/home/u/app/secrets.yml",
  "/home/u/app/secrets.yaml",
  "/home/u/.npmrc",
  "/home/u/.pgpass",
  "/home/u/.netrc",
  "/home/u/.claude/settings.json",
  "/home/u/.claude/settings.local.json",
];

const ALLOWED = [
  "D:/Claude/TrustProcure/src/index.ts",
  "D:/Claude/TrustProcure/.env.example",
  "D:/Claude/TrustProcure/.env.sample",
  "D:/Claude/TrustProcure/.env.template",
  "D:/Claude/TrustProcure/docs/STATE.md",
  "D:/Claude/TrustProcure/packages/identity/src/monkey.ts",
  "D:/Claude/TrustProcure/db/migrations/001_roles.sql",
];

describe("protect-secrets hook", () => {
  it.each(BLOCKED)("chặn: %s", (filePath) => {
    const { status, stderr } = runHook(writePayload(filePath));
    expect(status).toBe(2);
    expect(stderr).toMatch(/protect-secrets/);
  });

  it.each(ALLOWED)("cho qua: %s", (filePath) => {
    expect(runHook(writePayload(filePath)).status).toBe(0);
  });

  it("fail-closed khi JSON hỏng", () => {
    expect(runHook("{ hong").status).toBe(2);
  });

  it("fail-closed khi thiếu file_path", () => {
    expect(runHook(JSON.stringify({ tool_name: "Write", tool_input: {} })).status).toBe(2);
  });

  it("fail-closed khi file_path không phải chuỗi", () => {
    expect(runHook(JSON.stringify({ tool_input: { file_path: null } })).status).toBe(2);
  });
});
```

- [ ] **Step 7: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run tests/hooks/protect-secrets.test.ts`
Kỳ vọng: FAIL — không tìm thấy module.

- [ ] **Step 8: Viết `protect-secrets.mjs`**

```js
#!/usr/bin/env node
// PreToolUse hook: chặn Edit/Write vào file bí mật hoặc thông tin xác thực.
// Khớp theo phần mở rộng và tên file thay vì khớp chuỗi con, để tránh chặn nhầm
// (ví dụ "monkey.ts" từng bị bộ pattern chuỗi con của bản .sh cũ đe dọa chặn).
// Nguyên tắc fail-closed: mọi lỗi đọc/phân tích đầu vào đều CHẶN.

import { basename, extname } from "node:path";

const SECRET_EXTS = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".ppk", ".asc", ".gpg"]);

const SECRET_BASENAMES = new Set([
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
  "credentials.json", "secrets.yml", "secrets.yaml",
  ".npmrc", ".pgpass", ".netrc", ".htpasswd",
]);

const SECRET_FRAGMENTS = [
  "/.aws/credentials",
  "/.ssh/",
  "/.gnupg/",
  "/.claude/settings.json",
  "/.claude/settings.local.json",
];

const ENV_ALLOWED = new Set([".env.example", ".env.sample", ".env.template"]);

function chan(lyDo) {
  process.stderr.write(`protect-secrets: ${lyDo}\n`);
  process.exit(2);
}

function laFileBiMat(rawPath) {
  const p = rawPath.replaceAll("\\", "/");
  const base = basename(p);

  if (base === ".env" || (base.startsWith(".env.") && !ENV_ALLOWED.has(base))) return true;
  if (SECRET_BASENAMES.has(base)) return true;
  if (SECRET_EXTS.has(extname(base).toLowerCase())) return true;
  if (SECRET_FRAGMENTS.some((fragment) => p.includes(fragment))) return true;

  return false;
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("error", () => chan("không đọc được stdin — chặn theo nguyên tắc fail-closed."));
process.stdin.on("end", () => {
  let filePath;
  try {
    filePath = JSON.parse(raw)?.tool_input?.file_path;
  } catch {
    chan("payload hook không phải JSON hợp lệ — chặn theo nguyên tắc fail-closed.");
  }

  if (typeof filePath !== "string" || filePath.length === 0) {
    chan("không tìm thấy tool_input.file_path dạng chuỗi — chặn theo nguyên tắc fail-closed.");
  }

  if (laFileBiMat(filePath)) {
    chan(
      `${filePath} là file bí mật hoặc thông tin xác thực — hãy tự sửa thủ công ` +
        `(xem CLAUDE.md, Roles > Security Reviewer).`,
    );
  }

  process.exit(0);
});
```

- [ ] **Step 9: Chạy test để xác nhận đạt**

Chạy: `pnpm vitest run tests/hooks/protect-secrets.test.ts`
Kỳ vọng: PASS — 31 test (21 đường dẫn bị chặn, 7 cho qua, 3 fail-closed).

- [ ] **Step 10: Đăng ký hook ở cấp project**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/git-safety.mjs\"" }]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/protect-secrets.mjs\"" }]
      }
    ]
  }
}
```

- [ ] **Step 11: Kiểm chứng thủ công hook đã sống**

Khởi động lại phiên Claude Code, rồi yêu cầu chạy `git reset --hard HEAD~1`.
Kỳ vọng: bị chặn kèm thông báo bắt đầu bằng `git-safety:`.

**Nếu không bị chặn, DỪNG LẠI** — hook chưa được nạp, và toàn bộ phần còn lại của kế hoạch mất hàng rào an toàn. Kiểm tra: đường dẫn `.claude/settings.json`, biến `$CLAUDE_PROJECT_DIR` có được thay thế không, và `node` có trong PATH của tiến trình Claude Code không.

- [ ] **Step 12: Commit**

```bash
git add .claude package.json vitest.config.ts tests/hooks
git commit -m "fix(hooks): viết lại hai hook an toàn bằng Node, fail-closed

Hook cũ của plugin ai-eng-os fail-open trên máy này: thiếu jq nên script
lỗi ở dòng 4 và trả về exit 0 (cho qua). Hàng rào tồn tại trên giấy nhưng
không tồn tại trên thực tế.

Ba lỗi đã sửa:
- Bỏ phụ thuộc jq, viết bằng Node — chạy được cả trên Windows.
- Fail-closed: mọi lỗi đọc/phân tích đầu vào đều chặn thay vì cho qua.
- Mở rộng pattern: thêm checkout --, branch -D, filter-branch, stash
  clear, reflog expire, update-ref -d; thêm .p12/.pfx/.jks/.keystore/
  id_ed25519/.npmrc/.pgpass/.netrc và .claude/settings.json.

Khớp theo phần mở rộng và tên file thay vì chuỗi con để tránh chặn nhầm.
57 test chứng minh chặn thật, cho qua đúng, và fail-closed."
```

---

## Task 2: Khung monorepo và cổng CI tầng T0

**Bất biến liên quan:** G1 (quy tắc cấm import đường giải mã); nền cho toàn bộ tầng T0.

**Files:**
- Create: `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`
- Modify: `package.json`, `vitest.config.ts`
- Create: `.dependency-cruiser.cjs`, `eslint.config.js`
- Create: `.github/workflows/ci.yml`
- Create: `packages/crypto-keys/package.json`, `packages/crypto-keys/src/index.ts`, `packages/crypto-keys/src/unwrap.ts`
- Create: `tests/architecture/boundaries.test.ts`

**Interfaces:**
- Consumes: `package.json` và `vitest.config.ts` từ Task 1.
- Produces: các lệnh `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`, `pnpm t0`, `pnpm test`, `pnpm test:int`. Alias `@trustprocure/<ten>` giải về `packages/<ten>/src`. Hai entrypoint `@trustprocure/crypto-keys` (bọc khóa) và `@trustprocure/crypto-keys/unwrap` (mở khóa) tồn tại dưới dạng khung, nội dung thật ở Task 7.

- [ ] **Step 1: Tạo workspace và cấu hình TypeScript**

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tools/*"
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

```json
// tsconfig.json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@trustprocure/*": ["packages/*/src"]
    }
  },
  "include": ["packages/**/*.ts", "apps/**/*.ts", "tools/**/*.ts", "tests/**/*.ts", "db/**/*.ts"]
}
```

- [ ] **Step 2: Cập nhật `package.json` gốc và `vitest.config.ts`**

```json
{
  "name": "trustprocure",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0", "pnpm": ">=9.0.0" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "lint": "eslint .",
    "depcruise": "depcruise packages apps tools tests --config .dependency-cruiser.cjs",
    "t0": "pnpm typecheck && pnpm lint && pnpm depcruise",
    "test": "vitest run --exclude \"**/*.int.test.ts\"",
    "test:int": "vitest run int.test",
    "test:all": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "@types/pg": "^8.11.0",
    "dependency-cruiser": "^16.4.0",
    "eslint": "^9.12.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.8.0",
    "vitest": "^2.1.0"
  }
}
```

```ts
// vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@trustprocure": fileURLToPath(new URL("./packages", import.meta.url)),
    },
  },
  test: {
    include: [
      "tests/**/*.test.ts",
      "packages/**/*.test.ts",
      "tools/**/*.test.ts",
      "db/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 180000,
  },
});
```

Alias trỏ vào thư mục `packages`, nên `@trustprocure/tenancy` giải về `packages/tenancy`. Mỗi package phải khai `"main": "src/index.ts"` trong `package.json` của nó — các task sau đều làm vậy.

Về ba script test, dùng đúng dạng đã viết ở trên, đừng "sửa lại cho gọn":

- `test` dùng `--exclude`, là cờ CLI hợp lệ của Vitest và **cộng thêm** vào danh sách loại trừ mặc định chứ không thay thế nó.
- `test:int` dùng `int.test` ở dạng tham số vị trí. Vitest coi tham số vị trí là bộ lọc theo đường dẫn file, nên nó chọn đúng các file `*.int.test.ts`. **Vitest không có cờ `--include`** — viết `--include` sẽ lỗi "unknown option".
- `test:all` chạy tất cả, và là dạng mà `test:report` ở Task 11 dùng để sinh evidence pack.

Chạy: `pnpm install`

- [ ] **Step 3: Tạo khung hai entrypoint của `crypto-keys`**

Tạo trước ở task này để quy tắc ranh giới có mục tiêu thật ngay từ đầu. Nội dung đầy đủ ở Task 7.

```json
// packages/crypto-keys/package.json
{
  "name": "@trustprocure/crypto-keys",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./unwrap": "./src/unwrap.ts"
  }
}
```

```ts
// packages/crypto-keys/src/index.ts
// Entrypoint BỌC khóa — an toàn cho mọi service import.
export interface WrappedKey {
  readonly ciphertext: Uint8Array;
  readonly keyVersion: string;
}
```

```ts
// packages/crypto-keys/src/unwrap.ts
// Entrypoint MỞ khóa. CHỈ apps/unseal-worker được import file này.
// Ranh giới bảo mật quan trọng nhất của hệ thống — ADR-006, bất biến G1.
import type { WrappedKey } from "./index.js";

export interface KeyUnwrapper {
  readonly name: string;
  unwrap(orgId: string, wrapped: WrappedKey): Promise<Uint8Array>;
}
```

- [ ] **Step 4: Viết quy tắc ranh giới kiến trúc**

```js
// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    {
      name: "khong-giai-ma-ngoai-unseal-worker",
      comment:
        "Chỉ apps/unseal-worker được chạm entrypoint mở khóa. Ranh giới bảo mật quan trọng " +
        "nhất của hệ thống (ADR-006, bất biến G1) — cưỡng chế bằng máy, không bằng trí nhớ.",
      severity: "error",
      from: { pathNot: "^apps/unseal-worker/" },
      to: { path: "^packages/crypto-keys/src/unwrap\\.ts$" },
    },
    {
      name: "khong-phu-thuoc-vong",
      comment: "Phụ thuộc vòng làm ranh giới module mất ý nghĩa.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "khong-phu-thuoc-devdep-trong-src",
      severity: "error",
      from: { pathNot: "\\.(test|config)\\.(ts|js|cjs)$" },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(node_modules|dist|\\.next)" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
  },
};
```

- [ ] **Step 5: Viết test chứng minh quy tắc ranh giới chặn thật**

Một quy tắc lint chỉ có giá trị khi được chứng minh là chặn — cùng bài học với Task 1. Test dựng tạm một module vi phạm, chạy depcruise thật, rồi dọn.

```ts
// tests/architecture/boundaries.test.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function depcruise(targets: string[]): { status: number; output: string } {
  const proc = spawnSync(
    "pnpm",
    ["exec", "depcruise", ...targets, "--config", ".dependency-cruiser.cjs"],
    { encoding: "utf8", shell: true },
  );
  return { status: proc.status ?? -1, output: `${proc.stdout}${proc.stderr}` };
}

describe("ranh giới kiến trúc", () => {
  it("[INV-G1] chặn module ngoài unseal-worker import đường mở khóa", () => {
    const dir = "apps/tmp-probe/src";
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/leak.ts`,
      [
        'import type { KeyUnwrapper } from "../../../packages/crypto-keys/src/unwrap.js";',
        "export type Leaked = KeyUnwrapper;",
        "",
      ].join("\n"),
    );
    try {
      const { status, output } = depcruise(["apps/tmp-probe"]);
      expect(status).not.toBe(0);
      expect(output).toContain("khong-giai-ma-ngoai-unseal-worker");
    } finally {
      rmSync("apps/tmp-probe", { recursive: true, force: true });
    }
  }, 60000);

  it("mã nguồn hiện tại không vi phạm quy tắc nào", () => {
    expect(depcruise(["packages", "apps", "tools", "tests"]).status).toBe(0);
  }, 60000);
});
```

- [ ] **Step 6: Chạy test**

Chạy: `pnpm vitest run tests/architecture/boundaries.test.ts`
Kỳ vọng: PASS — 2 test. Nếu test đầu FAIL với `status === 0`, quy tắc đang không chặn: kiểm tra lại biểu thức `to.path` có khớp đường dẫn thật không.

- [ ] **Step 7: Cấu hình ESLint**

```js
// eslint.config.js
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.next/**", "evidence/**", "**/*.cjs"] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-console": ["error", { allow: ["error"] }],
    },
  },
  {
    files: ["**/*.test.ts", "tools/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
```

Chạy: `pnpm lint`
Kỳ vọng: sạch.

- [ ] **Step 8: Dựng cổng CI**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  t0:
    name: T0 — cổng tĩnh
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Typecheck
        run: pnpm typecheck
      - name: Lint
        run: pnpm lint
      - name: Ranh gioi kien truc
        run: pnpm depcruise
      - name: Quet bi mat
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Audit phu thuoc
        run: pnpm audit --audit-level high

  t1-t2:
    name: T1+T2 — unit va contract
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  t3:
    name: T3 — integration voi Postgres that
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:int
```

- [ ] **Step 9: Chạy toàn bộ cổng tại máy**

Chạy: `pnpm t0 && pnpm test`
Kỳ vọng: tất cả PASS.

- [ ] **Step 10: Commit**

```bash
git add pnpm-workspace.yaml tsconfig.base.json tsconfig.json package.json pnpm-lock.yaml vitest.config.ts .dependency-cruiser.cjs eslint.config.js .github packages/crypto-keys tests/architecture
git commit -m "chore: khung monorepo va cong CI tang T0

Workspace pnpm, TypeScript strict, ESLint type-checked, dependency-cruiser,
gitleaks, audit phu thuoc.

Quy tac ranh gioi quan trong nhat: chi apps/unseal-worker duoc import
packages/crypto-keys/src/unwrap.ts. Co test chung minh quy tac chan that
bang cach dung mot module vi pham tam thoi va xac nhan depcruise bao loi
— quy tac lint chi co gia tri khi duoc kiem chung."
```

---

## Task 3: Bộ chạy migration và hạ tầng test với Postgres thật

**Bất biến liên quan:** nền cho toàn bộ tầng T3.

**Files:**
- Create: `packages/db/package.json`, `packages/db/src/index.ts`, `packages/db/src/migrate.ts`, `packages/db/src/pool.ts`
- Create: `packages/test-support/package.json`, `packages/test-support/src/index.ts`, `packages/test-support/src/postgres.ts`
- Create: `db/migrations/001_roles_and_functions.sql`
- Create: `packages/db/src/migrate.int.test.ts`
- Create: `db/migrations.int.test.ts`

**Interfaces:**
- Consumes: khung monorepo từ Task 2.
- Produces:
  - `migrate(pool: pg.Pool, dir: string): Promise<string[]>` — danh sách migration vừa áp dụng, theo thứ tự.
  - `createPool(connectionString: string, max?: number): pg.Pool`
  - `startPostgres(): Promise<TestDatabase>` với `TestDatabase = { connectionString: string; pool: pg.Pool; poolAs(role: string): pg.Pool; stop(): Promise<void> }`
  - `withMigratedDatabase(fn: (db: TestDatabase) => Promise<void>): Promise<void>`
  - Hàm SQL `app_current_org_id() RETURNS uuid` và hai role `app_api`, `app_unseal`.

- [ ] **Step 1: Viết test thất bại cho bộ chạy migration**

```ts
// packages/db/src/migrate.int.test.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { migrate } from "./migrate.js";

let db: TestDatabase;

beforeAll(async () => {
  db = await startPostgres();
});

afterAll(async () => {
  await db?.stop();
});

function migrationDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "tp-mig-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe("bộ chạy migration", () => {
  it("áp dụng migration theo thứ tự tên file", async () => {
    const dir = migrationDir({
      "001_a.sql": "CREATE TABLE mig_a (id int PRIMARY KEY);",
      "002_b.sql": "CREATE TABLE mig_b (id int REFERENCES mig_a(id));",
    });
    expect(await migrate(db.pool, dir)).toEqual(["001_a.sql", "002_b.sql"]);
  });

  it("bất biến — chạy lại không áp dụng lần hai", async () => {
    const dir = migrationDir({ "010_c.sql": "CREATE TABLE mig_c (id int);" });
    expect(await migrate(db.pool, dir)).toEqual(["010_c.sql"]);
    expect(await migrate(db.pool, dir)).toEqual([]);
  });

  it("migration lỗi thì rollback trọn vẹn và ném lỗi có tên file", async () => {
    const dir = migrationDir({
      "020_ok.sql": "CREATE TABLE mig_d (id int);",
      "021_hong.sql": "CREATE TABLE mig_e (id int); SELECT khong_ton_tai();",
    });
    await expect(migrate(db.pool, dir)).rejects.toThrow(/021_hong\.sql/);

    const { rowCount } = await db.pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'mig_e'",
    );
    expect(rowCount).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run packages/db/src/migrate.int.test.ts`
Kỳ vọng: FAIL — không giải được `@trustprocure/test-support`.

- [ ] **Step 3: Viết hạ tầng test Postgres**

```json
// packages/test-support/package.json
{
  "name": "@trustprocure/test-support",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@testcontainers/postgresql": "^10.13.0",
    "@trustprocure/db": "workspace:*",
    "pg": "^8.13.0"
  }
}
```

```ts
// packages/test-support/src/postgres.ts
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { migrate } from "@trustprocure/db";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

export interface TestDatabase {
  readonly connectionString: string;
  readonly pool: pg.Pool;
  /** Pool mới chạy dưới một DB role khác — dùng để chứng minh RLS và GRANT chặn thật. */
  poolAs(role: string): pg.Pool;
  stop(): Promise<void>;
}

export async function startPostgres(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("trustprocure_test")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();

  const connectionString = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString, max: 5 });
  const rolePools: pg.Pool[] = [];

  return {
    connectionString,
    pool,
    poolAs(role: string): pg.Pool {
      const rolePool = new pg.Pool({ connectionString, max: 3 });
      // Mỗi kết nối mới chuyển sang role cần kiểm chứng ngay khi mở.
      rolePool.on("connect", (client: pg.PoolClient) => {
        void client.query(`SET ROLE ${role}`);
      });
      rolePools.push(rolePool);
      return rolePool;
    },
    async stop(): Promise<void> {
      await Promise.all(rolePools.map((p) => p.end()));
      await pool.end();
      await container.stop();
    },
  };
}

/** Khởi động Postgres, áp dụng toàn bộ migration thật của dự án, chạy `fn`, rồi dọn dẹp. */
export async function withMigratedDatabase(
  fn: (db: TestDatabase) => Promise<void>,
): Promise<void> {
  const db = await startPostgres();
  try {
    await migrate(db.pool, MIGRATIONS_DIR);
    await fn(db);
  } finally {
    await db.stop();
  }
}
```

```ts
// packages/test-support/src/index.ts
export { startPostgres, withMigratedDatabase, type TestDatabase } from "./postgres.js";
```

- [ ] **Step 4: Viết bộ chạy migration**

```json
// packages/db/package.json
{
  "name": "@trustprocure/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "pg": "^8.13.0" }
}
```

```ts
// packages/db/src/migrate.ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

/**
 * Áp dụng các file .sql trong `dir` theo thứ tự tên, mỗi file trong một transaction riêng.
 * Migration đã áp dụng được ghi vào schema_migrations và không chạy lại.
 *
 * Cố ý dùng SQL thuần thay vì thư viện migration: lược đồ này phụ thuộc nặng vào RLS,
 * trigger và GRANT/REVOKE — những thứ cần đọc được nguyên văn khi kiểm toán.
 */
export async function migrate(pool: pg.Pool, dir: string): Promise<string[]> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  for (const file of files) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [
        file,
      ]);
      if (existing.rowCount === 0) {
        const sql = await readFile(join(dir, file), "utf8");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        applied.push(file);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} thất bại: ${(error as Error).message}`, { cause: error });
    } finally {
      client.release();
    }
  }

  return applied;
}
```

```ts
// packages/db/src/pool.ts
import pg from "pg";

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max, application_name: "trustprocure" });
}
```

```ts
// packages/db/src/index.ts
export { migrate } from "./migrate.js";
export { createPool } from "./pool.js";
```

Chạy: `pnpm install`

- [ ] **Step 5: Chạy test để xác nhận đạt**

Chạy: `pnpm vitest run packages/db/src/migrate.int.test.ts`
Kỳ vọng: PASS — 3 test. Lần chạy đầu chậm vì Testcontainers tải image `postgres:16-alpine`.

- [ ] **Step 6: Viết migration 001**

```sql
-- db/migrations/001_roles_and_functions.sql
-- Nền tảng: extension, hai DB role tách biệt, hàm lấy tổ chức hiện tại.
--
-- app_api    : phục vụ web. KHÔNG bao giờ được đọc khóa riêng của RFQ.
-- app_unseal : runtime mở thầu có kiểm soát. KHÔNG được ghi vào bảng báo giá.
-- Không role nào bao trùm role kia (ADR-006).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_unseal') THEN
    CREATE ROLE app_unseal NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_api, app_unseal;

-- Không cấp quyền mặc định rộng. Mỗi migration tạo bảng tự khai quyền của bảng đó,
-- để quyền luôn đọc được ngay cạnh lược đồ khi kiểm toán.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_api, app_unseal;

-- Lấy tổ chức hiện tại từ biến phiên do withTenant() gắn.
-- Trả NULL khi chưa gắn: mọi policy RLS so sánh với NULL sẽ không khớp hàng nào.
-- Đây là hành vi fail-closed có chủ đích — quên gắn tenant thì không thấy dữ liệu,
-- chứ không phải thấy tất cả.
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;
```

- [ ] **Step 7: Viết test cho migration thật của dự án**

```ts
// db/migrations.int.test.ts
import { describe, expect, it } from "vitest";
import { withMigratedDatabase } from "@trustprocure/test-support";

describe("migration của dự án", () => {
  it("áp dụng sạch trên cơ sở dữ liệu trống", async () => {
    await withMigratedDatabase(async (db) => {
      const { rows } = await db.pool.query<{ rolname: string }>(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('app_api', 'app_unseal') ORDER BY rolname",
      );
      expect(rows.map((r) => r.rolname)).toEqual(["app_api", "app_unseal"]);
    });
  });

  it("app_current_org_id trả NULL khi chưa gắn tổ chức — fail-closed", async () => {
    await withMigratedDatabase(async (db) => {
      const { rows } = await db.pool.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(rows[0]?.org).toBeNull();
    });
  });
});
```

- [ ] **Step 8: Chạy toàn bộ test integration**

Chạy: `pnpm test:int`
Kỳ vọng: PASS — 5 test.

- [ ] **Step 9: Commit**

```bash
git add packages/db packages/test-support db pnpm-lock.yaml
git commit -m "feat(db): bo chay migration SQL thuan va ha tang test Postgres that

Migration la file .sql danh so, moi file chay trong mot transaction rieng.
Co y khong dung thu vien migration: luoc do phu thuoc nang vao RLS, trigger
va GRANT/REVOKE — nhung thu can doc duoc nguyen van khi kiem toan.

Test chay tren Postgres 16 that qua Testcontainers, khong dung ban gia lap,
vi thu can kiem chung chinh la hanh vi cuong che cua Postgres.

Migration 001 tao hai role tach biet app_api va app_unseal, thu hoi quyen
mac dinh, va dinh nghia app_current_org_id() tra NULL khi chua gan to chuc
— quen gan tenant thi khong thay du lieu, khong phai thay tat ca."
```

---

## Task 4: Cô lập tổ chức bằng Row-Level Security

**Bất biến liên quan:** **F1** (mọi truy vấn bị ràng buộc `org_id` ở tầng DB), **F2** (không IDOR).

**Files:**
- Create: `db/migrations/002_organizations_and_users.sql`
- Create: `packages/tenancy/package.json`, `packages/tenancy/src/index.ts`, `packages/tenancy/src/with-tenant.ts`
- Create: `packages/tenancy/src/with-tenant.int.test.ts`

**Interfaces:**
- Consumes: `migrate`, `startPostgres`, `withMigratedDatabase`, `TestDatabase` từ Task 3; hàm SQL `app_current_org_id()`.
- Produces:
  - `withTenant<T>(pool: pg.Pool, orgId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T>` — mở transaction, gắn `app.org_id` phạm vi transaction, chạy `fn`, commit hoặc rollback.
  - `TenantError` — ném khi `orgId` không phải UUID hợp lệ.
  - Bảng `organizations(id, name, slug, created_at)` và `users(id, org_id, email, full_name, status, created_at)` với RLS bật và FORCE.

- [ ] **Step 1: Viết test thất bại cho cô lập tổ chức**

```ts
// packages/tenancy/src/with-tenant.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { TenantError, withTenant } from "./with-tenant.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);

  const insert = async (name: string, slug: string): Promise<string> => {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
      [name, slug],
    );
    return rows[0]!.id;
  };
  orgA = await insert("Cong ty A", "cong-ty-a");
  orgB = await insert("Cong ty B", "cong-ty-b");

  await db.pool.query(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3), ($4, $5, $6)",
    [orgA, "a@example.com", "Nguoi A", orgB, "b@example.com", "Nguoi B"],
  );

  apiPool = db.poolAs("app_api");
});

afterAll(async () => {
  await db?.stop();
});

describe("cô lập tổ chức", () => {
  it("[INV-F1] chỉ thấy hàng của tổ chức đang gắn", async () => {
    const emails = await withTenant(apiPool, orgA, async (client) => {
      const { rows } = await client.query<{ email: string }>("SELECT email FROM users");
      return rows.map((r) => r.email);
    });
    expect(emails).toEqual(["a@example.com"]);
  });

  it("[INV-F1] không thấy hàng của tổ chức khác dù truy vấn không có WHERE org_id", async () => {
    const count = await withTenant(apiPool, orgB, async (client) => {
      const { rows } = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM users");
      return rows[0]!.n;
    });
    expect(count).toBe("1");
  });

  it("[INV-F2] biết ID hợp lệ của tổ chức khác vẫn không đọc được", async () => {
    const otherId = (
      await db.pool.query<{ id: string }>("SELECT id FROM users WHERE org_id = $1", [orgB])
    ).rows[0]!.id;

    const found = await withTenant(apiPool, orgA, async (client) => {
      const { rowCount } = await client.query("SELECT 1 FROM users WHERE id = $1", [otherId]);
      return rowCount;
    });
    expect(found).toBe(0);
  });

  it("[INV-F1] không ghi được hàng mang org_id của tổ chức khác", async () => {
    await expect(
      withTenant(apiPool, orgA, async (client) => {
        await client.query("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)", [
          orgB,
          "gian-lan@example.com",
          "Ke gian",
        ]);
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("[INV-F1] không gắn tổ chức thì không thấy gì — fail-closed", async () => {
    const client = await apiPool.connect();
    try {
      const { rowCount } = await client.query("SELECT 1 FROM users");
      expect(rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("biến app.org_id không rò sang lần dùng kết nối kế tiếp", async () => {
    await withTenant(apiPool, orgA, async (client) => {
      await client.query("SELECT 1");
    });
    const client = await apiPool.connect();
    try {
      const { rows } = await client.query<{ org: string | null }>(
        "SELECT app_current_org_id() AS org",
      );
      expect(rows[0]?.org).toBeNull();
    } finally {
      client.release();
    }
  });

  it("rollback khi fn ném lỗi", async () => {
    await expect(
      withTenant(apiPool, orgA, async (client) => {
        await client.query("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)", [
          orgA,
          "tam@example.com",
          "Tam",
        ]);
        throw new Error("loi co y");
      }),
    ).rejects.toThrow("loi co y");

    const { rowCount } = await db.pool.query("SELECT 1 FROM users WHERE email = 'tam@example.com'");
    expect(rowCount).toBe(0);
  });

  it("từ chối orgId không phải UUID", async () => {
    await expect(
      withTenant(apiPool, "'; DROP TABLE users; --", async () => undefined),
    ).rejects.toBeInstanceOf(TenantError);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run packages/tenancy/src/with-tenant.int.test.ts`
Kỳ vọng: FAIL — không tìm thấy `./with-tenant.js`.

- [ ] **Step 3: Viết migration 002**

```sql
-- db/migrations/002_organizations_and_users.sql
-- Tổ chức và người dùng. Đây là nơi Row-Level Security lần đầu được áp dụng;
-- mọi bảng có org_id về sau đều lặp lại đúng khuôn này (ADR-003, bất biến F1).

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id),
  email      text NOT NULL,
  full_name  text NOT NULL,
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

CREATE INDEX users_org_id_idx ON users (org_id);

-- FORCE là bắt buộc, không chỉ ENABLE: nếu thiếu FORCE thì chủ sở hữu bảng
-- được miễn trừ policy, và mọi kết nối chạy dưới role chủ sở hữu sẽ thấy toàn bộ dữ liệu.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_tenant_isolation ON users
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- organizations không có cột org_id; chính id của nó là tổ chức.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY organizations_tenant_isolation ON organizations
  USING (id = app_current_org_id())
  WITH CHECK (id = app_current_org_id());

GRANT SELECT, INSERT, UPDATE ON organizations TO app_api;
GRANT SELECT ON organizations TO app_unseal;
GRANT SELECT, INSERT, UPDATE ON users TO app_api;
GRANT SELECT ON users TO app_unseal;
```

Lưu ý: bộ chạy migration kết nối bằng `postgres` (chủ sở hữu, có `BYPASSRLS` ngầm qua superuser), nên seed dữ liệu trong test vẫn ghi được qua `db.pool`. Mọi kiểm chứng cô lập phải chạy qua `db.poolAs("app_api")`.

- [ ] **Step 4: Viết `withTenant`**

```json
// packages/tenancy/package.json
{
  "name": "@trustprocure/tenancy",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "pg": "^8.13.0" }
}
```

```ts
// packages/tenancy/src/with-tenant.ts
import type pg from "pg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TenantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantError";
  }
}

/**
 * Chạy `fn` trong một transaction đã gắn tổ chức.
 *
 * `set_config(..., true)` giới hạn biến trong phạm vi transaction, nên giá trị tự
 * biến mất khi commit hoặc rollback. Điều này quan trọng với connection pool:
 * kết nối trả về pool không mang theo tổ chức của lần dùng trước.
 *
 * Mọi truy cập dữ liệu có org_id BẮT BUỘC đi qua hàm này. Đây là điểm duy nhất
 * gắn tenant context, để không có đường vòng nào bỏ qua RLS (bất biến F1).
 */
export async function withTenant<T>(
  pool: pg.Pool,
  orgId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(orgId)) {
    throw new TenantError(`orgId không phải UUID hợp lệ: ${JSON.stringify(orgId)}`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

```ts
// packages/tenancy/src/index.ts
export { TenantError, withTenant } from "./with-tenant.js";
```

Chạy: `pnpm install`

- [ ] **Step 5: Chạy test để xác nhận đạt**

Chạy: `pnpm vitest run packages/tenancy/src/with-tenant.int.test.ts`
Kỳ vọng: PASS — 8 test.

Nếu test `[INV-F1] chỉ thấy hàng của tổ chức đang gắn` trả về cả hai email: kiểm tra `FORCE ROW LEVEL SECURITY` đã chạy chưa, và pool có thực sự `SET ROLE app_api` không.

- [ ] **Step 6: Thêm kiểm tra tự động rằng không bảng nào quên bật RLS**

Đây là hàng rào chống lỗi tương lai: bảng mới có `org_id` mà quên `ENABLE`/`FORCE` sẽ làm test đỏ ngay.

```ts
// db/rls-coverage.int.test.ts
import { describe, expect, it } from "vitest";
import { withMigratedDatabase } from "@trustprocure/test-support";

describe("phủ RLS", () => {
  it("[INV-F1] mọi bảng có org_id đều bật ENABLE và FORCE row level security", async () => {
    await withMigratedDatabase(async (db) => {
      const { rows } = await db.pool.query<{ table_name: string; rowsecurity: boolean; forced: boolean }>(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forced
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND EXISTS (
              SELECT 1 FROM information_schema.columns col
               WHERE col.table_schema = 'public'
                 AND col.table_name = c.relname
                 AND col.column_name = 'org_id'
            )
          ORDER BY c.relname`,
      );

      expect(rows.length).toBeGreaterThan(0);
      const thieu = rows.filter((r) => !r.rowsecurity || !r.forced).map((r) => r.table_name);
      expect(thieu).toEqual([]);
    });
  });
});
```

Chạy: `pnpm test:int`
Kỳ vọng: PASS — bảng `users` là bảng duy nhất có `org_id` ở thời điểm này.

- [ ] **Step 7: Commit**

```bash
git add db packages/tenancy pnpm-lock.yaml
git commit -m "feat(tenancy): co lap to chuc cuong che o tang co so du lieu

Row-Level Security voi ENABLE va FORCE tren moi bang co org_id. FORCE la
bat buoc: thieu no thi chu so huu bang duoc mien tru policy va se thay
toan bo du lieu.

withTenant() la diem DUY NHAT gan tenant context, dung set_config pham vi
transaction nen bien tu bien mat khi commit hoac rollback — ket noi tra ve
pool khong mang theo to chuc cua lan dung truoc.

Them test phu RLS: bang moi co org_id ma quen bat RLS se lam CI do ngay,
thay vi cho toi luc ro ri that."
```

---

## Task 5: Lược đồ sổ kiểm toán và cưỡng chế chỉ-ghi-thêm

**Bất biến liên quan:** **B4** (không đường code nào xóa/sửa audit), nền cho **B3**.

**Files:**
- Create: `db/migrations/003_audit_events.sql`
- Create: `db/audit-append-only.int.test.ts`

**Interfaces:**
- Consumes: `app_current_org_id()`, `organizations` từ Task 3–4.
- Produces: bảng `audit_events` và `audit_chain_anchors` với cột như mô tả dưới, cùng ba trigger chặn UPDATE / DELETE / TRUNCATE. Task 6 ghi và kiểm chứng chuỗi trên hai bảng này.

- [ ] **Step 1: Viết test thất bại cho cưỡng chế chỉ-ghi-thêm**

```ts
// db/audit-append-only.int.test.ts
import { describe, expect, it } from "vitest";
import { withMigratedDatabase } from "@trustprocure/test-support";
import type pg from "pg";

async function seedAudit(pool: pg.Pool): Promise<{ orgId: string; eventId: string }> {
  const { rows: orgs } = await pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'a') RETURNING id",
  );
  const orgId = orgs[0]!.id;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO audit_events
       (org_id, seq, actor_type, action, resource_type, prev_hash, hash)
     VALUES ($1, 1, 'SYSTEM', 'TEST', 'TEST', decode(repeat('00', 32), 'hex'), sha256('x'::bytea))
     RETURNING id`,
    [orgId],
  );
  return { orgId, eventId: rows[0]!.id };
}

describe("audit_events chỉ ghi thêm", () => {
  it("[INV-B4] UPDATE bị trigger từ chối kể cả với quyền chủ sở hữu", async () => {
    await withMigratedDatabase(async (db) => {
      const { eventId } = await seedAudit(db.pool);
      await expect(
        db.pool.query("UPDATE audit_events SET action = 'SUA_TROM' WHERE id = $1", [eventId]),
      ).rejects.toThrow(/chỉ-ghi-thêm|append-only/i);
    });
  });

  it("[INV-B4] DELETE bị trigger từ chối", async () => {
    await withMigratedDatabase(async (db) => {
      const { eventId } = await seedAudit(db.pool);
      await expect(
        db.pool.query("DELETE FROM audit_events WHERE id = $1", [eventId]),
      ).rejects.toThrow(/chỉ-ghi-thêm|append-only/i);
    });
  });

  it("[INV-B3] TRUNCATE bị chặn — cắt đuôi chuỗi không im lặng được", async () => {
    await withMigratedDatabase(async (db) => {
      await seedAudit(db.pool);
      await expect(db.pool.query("TRUNCATE audit_events")).rejects.toThrow(
        /chỉ-ghi-thêm|append-only/i,
      );
    });
  });

  it("[INV-B4] role ứng dụng không có quyền UPDATE, DELETE, TRUNCATE", async () => {
    await withMigratedDatabase(async (db) => {
      const { rows } = await db.pool.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_name = 'audit_events' AND grantee IN ('app_api', 'app_unseal')`,
      );
      const quyen = new Set(rows.map((r) => r.privilege_type));
      expect(quyen.has("UPDATE")).toBe(false);
      expect(quyen.has("DELETE")).toBe(false);
      expect(quyen.has("TRUNCATE")).toBe(false);
      expect(quyen.has("INSERT")).toBe(true);
      expect(quyen.has("SELECT")).toBe(true);
    });
  });

  it("[INV-B4] không cho phép hai sự kiện cùng seq trong một tổ chức", async () => {
    await withMigratedDatabase(async (db) => {
      const { orgId } = await seedAudit(db.pool);
      await expect(
        db.pool.query(
          `INSERT INTO audit_events (org_id, seq, actor_type, action, resource_type, prev_hash, hash)
           VALUES ($1, 1, 'SYSTEM', 'TRUNG_SEQ', 'TEST', sha256('a'::bytea), sha256('b'::bytea))`,
          [orgId],
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run db/audit-append-only.int.test.ts`
Kỳ vọng: FAIL — bảng `audit_events` chưa tồn tại.

- [ ] **Step 3: Viết migration 003**

```sql
-- db/migrations/003_audit_events.sql
-- Sổ kiểm toán chuỗi hash, chỉ ghi thêm (ADR-004, bất biến B3, B4).
--
-- Ba lớp bảo vệ độc lập:
--   1. Trigger chặn UPDATE và DELETE ở mức hàng.
--   2. Trigger chặn TRUNCATE ở mức lệnh — TRUNCATE bỏ qua trigger hàng,
--      nên thiếu lớp này thì cắt đuôi chuỗi vẫn thực hiện được.
--   3. REVOKE quyền UPDATE, DELETE, TRUNCATE khỏi mọi role ứng dụng.

CREATE TABLE audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  seq           bigint NOT NULL CHECK (seq > 0),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_type    text NOT NULL CHECK (actor_type IN ('USER', 'SUPPLIER', 'SYSTEM', 'SERVICE')),
  actor_id      uuid,
  action        text NOT NULL,
  resource_type text NOT NULL,
  resource_id   uuid,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id    uuid,
  ip            inet,
  user_agent    text,
  prev_hash     bytea NOT NULL CHECK (octet_length(prev_hash) = 32),
  hash          bytea NOT NULL CHECK (octet_length(hash) = 32),
  UNIQUE (org_id, seq)
);

CREATE INDEX audit_events_org_seq_idx ON audit_events (org_id, seq DESC);
CREATE INDEX audit_events_resource_idx ON audit_events (org_id, resource_type, resource_id);

-- Mốc neo định kỳ: ghi lại đầu chuỗi tại một thời điểm.
-- Nếu ai đó xóa phần đuôi chuỗi, mốc neo trỏ tới seq không còn tồn tại và
-- bộ kiểm chứng phát hiện được. Bảng này cũng chỉ ghi thêm.
CREATE TABLE audit_chain_anchors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  seq         bigint NOT NULL,
  hash        bytea NOT NULL CHECK (octet_length(hash) = 32),
  anchored_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, seq)
);

CREATE OR REPLACE FUNCTION chan_sua_xoa() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bảng % là bảng chỉ-ghi-thêm (append-only): thao tác % bị từ chối',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_events_chan_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION chan_sua_xoa();
CREATE TRIGGER audit_events_chan_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION chan_sua_xoa();
CREATE TRIGGER audit_events_chan_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION chan_sua_xoa();

CREATE TRIGGER audit_anchors_chan_update BEFORE UPDATE ON audit_chain_anchors
  FOR EACH ROW EXECUTE FUNCTION chan_sua_xoa();
CREATE TRIGGER audit_anchors_chan_delete BEFORE DELETE ON audit_chain_anchors
  FOR EACH ROW EXECUTE FUNCTION chan_sua_xoa();
CREATE TRIGGER audit_anchors_chan_truncate BEFORE TRUNCATE ON audit_chain_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION chan_sua_xoa();

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_tenant_isolation ON audit_events
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

ALTER TABLE audit_chain_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_chain_anchors FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_anchors_tenant_isolation ON audit_chain_anchors
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

-- Chỉ SELECT và INSERT. Không UPDATE, không DELETE, không TRUNCATE.
REVOKE ALL ON audit_events FROM app_api, app_unseal;
REVOKE ALL ON audit_chain_anchors FROM app_api, app_unseal;
GRANT SELECT, INSERT ON audit_events TO app_api, app_unseal;
GRANT SELECT, INSERT ON audit_chain_anchors TO app_api, app_unseal;
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Chạy: `pnpm vitest run db/audit-append-only.int.test.ts`
Kỳ vọng: PASS — 5 test.

Nếu test TRUNCATE thất bại: kiểm tra trigger `BEFORE TRUNCATE` phải là `FOR EACH STATEMENT`, không phải `FOR EACH ROW` — Postgres từ chối `FOR EACH ROW` với TRUNCATE.

- [ ] **Step 5: Chạy lại test phủ RLS**

Chạy: `pnpm test:int`
Kỳ vọng: PASS. Test phủ RLS ở Task 4 giờ kiểm ba bảng: `users`, `audit_events`, `audit_chain_anchors`.

- [ ] **Step 6: Commit**

```bash
git add db
git commit -m "feat(audit): luoc do so kiem toan chi-ghi-them cuong che o tang DB

Ba lop bao ve doc lap:
- Trigger chan UPDATE va DELETE o muc hang.
- Trigger chan TRUNCATE o muc lenh. TRUNCATE bo qua trigger hang, nen
  thieu lop nay thi cat duoi chuoi van thuc hien duoc.
- REVOKE UPDATE, DELETE, TRUNCATE khoi moi role ung dung.

Them bang audit_chain_anchors ghi lai dau chuoi dinh ky: neu ai do xoa
phan duoi, moc neo tro toi seq khong con ton tai va bo kiem chung phat
hien duoc (ADR-004).

Chong tamper truoc ke tan cong co quyen superuser DB van nam ngoai mo hinh
de doa da chon — da ghi ro trong phan rui ro cua ADR-004."
```

---

## Task 6: Chuỗi hash kiểm toán và bộ kiểm chứng

**Bất biến liên quan:** **B3** (chèn, sửa, xóa, cắt đuôi đều bị phát hiện), **G4** (mọi thao tác khóa sinh audit — hạ tầng ghi).

> **Quyết định triển khai quan trọng:** hàm băm được tính **trong PostgreSQL**, không trong TypeScript.
>
> Lý do: nếu tính ở tầng ứng dụng thì phải tuần tự hóa `timestamptz` (độ chính xác micro-giây, còn `Date` của JS chỉ tới mili-giây) và `jsonb` (Postgres chuẩn hóa số và thứ tự khóa khi lưu). Chỉ một sai khác nhỏ ở khâu tuần tự hóa là toàn bộ chuỗi kiểm toán không kiểm chứng được — và lỗi đó sẽ chỉ lộ ra khi có người thật sự cần kiểm toán, tức là lúc tệ nhất.
>
> Đặt phép băm trong một hàm SQL `IMMUTABLE` dùng chung cho cả lúc ghi lẫn lúc kiểm chứng loại bỏ trọn vẹn lớp lỗi này theo cấu trúc.

**Files:**
- Create: `db/migrations/004_audit_chain_functions.sql`
- Create: `packages/audit/package.json`, `packages/audit/src/index.ts`, `packages/audit/src/writer.ts`, `packages/audit/src/verifier.ts`
- Create: `packages/audit/src/chain.int.test.ts`

**Interfaces:**
- Consumes: `withTenant` (Task 4); bảng `audit_events`, `audit_chain_anchors` (Task 5).
- Produces:
  - SQL: `audit_compute_hash(prev_hash bytea, org_id uuid, seq bigint, occurred_at timestamptz, actor_type text, actor_id uuid, action text, resource_type text, resource_id uuid, payload jsonb, request_id uuid) RETURNS bytea`
  - SQL: `audit_append(...) RETURNS TABLE (id uuid, seq bigint, hash bytea, occurred_at timestamptz)`
  - TS: `appendAuditEvent(client: pg.PoolClient, orgId: string, input: AuditEventInput): Promise<AuditEventRecord>`
  - TS: `verifyAuditChain(client: pg.PoolClient, orgId: string): Promise<VerificationResult>`
  - TS: `recordChainAnchor(client: pg.PoolClient, orgId: string): Promise<ChainAnchor | null>`
  - Kiểu: `AuditEventInput`, `AuditEventRecord`, `VerificationResult = { ok: boolean; checked: number; problems: ChainProblem[] }`, `ChainProblem = { seq: number; kind: "HASH_MISMATCH" | "LINK_BROKEN" | "SEQ_GAP" | "ANCHOR_MISSING"; detail: string }`

- [ ] **Step 1: Viết test thất bại cho chuỗi hash**

```ts
// packages/audit/src/chain.int.test.ts
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { appendAuditEvent, recordChainAnchor, verifyAuditChain } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;

async function newOrg(slug: string): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id",
    [slug],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  apiPool = db.poolAs("app_api");
});

afterAll(async () => {
  await db?.stop();
});

describe("chuỗi hash kiểm toán", () => {
  it("đánh số seq liên tục từ 1 và nối prev_hash đúng", async () => {
    const org = await newOrg("chuoi-co-ban");
    const records = await withTenant(apiPool, org, async (client) => {
      const a = await appendAuditEvent(client, org, {
        actorType: "SYSTEM",
        action: "RFQ_CREATED",
        resourceType: "RFQ",
      });
      const b = await appendAuditEvent(client, org, {
        actorType: "SYSTEM",
        action: "RFQ_OPENED",
        resourceType: "RFQ",
      });
      return [a, b];
    });

    expect(records.map((r) => r.seq)).toEqual([1, 2]);
    expect(records[1]!.prevHash.equals(records[0]!.hash)).toBe(true);
  });

  it("[INV-B3] chuỗi nguyên vẹn thì kiểm chứng đạt", async () => {
    const org = await newOrg("chuoi-nguyen-ven");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 25; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `HANH_DONG_${i}`,
          resourceType: "TEST",
          payload: { chiSo: i, ghiChu: "giá trị có dấu tiếng Việt" },
        });
      }
    });

    const result = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(25);
    expect(result.problems).toEqual([]);
  });

  it("[INV-B3] sửa nội dung một sự kiện làm kiểm chứng thất bại", async () => {
    const org = await newOrg("chuoi-bi-sua");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 5; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `A${i}`,
          resourceType: "TEST",
        });
      }
    });

    // Trigger chặn UPDATE, nên mô phỏng kẻ tấn công có quyền cao hơn:
    // tạm gỡ trigger, sửa, rồi gắn lại. Đây chính là điều mà chuỗi hash
    // phải phát hiện được ngay cả khi lớp trigger bị vô hiệu hóa.
    await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_update");
    await db.pool.query("UPDATE audit_events SET action = 'DA_BI_SUA' WHERE org_id = $1 AND seq = 3", [org]);
    await db.pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_chan_update");

    const result = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.seq === 3 && p.kind === "HASH_MISMATCH")).toBe(true);
  });

  it("[INV-B3] xóa một sự kiện ở giữa làm kiểm chứng thất bại", async () => {
    const org = await newOrg("chuoi-bi-xoa-giua");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 5; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `B${i}`,
          resourceType: "TEST",
        });
      }
    });

    await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_delete");
    await db.pool.query("DELETE FROM audit_events WHERE org_id = $1 AND seq = 3", [org]);
    await db.pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_chan_delete");

    const result = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.kind === "SEQ_GAP")).toBe(true);
  });

  it("[INV-B3] cắt đuôi chuỗi bị phát hiện nhờ mốc neo", async () => {
    const org = await newOrg("chuoi-bi-cat-duoi");
    await withTenant(apiPool, org, async (client) => {
      for (let i = 0; i < 6; i += 1) {
        await appendAuditEvent(client, org, {
          actorType: "USER",
          action: `C${i}`,
          resourceType: "TEST",
        });
      }
      await recordChainAnchor(client, org);
    });

    await db.pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chan_delete");
    await db.pool.query("DELETE FROM audit_events WHERE org_id = $1 AND seq > 4", [org]);
    await db.pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_chan_delete");

    const result = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.kind === "ANCHOR_MISSING")).toBe(true);
  });

  it("[INV-F1] chuỗi của hai tổ chức độc lập nhau", async () => {
    const orgX = await newOrg("chuoi-org-x");
    const orgY = await newOrg("chuoi-org-y");

    await withTenant(apiPool, orgX, (client) =>
      appendAuditEvent(client, orgX, { actorType: "SYSTEM", action: "X1", resourceType: "T" }),
    );
    const y = await withTenant(apiPool, orgY, (client) =>
      appendAuditEvent(client, orgY, { actorType: "SYSTEM", action: "Y1", resourceType: "T" }),
    );

    // Mỗi tổ chức có chuỗi riêng, nên sự kiện đầu tiên của org Y vẫn là seq 1.
    expect(y.seq).toBe(1);
  });

  it("ghi đồng thời không làm chuỗi phân nhánh", async () => {
    const org = await newOrg("chuoi-dong-thoi");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        withTenant(apiPool, org, (client) =>
          appendAuditEvent(client, org, {
            actorType: "SYSTEM",
            action: `SONG_SONG_${i}`,
            resourceType: "TEST",
          }),
        ),
      ),
    );

    const result = await withTenant(apiPool, org, (client) => verifyAuditChain(client, org));
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(20);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run packages/audit/src/chain.int.test.ts`
Kỳ vọng: FAIL — không tìm thấy `./index.js`.

- [ ] **Step 3: Viết migration 004 — hàm băm và hàm ghi nối chuỗi**

```sql
-- db/migrations/004_audit_chain_functions.sql
-- Phép băm chuỗi kiểm toán đặt trong SQL, không trong tầng ứng dụng.
--
-- Nếu băm ở tầng ứng dụng thì phải tuần tự hóa timestamptz (micro-giây, trong khi
-- Date của JS chỉ tới mili-giây) và jsonb (Postgres chuẩn hóa số và thứ tự khóa khi lưu).
-- Một sai khác nhỏ ở khâu tuần tự hóa làm cả chuỗi không kiểm chứng được, và lỗi đó
-- chỉ lộ ra đúng lúc có người thật sự cần kiểm toán. Dùng chung một hàm IMMUTABLE cho
-- cả lúc ghi lẫn lúc kiểm chứng loại bỏ trọn vẹn lớp lỗi này theo cấu trúc.

CREATE OR REPLACE FUNCTION audit_compute_hash(
  p_prev_hash     bytea,
  p_org_id        uuid,
  p_seq           bigint,
  p_occurred_at   timestamptz,
  p_actor_type    text,
  p_actor_id      uuid,
  p_action        text,
  p_resource_type text,
  p_resource_id   uuid,
  p_payload       jsonb,
  p_request_id    uuid
) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$
-- KHÔNG dùng STRICT: actor_id, resource_id, request_id được phép NULL và đã được
-- coalesce về chuỗi rỗng bên trong. STRICT sẽ khiến cả hàm trả NULL khi gặp NULL,
-- làm ràng buộc octet_length(hash) = 32 thất bại — im lặng phá chuỗi.
  SELECT sha256(
    p_prev_hash ||
    convert_to(
      concat_ws(
        chr(31),
        p_org_id::text,
        p_seq::text,
        to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        p_actor_type,
        coalesce(p_actor_id::text, ''),
        p_action,
        p_resource_type,
        coalesce(p_resource_id::text, ''),
        p_payload::text,
        coalesce(p_request_id::text, '')
      ),
      'UTF8'
    )
  )
$$;

-- Ghi một sự kiện và nối vào chuỗi, nguyên tử trong transaction của người gọi.
-- Chạy dưới quyền người gọi (SECURITY INVOKER mặc định) nên RLS vẫn áp dụng:
-- ghi vào tổ chức khác sẽ bị policy WITH CHECK từ chối.
CREATE OR REPLACE FUNCTION audit_append(
  p_org_id        uuid,
  p_actor_type    text,
  p_actor_id      uuid,
  p_action        text,
  p_resource_type text,
  p_resource_id   uuid,
  p_payload       jsonb,
  p_request_id    uuid,
  p_ip            inet,
  p_user_agent    text
) RETURNS TABLE (id uuid, seq bigint, prev_hash bytea, hash bytea, occurred_at timestamptz)
LANGUAGE plpgsql AS $$
DECLARE
  v_prev_hash bytea;
  v_seq       bigint;
  v_ts        timestamptz;
  v_hash      bytea;
  v_id        uuid;
  v_payload   jsonb := coalesce(p_payload, '{}'::jsonb);
BEGIN
  -- Khóa theo tổ chức, phạm vi transaction. Hai lần ghi đồng thời cùng tổ chức
  -- sẽ nối tiếp nhau thay vì cùng đọc một đầu chuỗi, nên chuỗi không phân nhánh.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  SELECT ae.seq, ae.hash INTO v_seq, v_prev_hash
    FROM audit_events ae
   WHERE ae.org_id = p_org_id
   ORDER BY ae.seq DESC
   LIMIT 1;

  IF v_seq IS NULL THEN
    v_seq := 1;
    v_prev_hash := decode(repeat('00', 32), 'hex');
  ELSE
    v_seq := v_seq + 1;
  END IF;

  v_ts := clock_timestamp();

  v_hash := audit_compute_hash(v_prev_hash, p_org_id, v_seq, v_ts, p_actor_type,
                               p_actor_id, p_action, p_resource_type, p_resource_id,
                               v_payload, p_request_id);

  INSERT INTO audit_events (org_id, seq, occurred_at, actor_type, actor_id, action,
                            resource_type, resource_id, payload, request_id, ip,
                            user_agent, prev_hash, hash)
  VALUES (p_org_id, v_seq, v_ts, p_actor_type, p_actor_id, p_action, p_resource_type,
          p_resource_id, v_payload, p_request_id, p_ip, p_user_agent, v_prev_hash, v_hash)
  RETURNING audit_events.id INTO v_id;

  RETURN QUERY SELECT v_id, v_seq, v_prev_hash, v_hash, v_ts;
END
$$;

GRANT EXECUTE ON FUNCTION audit_compute_hash(bytea, uuid, bigint, timestamptz, text, uuid, text, text, uuid, jsonb, uuid) TO app_api, app_unseal;
GRANT EXECUTE ON FUNCTION audit_append(uuid, text, uuid, text, text, uuid, jsonb, uuid, inet, text) TO app_api, app_unseal;
```

> `clock_timestamp()` chứ không phải `now()`: `now()` trả về thời điểm bắt đầu transaction, nên nhiều sự kiện ghi trong cùng một transaction sẽ có cùng dấu thời gian. Chuỗi vẫn kiểm chứng được, nhưng thứ tự thời gian thật của các sự kiện sẽ mất — điều đó làm hỏng giá trị của sổ kiểm toán khi điều tra.

- [ ] **Step 4: Viết package `audit`**

```json
// packages/audit/package.json
{
  "name": "@trustprocure/audit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "pg": "^8.13.0" }
}
```

```ts
// packages/audit/src/writer.ts
import type pg from "pg";

export type ActorType = "USER" | "SUPPLIER" | "SYSTEM" | "SERVICE";

export interface AuditEventInput {
  readonly actorType: ActorType;
  readonly actorId?: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly payload?: Record<string, unknown>;
  readonly requestId?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface AuditEventRecord {
  readonly id: string;
  readonly seq: number;
  readonly prevHash: Buffer;
  readonly hash: Buffer;
  readonly occurredAt: Date;
}

export interface ChainAnchor {
  readonly seq: number;
  readonly hash: Buffer;
}

interface AppendRow {
  id: string;
  seq: string;
  prev_hash: Buffer;
  hash: Buffer;
  occurred_at: Date;
}

/**
 * Ghi một sự kiện kiểm toán và nối vào chuỗi hash của tổ chức.
 *
 * Phải gọi bên trong một transaction đã gắn tenant (withTenant), vì hàm SQL
 * audit_append dùng khóa tư vấn phạm vi transaction để giữ chuỗi không phân nhánh.
 *
 * Không bao giờ đưa giá, mật khẩu, token, OTP hay khóa vào `payload`.
 */
export async function appendAuditEvent(
  client: pg.PoolClient,
  orgId: string,
  input: AuditEventInput,
): Promise<AuditEventRecord> {
  const { rows } = await client.query<AppendRow>(
    "SELECT * FROM audit_append($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [
      orgId,
      input.actorType,
      input.actorId ?? null,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      JSON.stringify(input.payload ?? {}),
      input.requestId ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
    ],
  );

  const row = rows[0];
  if (!row) throw new Error("audit_append không trả về bản ghi nào");

  return {
    id: row.id,
    seq: Number(row.seq),
    prevHash: row.prev_hash,
    hash: row.hash,
    occurredAt: row.occurred_at,
  };
}

/** Ghi mốc neo cho đầu chuỗi hiện tại. Trả null nếu tổ chức chưa có sự kiện nào. */
export async function recordChainAnchor(
  client: pg.PoolClient,
  orgId: string,
): Promise<ChainAnchor | null> {
  const { rows } = await client.query<{ seq: string; hash: Buffer }>(
    `INSERT INTO audit_chain_anchors (org_id, seq, hash)
     SELECT ae.org_id, ae.seq, ae.hash
       FROM audit_events ae
      WHERE ae.org_id = $1
      ORDER BY ae.seq DESC
      LIMIT 1
     ON CONFLICT (org_id, seq) DO NOTHING
     RETURNING seq, hash`,
    [orgId],
  );

  const row = rows[0];
  return row ? { seq: Number(row.seq), hash: row.hash } : null;
}
```

```ts
// packages/audit/src/verifier.ts
import type pg from "pg";

export type ChainProblemKind = "HASH_MISMATCH" | "LINK_BROKEN" | "SEQ_GAP" | "ANCHOR_MISSING";

export interface ChainProblem {
  readonly seq: number;
  readonly kind: ChainProblemKind;
  readonly detail: string;
}

export interface VerificationResult {
  readonly ok: boolean;
  readonly checked: number;
  readonly problems: readonly ChainProblem[];
}

const GENESIS_HASH = Buffer.alloc(32, 0);

interface ChainRow {
  seq: string;
  prev_hash: Buffer;
  hash: Buffer;
  recomputed: Buffer;
}

/**
 * Kiểm chứng chuỗi kiểm toán của một tổ chức.
 *
 * Phát hiện được: sửa nội dung (HASH_MISMATCH), đứt liên kết (LINK_BROKEN),
 * xóa hàng ở giữa (SEQ_GAP), và cắt đuôi chuỗi (ANCHOR_MISSING — nhờ mốc neo).
 *
 * Băm được tính lại bằng chính hàm SQL đã dùng lúc ghi, nên không có nguy cơ
 * lệch do tuần tự hóa giữa hai tầng.
 */
export async function verifyAuditChain(
  client: pg.PoolClient,
  orgId: string,
): Promise<VerificationResult> {
  const { rows } = await client.query<ChainRow>(
    `SELECT ae.seq, ae.prev_hash, ae.hash,
            audit_compute_hash(ae.prev_hash, ae.org_id, ae.seq, ae.occurred_at,
                               ae.actor_type, ae.actor_id, ae.action, ae.resource_type,
                               ae.resource_id, ae.payload, ae.request_id) AS recomputed
       FROM audit_events ae
      WHERE ae.org_id = $1
      ORDER BY ae.seq`,
    [orgId],
  );

  const problems: ChainProblem[] = [];
  let expectedSeq = 1;
  let expectedPrev = GENESIS_HASH;

  for (const row of rows) {
    const seq = Number(row.seq);

    if (seq !== expectedSeq) {
      problems.push({
        seq,
        kind: "SEQ_GAP",
        detail: `Kỳ vọng seq ${expectedSeq} nhưng gặp ${seq} — có hàng bị xóa hoặc chèn.`,
      });
      expectedSeq = seq;
    }

    if (!row.prev_hash.equals(expectedPrev)) {
      problems.push({
        seq,
        kind: "LINK_BROKEN",
        detail: "prev_hash không khớp hash của sự kiện liền trước.",
      });
    }

    if (!row.hash.equals(row.recomputed)) {
      problems.push({
        seq,
        kind: "HASH_MISMATCH",
        detail: "Nội dung sự kiện đã bị thay đổi sau khi ghi.",
      });
    }

    expectedPrev = row.hash;
    expectedSeq = seq + 1;
  }

  // Mốc neo trỏ tới sự kiện không còn tồn tại nghĩa là chuỗi đã bị cắt đuôi.
  const { rows: anchorRows } = await client.query<{ seq: string }>(
    `SELECT a.seq
       FROM audit_chain_anchors a
      WHERE a.org_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM audit_events ae
           WHERE ae.org_id = a.org_id AND ae.seq = a.seq AND ae.hash = a.hash
        )
      ORDER BY a.seq`,
    [orgId],
  );

  for (const anchor of anchorRows) {
    problems.push({
      seq: Number(anchor.seq),
      kind: "ANCHOR_MISSING",
      detail: `Mốc neo tại seq ${anchor.seq} không còn sự kiện tương ứng — chuỗi đã bị cắt đuôi.`,
    });
  }

  return { ok: problems.length === 0, checked: rows.length, problems };
}
```

```ts
// packages/audit/src/index.ts
export {
  appendAuditEvent,
  recordChainAnchor,
  type ActorType,
  type AuditEventInput,
  type AuditEventRecord,
  type ChainAnchor,
} from "./writer.js";
export {
  verifyAuditChain,
  type ChainProblem,
  type ChainProblemKind,
  type VerificationResult,
} from "./verifier.js";
```

Chạy: `pnpm install`

- [ ] **Step 5: Chạy test để xác nhận đạt**

Chạy: `pnpm vitest run packages/audit/src/chain.int.test.ts`
Kỳ vọng: PASS — 8 test.

Nếu test *ghi đồng thời* thất bại với lỗi trùng khóa `(org_id, seq)`: khóa tư vấn chưa hoạt động. Kiểm tra `pg_advisory_xact_lock` được gọi **trước** câu `SELECT ... ORDER BY seq DESC`, và mọi lần ghi đều nằm trong transaction do `withTenant` mở.

- [ ] **Step 6: Commit**

```bash
git add db packages/audit pnpm-lock.yaml
git commit -m "feat(audit): chuoi hash kiem toan va bo kiem chung

Phep bam dat trong ham SQL IMMUTABLE dung chung cho ca luc ghi lan luc
kiem chung. Neu bam o tang ung dung thi phai tuan tu hoa timestamptz
(micro-giay, trong khi Date cua JS chi toi mili-giay) va jsonb (Postgres
chuan hoa so va thu tu khoa khi luu) — mot sai khac nho lam ca chuoi khong
kiem chung duoc, va loi do chi lo ra dung luc co nguoi that su can kiem toan.

audit_append dung khoa tu van pham vi transaction theo to chuc nen ghi dong
thoi khong lam chuoi phan nhanh. Dung clock_timestamp() thay now() de nhieu
su kien trong cung transaction khong mang cung dau thoi gian.

Bo kiem chung phat hien: sua noi dung, dut lien ket, xoa hang o giua, va
cat duoi chuoi nho moc neo. Test mo phong ke tan cong go trigger de chung
minh chuoi hash van phat hien duoc khi lop trigger bi vo hieu hoa."
```

---

## Task 7: KeyProvider — tách entrypoint bọc khóa và mở khóa

**Bất biến liên quan:** **G1** (khóa riêng không rời runtime có kiểm soát), **G2** (mỗi RFQ một khóa, không lan), **G3** (xoay master key không mất khả năng giải mã cũ), **F3** (khóa tổ chức A không mở được dữ liệu tổ chức B).

**Files:**
- Create: `packages/crypto-keys/src/types.ts`, `src/master-keys.ts`, `src/local-dev-shared.ts`, `src/local-dev-wrapper.ts`, `src/local-dev-unwrapper.ts`
- Modify: `packages/crypto-keys/src/index.ts`, `packages/crypto-keys/src/unwrap.ts`
- Create: `packages/crypto-keys/src/wrapper.test.ts`, `packages/crypto-keys/src/roundtrip.test.ts`
- Create: `tools/bench-keyprovider/package.json`, `tools/bench-keyprovider/src/index.ts`
- Modify: `package.json` (thêm `fast-check`, script `bench:keys`)

**Interfaces:**
- Consumes: khung entrypoint từ Task 2.
- Produces:
  - `@trustprocure/crypto-keys`: `WrappedKey = { ciphertext: Uint8Array; keyVersion: string }`, `KeyWrapper = { name: string; wrap(orgId: string, plaintext: Uint8Array): Promise<WrappedKey> }`, `MasterKeyRing`, `createLocalDevWrapper(ring: MasterKeyRing): KeyWrapper`
  - `@trustprocure/crypto-keys/unwrap`: `KeyUnwrapper = { name: string; unwrap(orgId: string, wrapped: WrappedKey): Promise<Uint8Array> }`, `createLocalDevUnwrapper(ring: MasterKeyRing): KeyUnwrapper`
  - Định dạng phong bì: `version(1 byte) || iv(12 byte) || tag(16 byte) || ciphertext`

- [ ] **Step 1: Cài `fast-check` và thêm script benchmark**

Thêm vào `devDependencies` gốc: `"fast-check": "^3.22.0"`.
Thêm vào `scripts` gốc: `"bench:keys": "node --experimental-strip-types tools/bench-keyprovider/src/index.ts"`.

Chạy: `pnpm install`

- [ ] **Step 2: Viết test thất bại cho vòng đời khóa**

```ts
// packages/crypto-keys/src/roundtrip.test.ts
import { randomBytes, randomUUID } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createLocalDevWrapper, MasterKeyRing } from "./index.js";
import { createLocalDevUnwrapper } from "./unwrap.js";

function ring(): MasterKeyRing {
  return new MasterKeyRing("v2", {
    v1: randomBytes(32),
    v2: randomBytes(32),
  });
}

describe("vòng đời khóa", () => {
  it("bọc rồi mở trả lại đúng nguyên bản", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();

    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 1, maxLength: 512 }), async (plaintext) => {
        const wrapped = await wrapper.wrap(orgId, plaintext);
        const opened = await unwrapper.unwrap(orgId, wrapped);
        expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("[INV-A2] ciphertext không chứa chuỗi con của bản rõ", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const orgId = randomUUID();
    const plaintext = Buffer.from("gia-bao-1250000-VND-bi-mat");

    const wrapped = await wrapper.wrap(orgId, plaintext);
    expect(Buffer.from(wrapped.ciphertext).includes(plaintext)).toBe(false);
  });

  it("[INV-G2] đổi một bit bất kỳ trong phong bì làm việc mở thất bại", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgId = randomUUID();
    const wrapped = await wrapper.wrap(orgId, Buffer.from("noi dung can bao ve"));

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: wrapped.ciphertext.length - 1 }),
        fc.integer({ min: 1, max: 255 }),
        async (index, xor) => {
          const hong = Uint8Array.from(wrapped.ciphertext);
          hong[index] = hong[index]! ^ xor;
          await expect(unwrapper.unwrap(orgId, { ...wrapped, ciphertext: hong })).rejects.toThrow();
        },
      ),
      { numRuns: 60 },
    );
  });

  it("[INV-F3] khóa của tổ chức khác không mở được phong bì", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const unwrapper = createLocalDevUnwrapper(r);
    const orgA = randomUUID();
    const orgB = randomUUID();

    const wrapped = await wrapper.wrap(orgA, Buffer.from("du lieu cua to chuc A"));
    await expect(unwrapper.unwrap(orgB, wrapped)).rejects.toThrow(/mở phong bì thất bại/i);
  });

  it("[INV-G3] xoay master key vẫn mở được phong bì bọc bằng phiên bản cũ", async () => {
    const v1 = randomBytes(32);
    const cu = new MasterKeyRing("v1", { v1 });
    const orgId = randomUUID();
    const plaintext = Buffer.from("bao gia cu");

    const wrappedCu = await createLocalDevWrapper(cu).wrap(orgId, plaintext);
    expect(wrappedCu.keyVersion).toBe("v1");

    // Sau khi xoay: v2 là phiên bản đang dùng, v1 vẫn giữ để giải mã dữ liệu cũ.
    const sauXoay = new MasterKeyRing("v2", { v1, v2: randomBytes(32) });
    const opened = await createLocalDevUnwrapper(sauXoay).unwrap(orgId, wrappedCu);
    expect(Buffer.from(opened).equals(plaintext)).toBe(true);

    // Phong bì mới dùng phiên bản mới.
    const wrappedMoi = await createLocalDevWrapper(sauXoay).wrap(orgId, plaintext);
    expect(wrappedMoi.keyVersion).toBe("v2");
  });

  it("[INV-G3] thiếu phiên bản khóa trong vòng khóa thì báo lỗi rõ ràng", async () => {
    const orgId = randomUUID();
    const wrapped = await createLocalDevWrapper(
      new MasterKeyRing("v1", { v1: randomBytes(32) }),
    ).wrap(orgId, Buffer.from("x"));

    const thieu = new MasterKeyRing("v9", { v9: randomBytes(32) });
    await expect(createLocalDevUnwrapper(thieu).unwrap(orgId, wrapped)).rejects.toThrow(
      /không có phiên bản khóa "v1"/i,
    );
  });

  it("hai lần bọc cùng bản rõ cho ra hai phong bì khác nhau", async () => {
    const r = ring();
    const wrapper = createLocalDevWrapper(r);
    const orgId = randomUUID();
    const plaintext = Buffer.from("cung mot noi dung");

    const a = await wrapper.wrap(orgId, plaintext);
    const b = await wrapper.wrap(orgId, plaintext);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it("từ chối master key không đủ 32 byte", () => {
    expect(() => new MasterKeyRing("v1", { v1: randomBytes(16) })).toThrow(/32 byte/);
  });

  it("từ chối vòng khóa không chứa phiên bản đang dùng", () => {
    expect(() => new MasterKeyRing("v2", { v1: randomBytes(32) })).toThrow(/phiên bản đang dùng/i);
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run packages/crypto-keys`
Kỳ vọng: FAIL — `MasterKeyRing` chưa tồn tại.

- [ ] **Step 4: Viết kiểu và vòng khóa**

```ts
// packages/crypto-keys/src/types.ts
/** Một khóa đã được bọc. `keyVersion` cho biết master key nào bọc nó — nền tảng của việc xoay khóa. */
export interface WrappedKey {
  readonly ciphertext: Uint8Array;
  readonly keyVersion: string;
}

export class KeyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KeyError";
  }
}
```

```ts
// packages/crypto-keys/src/master-keys.ts
import { KeyError } from "./types.js";

/**
 * Tập master key theo phiên bản.
 *
 * Xoay khóa nghĩa là thêm một phiên bản mới và chuyển `activeVersion` sang nó,
 * đồng thời GIỮ LẠI các phiên bản cũ. Phong bì bọc bằng phiên bản cũ vẫn mở được
 * (bất biến G3) — nếu bỏ phiên bản cũ đi thì toàn bộ báo giá đã niêm phong trước
 * lần xoay sẽ vĩnh viễn không mở được.
 */
export class MasterKeyRing {
  readonly #keys: ReadonlyMap<string, Buffer>;

  constructor(
    readonly activeVersion: string,
    keys: Readonly<Record<string, Buffer>>,
  ) {
    const entries = Object.entries(keys);
    for (const [version, key] of entries) {
      if (key.length !== 32) {
        throw new KeyError(`Master key "${version}" phải dài đúng 32 byte, đang là ${key.length}.`);
      }
    }
    if (!Object.hasOwn(keys, activeVersion)) {
      throw new KeyError(
        `Vòng khóa không chứa phiên bản đang dùng "${activeVersion}".`,
      );
    }
    this.#keys = new Map(entries);
  }

  get(version: string): Buffer {
    const key = this.#keys.get(version);
    if (!key) {
      throw new KeyError(`Vòng khóa không có phiên bản khóa "${version}".`);
    }
    return key;
  }

  active(): { version: string; key: Buffer } {
    return { version: this.activeVersion, key: this.get(this.activeVersion) };
  }
}
```

- [ ] **Step 5: Viết phần dùng chung và bộ bọc khóa**

```ts
// packages/crypto-keys/src/local-dev-shared.ts
import { hkdfSync } from "node:crypto";

export const ENVELOPE_VERSION = 1;
export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;
export const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;

/**
 * Dẫn xuất khóa riêng cho từng tổ chức từ master key.
 *
 * `orgId` làm salt nên khóa của hai tổ chức khác nhau là hai khóa khác nhau:
 * phong bì của tổ chức A không mở được bằng ngữ cảnh tổ chức B (bất biến F3).
 */
export function deriveOrgKey(masterKey: Buffer, orgId: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", masterKey, Buffer.from(orgId, "utf8"), Buffer.from("trustprocure/org-dek/v1", "utf8"), 32),
  );
}
```

```ts
// packages/crypto-keys/src/local-dev-wrapper.ts
import { createCipheriv, randomBytes } from "node:crypto";
import { ENVELOPE_VERSION, deriveOrgKey, IV_LENGTH } from "./local-dev-shared.js";
import type { MasterKeyRing } from "./master-keys.js";
import type { WrappedKey } from "./types.js";

export interface KeyWrapper {
  readonly name: string;
  wrap(orgId: string, plaintext: Uint8Array): Promise<WrappedKey>;
}

/**
 * Bộ bọc khóa dùng cho phát triển và test. Môi trường thật dùng adapter KMS/Vault,
 * nơi master key không bao giờ rời khỏi dịch vụ quản lý khóa.
 */
export function createLocalDevWrapper(ring: MasterKeyRing): KeyWrapper {
  return {
    name: "local-dev",
    wrap(orgId: string, plaintext: Uint8Array): Promise<WrappedKey> {
      const { version, key } = ring.active();
      const orgKey = deriveOrgKey(key, orgId);
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv("aes-256-gcm", orgKey, iv);
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();

      // version || iv || tag || ciphertext
      const envelope = Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, body]);
      orgKey.fill(0);

      return Promise.resolve({ ciphertext: envelope, keyVersion: version });
    },
  };
}
```

- [ ] **Step 6: Viết bộ mở khóa**

```ts
// packages/crypto-keys/src/local-dev-unwrapper.ts
import { createDecipheriv } from "node:crypto";
import {
  ENVELOPE_VERSION,
  deriveOrgKey,
  HEADER_LENGTH,
  IV_LENGTH,
  TAG_LENGTH,
} from "./local-dev-shared.js";
import type { MasterKeyRing } from "./master-keys.js";
import { KeyError, type WrappedKey } from "./types.js";

export interface KeyUnwrapper {
  readonly name: string;
  unwrap(orgId: string, wrapped: WrappedKey): Promise<Uint8Array>;
}

export function createLocalDevUnwrapper(ring: MasterKeyRing): KeyUnwrapper {
  return {
    name: "local-dev",
    unwrap(orgId: string, wrapped: WrappedKey): Promise<Uint8Array> {
      const envelope = Buffer.from(wrapped.ciphertext);
      if (envelope.length < HEADER_LENGTH) {
        throw new KeyError("Mở phong bì thất bại: dữ liệu ngắn hơn phần đầu bắt buộc.");
      }
      if (envelope[0] !== ENVELOPE_VERSION) {
        throw new KeyError(`Mở phong bì thất bại: phiên bản định dạng ${String(envelope[0])} không hỗ trợ.`);
      }

      // ring.get() ném KeyError riêng khi thiếu phiên bản, để phân biệt
      // "chưa có khóa" với "dữ liệu đã bị sửa" — hai sự cố cần xử lý khác nhau.
      const orgKey = deriveOrgKey(ring.get(wrapped.keyVersion), orgId);

      const iv = envelope.subarray(1, 1 + IV_LENGTH);
      const tag = envelope.subarray(1 + IV_LENGTH, HEADER_LENGTH);
      const body = envelope.subarray(HEADER_LENGTH);

      try {
        const decipher = createDecipheriv("aes-256-gcm", orgKey, iv);
        decipher.setAuthTag(tag);
        const opened = Buffer.concat([decipher.update(body), decipher.final()]);
        return Promise.resolve(opened);
      } catch (error) {
        // Không lộ chi tiết mật mã ra thông báo lỗi.
        throw new KeyError("Mở phong bì thất bại: dữ liệu không toàn vẹn hoặc sai ngữ cảnh tổ chức.", {
          cause: error,
        });
      } finally {
        orgKey.fill(0);
      }
    },
  };
}
```

- [ ] **Step 7: Nối hai entrypoint**

```ts
// packages/crypto-keys/src/index.ts
// Entrypoint BỌC khóa — an toàn cho mọi service import.
// Đường MỞ khóa nằm ở "./unwrap.js" và chỉ apps/unseal-worker được chạm (ADR-006, INV-G1).
export { KeyError, type WrappedKey } from "./types.js";
export { MasterKeyRing } from "./master-keys.js";
export { createLocalDevWrapper, type KeyWrapper } from "./local-dev-wrapper.js";
```

```ts
// packages/crypto-keys/src/unwrap.ts
// Entrypoint MỞ khóa. CHỈ apps/unseal-worker được import file này.
// Quy tắc "khong-giai-ma-ngoai-unseal-worker" trong .dependency-cruiser.cjs cưỡng chế
// điều này ở tầng T0 — vi phạm làm CI đỏ ngay tại commit (ADR-006, bất biến G1).
export { createLocalDevUnwrapper, type KeyUnwrapper } from "./local-dev-unwrapper.js";
```

- [ ] **Step 8: Chạy test để xác nhận đạt**

Chạy: `pnpm vitest run packages/crypto-keys`
Kỳ vọng: PASS — 9 test.

- [ ] **Step 9: Xác nhận quy tắc ranh giới vẫn còn hiệu lực**

Test ở Task 2 dùng `packages/crypto-keys/src/unwrap.ts` làm mục tiêu. File này giờ đã có nội dung thật.

Chạy: `pnpm vitest run tests/architecture/boundaries.test.ts && pnpm depcruise`
Kỳ vọng: PASS — test đối kháng vẫn chứng minh quy tắc chặn, và mã hiện tại không vi phạm.

- [ ] **Step 10: Viết công cụ đo hiệu năng khóa**

Rủi ro §8.4 của spec: mở thầu một RFQ có 50 nhà cung cấp × 200 hạng mục sinh ra rất nhiều thao tác mở khóa. Phải đo ngay ở S0, không đợi tới S1.6.

```json
// tools/bench-keyprovider/package.json
{
  "name": "@trustprocure/bench-keyprovider",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "@trustprocure/crypto-keys": "workspace:*" }
}
```

```ts
// tools/bench-keyprovider/src/index.ts
import { randomBytes, randomUUID } from "node:crypto";
import { createLocalDevWrapper, MasterKeyRing } from "@trustprocure/crypto-keys";
import { createLocalDevUnwrapper } from "@trustprocure/crypto-keys/unwrap";

const SO_LAN = Number(process.env["BENCH_ITERATIONS"] ?? 10_000);

async function main(): Promise<void> {
  const ring = new MasterKeyRing("v1", { v1: randomBytes(32) });
  const wrapper = createLocalDevWrapper(ring);
  const unwrapper = createLocalDevUnwrapper(ring);
  const orgId = randomUUID();
  const plaintext = randomBytes(32);

  const batDauBoc = performance.now();
  const envelopes = [];
  for (let i = 0; i < SO_LAN; i += 1) envelopes.push(await wrapper.wrap(orgId, plaintext));
  const msBoc = performance.now() - batDauBoc;

  const batDauMo = performance.now();
  for (const envelope of envelopes) await unwrapper.unwrap(orgId, envelope);
  const msMo = performance.now() - batDauMo;

  console.log(`Provider        : ${wrapper.name}`);
  console.log(`Số lần          : ${SO_LAN}`);
  console.log(`Bọc khóa        : ${msBoc.toFixed(0)} ms  (${(SO_LAN / (msBoc / 1000)).toFixed(0)} thao tác/giây)`);
  console.log(`Mở khóa         : ${msMo.toFixed(0)} ms  (${(SO_LAN / (msMo / 1000)).toFixed(0)} thao tác/giây)`);
  console.log("");
  console.log("Tham chiếu: RFQ 50 nhà cung cấp x 200 hạng mục = 10.000 lần mở khóa.");
  console.log("Adapter KMS thật sẽ chậm hơn nhiều bậc vì mỗi lần là một lời gọi mạng —");
  console.log("khi thêm adapter đó, chạy lại benchmark này trước khi bắt đầu S1.6.");
}

await main();
```

- [ ] **Step 11: Chạy benchmark và ghi kết quả**

Chạy: `pnpm bench:keys`
Kỳ vọng: in ra thông lượng. Chép con số vào `docs/STATE.md` mục *Vấn đề đã biết* để lần đo với KMS thật có mốc so sánh.

- [ ] **Step 12: Commit**

```bash
git add packages/crypto-keys tools/bench-keyprovider package.json pnpm-lock.yaml docs/STATE.md
git commit -m "feat(crypto-keys): tach entrypoint boc khoa va mo khoa

Hai entrypoint rieng: @trustprocure/crypto-keys chi boc, /unwrap chi mo.
Chi apps/unseal-worker duoc import entrypoint thu hai, cuong che boi
dependency-cruiser o tang T0 (ADR-006, bat bien G1).

MasterKeyRing giu nhieu phien ban master key: xoay khoa la them phien ban
moi va giu lai phien ban cu, nen bao gia niem phong truoc lan xoay van mo
duoc (bat bien G3). Bo phien ban cu di la mat vinh vien du lieu do.

Khoa moi to chuc dan xuat bang HKDF voi orgId lam salt, nen phong bi cua
to chuc A khong mo duoc bang ngu canh to chuc B (bat bien F3).

Them cong cu do hieu nang: RFQ 50 NCC x 200 hang muc la 10.000 lan mo khoa
— rui ro 8.4 cua spec, phai do o S0 thay vi phat hien o S1.6."
```

---

## Task 8: Danh tính và kiểm soát quyền theo vai trò

**Bất biến liên quan:** **D1** (mở thầu cần quyền hợp lệ), **D3** (phân tách nhiệm vụ), **D5** (từ chối vì thiếu quyền cũng phải audit).

**Files:**
- Create: `db/migrations/005_identity.sql`
- Create: `packages/identity/package.json`, `packages/identity/src/index.ts`, `packages/identity/src/permissions.ts`, `packages/identity/src/rbac.ts`
- Create: `packages/identity/src/rbac.int.test.ts`

**Interfaces:**
- Consumes: `withTenant` (Task 4), `appendAuditEvent` (Task 6), bảng `users` (Task 4).
- Produces:
  - `PERMISSIONS` — hằng số chỉ đọc chứa toàn bộ mã quyền.
  - `hasPermission(client: pg.PoolClient, args: { userId: string; orgId: string; permission: string }): Promise<boolean>`
  - `requirePermission(client, args & { resourceType: string; resourceId?: string | null; requestId?: string | null }): Promise<void>` — ném `PermissionDeniedError` và **ghi audit** khi bị từ chối.
  - `PermissionDeniedError`
  - Bảng `roles`, `permissions`, `role_permissions`, `user_roles`; sáu vai trò mẫu theo ma trận mục 25 của đặc tả.

- [ ] **Step 1: Viết test thất bại cho RBAC**

```ts
// packages/identity/src/rbac.int.test.ts
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { PERMISSIONS, PermissionDeniedError, hasPermission, requirePermission } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let orgId: string;
const userIds = new Map<string, string>();

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  apiPool = db.poolAs("app_api");

  const { rows: orgs } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'a') RETURNING id",
  );
  orgId = orgs[0]!.id;

  for (const role of ["BUYER", "PROCUREMENT_MANAGER", "DIRECTOR", "TECHNICAL"]) {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3) RETURNING id",
      [orgId, `${role.toLowerCase()}@example.com`, role],
    );
    const userId = rows[0]!.id;
    userIds.set(role, userId);
    await db.pool.query(
      `INSERT INTO user_roles (org_id, user_id, role_id)
       SELECT $1, $2, r.id FROM roles r WHERE r.org_id = $1 AND r.code = $3`,
      [orgId, userId, role],
    );
  }
});

afterAll(async () => {
  await db?.stop();
});

function uid(role: string): string {
  const id = userIds.get(role);
  if (!id) throw new Error(`Chưa seed vai trò ${role}`);
  return id;
}

describe("kiểm soát quyền theo vai trò", () => {
  it("[INV-D1] Procurement Manager có quyền mở thầu", async () => {
    const ok = await withTenant(apiPool, orgId, (c) =>
      hasPermission(c, { userId: uid("PROCUREMENT_MANAGER"), orgId, permission: PERMISSIONS.RFQ_UNSEAL }),
    );
    expect(ok).toBe(true);
  });

  it("[INV-D1] Buyer KHÔNG có quyền mở thầu", async () => {
    const ok = await withTenant(apiPool, orgId, (c) =>
      hasPermission(c, { userId: uid("BUYER"), orgId, permission: PERMISSIONS.RFQ_UNSEAL }),
    );
    expect(ok).toBe(false);
  });

  it("[INV-D3] Technical chỉ đánh giá, không tạo RFQ và không trao thầu", async () => {
    await withTenant(apiPool, orgId, async (c) => {
      const userId = uid("TECHNICAL");
      expect(await hasPermission(c, { userId, orgId, permission: PERMISSIONS.EVALUATION_PERFORM })).toBe(true);
      expect(await hasPermission(c, { userId, orgId, permission: PERMISSIONS.RFQ_CREATE })).toBe(false);
      expect(await hasPermission(c, { userId, orgId, permission: PERMISSIONS.AWARD_RECOMMEND })).toBe(false);
    });
  });

  it("[INV-D3] chỉ Director và Finance được duyệt đơn mua hàng", async () => {
    await withTenant(apiPool, orgId, async (c) => {
      expect(await hasPermission(c, { userId: uid("DIRECTOR"), orgId, permission: PERMISSIONS.PO_APPROVE })).toBe(true);
      expect(await hasPermission(c, { userId: uid("PROCUREMENT_MANAGER"), orgId, permission: PERMISSIONS.PO_APPROVE })).toBe(false);
      expect(await hasPermission(c, { userId: uid("BUYER"), orgId, permission: PERMISSIONS.PO_APPROVE })).toBe(false);
    });
  });

  it("requirePermission cho qua khi đủ quyền", async () => {
    await expect(
      withTenant(apiPool, orgId, (c) =>
        requirePermission(c, {
          userId: uid("DIRECTOR"),
          orgId,
          permission: PERMISSIONS.RFQ_UNSEAL,
          resourceType: "RFQ",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("[INV-D5] từ chối vì thiếu quyền vẫn sinh bản ghi kiểm toán", async () => {
    await expect(
      withTenant(apiPool, orgId, (c) =>
        requirePermission(c, {
          userId: uid("BUYER"),
          orgId,
          permission: PERMISSIONS.RFQ_UNSEAL,
          resourceType: "RFQ",
        }),
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const { rows } = await db.pool.query<{ action: string; payload: { permission: string } }>(
      `SELECT action, payload FROM audit_events
        WHERE org_id = $1 AND action = 'PERMISSION_DENIED' ORDER BY seq DESC LIMIT 1`,
      [orgId],
    );
    expect(rows[0]?.action).toBe("PERMISSION_DENIED");
    expect(rows[0]?.payload.permission).toBe(PERMISSIONS.RFQ_UNSEAL);
  });

  it("[INV-F1] người dùng của tổ chức khác không có quyền nào ở tổ chức này", async () => {
    const { rows: orgs } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Cong ty B', 'b') RETURNING id",
    );
    const orgB = orgs[0]!.id;

    const ok = await withTenant(apiPool, orgB, (c) =>
      hasPermission(c, { userId: uid("DIRECTOR"), orgId: orgB, permission: PERMISSIONS.RFQ_UNSEAL }),
    );
    expect(ok).toBe(false);
  });

  it("[INV-D1] người dùng bị đình chỉ mất toàn bộ quyền", async () => {
    const userId = uid("DIRECTOR");
    await db.pool.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userId]);
    try {
      const ok = await withTenant(apiPool, orgId, (c) =>
        hasPermission(c, { userId, orgId, permission: PERMISSIONS.RFQ_UNSEAL }),
      );
      expect(ok).toBe(false);
    } finally {
      await db.pool.query("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [userId]);
    }
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run packages/identity/src/rbac.int.test.ts`
Kỳ vọng: FAIL — bảng `roles` chưa tồn tại.

- [ ] **Step 3: Viết migration 005**

```sql
-- db/migrations/005_identity.sql
-- Vai trò và quyền. Ma trận vai trò lấy từ mục 25 của đặc tả (bất biến D3).
--
-- Vai trò được tạo theo từng tổ chức chứ không dùng chung toàn hệ thống, vì mục 21
-- và 25 nói rõ mỗi doanh nghiệp tự cấu hình. Sáu vai trò dưới đây chỉ là bộ mặc định
-- khi tạo tổ chức mới, không phải danh sách cố định.

CREATE TABLE permissions (
  code        text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  code        text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE role_permissions (
  org_id          uuid NOT NULL REFERENCES organizations(id),
  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE user_roles (
  org_id      uuid NOT NULL REFERENCES organizations(id),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_org_user_idx ON user_roles (org_id, user_id);

INSERT INTO permissions (code, description) VALUES
  ('rfq.create',          'Tạo và sửa gói RFQ ở trạng thái nháp'),
  ('rfq.approve',         'Phê duyệt RFQ để mở cho nhà cung cấp báo giá'),
  ('rfq.invite',          'Chọn và mời nhà cung cấp'),
  ('rfq.unseal',          'Yêu cầu và thực hiện mở thầu'),
  ('rfq.unseal.approve',  'Phê duyệt yêu cầu mở thầu của người khác'),
  ('bid.view',            'Xem báo giá sau khi đã mở thầu'),
  ('evaluation.perform',  'Chấm điểm kỹ thuật và thương mại'),
  ('award.recommend',     'Lập đề xuất trao thầu'),
  ('po.approve',          'Phê duyệt đơn mua hàng'),
  ('supplier.manage',     'Quản lý hồ sơ nhà cung cấp'),
  ('audit.read',          'Đọc và xuất sổ kiểm toán');

-- Bộ vai trò mặc định cho mọi tổ chức đã tồn tại và các tổ chức tạo sau.
CREATE OR REPLACE FUNCTION seed_default_roles(p_org_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_role record;
BEGIN
  FOR v_role IN
    SELECT * FROM (VALUES
      ('REQUESTER',           'Người đề nghị mua',    ARRAY['rfq.create', 'evaluation.perform']),
      ('BUYER',               'Nhân viên mua hàng',   ARRAY['rfq.create', 'rfq.invite', 'evaluation.perform', 'award.recommend']),
      ('TECHNICAL',           'Bộ phận kỹ thuật',     ARRAY['evaluation.perform']),
      ('PROCUREMENT_MANAGER', 'Trưởng phòng mua hàng', ARRAY['rfq.create', 'rfq.invite', 'rfq.approve', 'rfq.unseal', 'bid.view', 'evaluation.perform', 'award.recommend', 'supplier.manage']),
      ('FINANCE',             'Tài chính',            ARRAY['bid.view', 'evaluation.perform', 'award.recommend', 'po.approve', 'audit.read']),
      ('DIRECTOR',            'Ban giám đốc',         ARRAY['rfq.unseal', 'rfq.unseal.approve', 'bid.view', 'award.recommend', 'po.approve', 'audit.read'])
    ) AS t(code, name, perms)
  LOOP
    INSERT INTO roles (org_id, code, name) VALUES (p_org_id, v_role.code, v_role.name)
    ON CONFLICT (org_id, code) DO NOTHING;

    INSERT INTO role_permissions (org_id, role_id, permission_code)
    SELECT p_org_id, r.id, unnest(v_role.perms)
      FROM roles r WHERE r.org_id = p_org_id AND r.code = v_role.code
    ON CONFLICT DO NOTHING;
  END LOOP;
END
$$;

-- Tổ chức mới tự động nhận bộ vai trò mặc định.
CREATE OR REPLACE FUNCTION organizations_seed_roles() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_default_roles(NEW.id);
  RETURN NEW;
END
$$;

CREATE TRIGGER organizations_seed_roles_after_insert AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION organizations_seed_roles();

-- Áp cho các tổ chức đã tạo trước migration này.
DO $$
DECLARE v_org uuid;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM seed_default_roles(v_org);
  END LOOP;
END
$$;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_tenant_isolation ON roles
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_tenant_isolation ON role_permissions
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY user_roles_tenant_isolation ON user_roles
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());

GRANT SELECT ON permissions TO app_api, app_unseal;
GRANT SELECT, INSERT, UPDATE, DELETE ON roles, role_permissions, user_roles TO app_api;
GRANT SELECT ON roles, role_permissions, user_roles TO app_unseal;
```

> Trigger `organizations_seed_roles_after_insert` chạy dưới quyền người tạo tổ chức. Vì `roles` bật FORCE RLS với `WITH CHECK (org_id = app_current_org_id())`, việc tạo tổ chức phải diễn ra trong ngữ cảnh tenant tương ứng, hoặc bằng role chủ sở hữu như trong test. Ràng buộc này có chủ đích: tạo tổ chức là thao tác quản trị, không phải thao tác của người dùng thường.

- [ ] **Step 4: Viết package `identity`**

```json
// packages/identity/package.json
{
  "name": "@trustprocure/identity",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@trustprocure/audit": "workspace:*",
    "pg": "^8.13.0"
  }
}
```

```ts
// packages/identity/src/permissions.ts
/** Mã quyền dùng trong toàn hệ thống. Phải khớp với bảng `permissions` trong migration 005. */
export const PERMISSIONS = {
  RFQ_CREATE: "rfq.create",
  RFQ_APPROVE: "rfq.approve",
  RFQ_INVITE: "rfq.invite",
  RFQ_UNSEAL: "rfq.unseal",
  RFQ_UNSEAL_APPROVE: "rfq.unseal.approve",
  BID_VIEW: "bid.view",
  EVALUATION_PERFORM: "evaluation.perform",
  AWARD_RECOMMEND: "award.recommend",
  PO_APPROVE: "po.approve",
  SUPPLIER_MANAGE: "supplier.manage",
  AUDIT_READ: "audit.read",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
```

```ts
// packages/identity/src/rbac.ts
import type pg from "pg";
import { appendAuditEvent } from "@trustprocure/audit";
import type { Permission } from "./permissions.js";

export class PermissionDeniedError extends Error {
  constructor(
    readonly userId: string,
    readonly permission: string,
  ) {
    super(`Người dùng không có quyền "${permission}".`);
    this.name = "PermissionDeniedError";
  }
}

export interface PermissionCheck {
  readonly userId: string;
  readonly orgId: string;
  readonly permission: Permission;
}

/**
 * Người dùng bị đình chỉ hoặc vô hiệu hóa mất toàn bộ quyền ngay lập tức —
 * điều kiện `u.status = 'ACTIVE'` nằm trong chính truy vấn, không tách thành
 * một bước kiểm tra riêng có thể bị quên ở đường gọi khác.
 *
 * Truy vấn không tự lọc org_id: RLS đã ràng buộc điều đó ở tầng DB (bất biến F1).
 */
export async function hasPermission(
  client: pg.PoolClient,
  { userId, permission }: PermissionCheck,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `SELECT 1
       FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = $1
        AND rp.permission_code = $2
        AND u.status = 'ACTIVE'
      LIMIT 1`,
    [userId, permission],
  );
  return (rowCount ?? 0) > 0;
}

export interface PermissionRequirement extends PermissionCheck {
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly requestId?: string | null;
}

/**
 * Ném lỗi khi thiếu quyền, và ghi bản ghi kiểm toán trước khi ném.
 *
 * Ghi cả lần từ chối, không chỉ lần thành công (bất biến D5): một chuỗi nỗ lực
 * truy cập bị từ chối là tín hiệu điều tra quan trọng hơn nhiều so với một lần
 * truy cập hợp lệ, và nếu không ghi thì không ai biết nó từng xảy ra.
 */
export async function requirePermission(
  client: pg.PoolClient,
  requirement: PermissionRequirement,
): Promise<void> {
  if (await hasPermission(client, requirement)) return;

  await appendAuditEvent(client, requirement.orgId, {
    actorType: "USER",
    actorId: requirement.userId,
    action: "PERMISSION_DENIED",
    resourceType: requirement.resourceType,
    resourceId: requirement.resourceId ?? null,
    requestId: requirement.requestId ?? null,
    payload: { permission: requirement.permission },
  });

  throw new PermissionDeniedError(requirement.userId, requirement.permission);
}
```

```ts
// packages/identity/src/index.ts
export { PERMISSIONS, type Permission } from "./permissions.js";
export {
  PermissionDeniedError,
  hasPermission,
  requirePermission,
  type PermissionCheck,
  type PermissionRequirement,
} from "./rbac.js";
```

Chạy: `pnpm install`

- [ ] **Step 5: Chạy test để xác nhận đạt**

Chạy: `pnpm vitest run packages/identity/src/rbac.int.test.ts`
Kỳ vọng: PASS — 8 test.

- [ ] **Step 6: Chạy lại toàn bộ test integration**

Chạy: `pnpm test:int`
Kỳ vọng: PASS. Test phủ RLS giờ kiểm thêm `roles`, `role_permissions`, `user_roles`.

- [ ] **Step 7: Commit**

```bash
git add db packages/identity pnpm-lock.yaml
git commit -m "feat(identity): vai tro va kiem soat quyen theo ma tran muc 25

Vai tro tao theo tung to chuc chu khong dung chung toan he thong, vi dac ta
noi ro moi doanh nghiep tu cau hinh. Sau vai tro mac dinh chi la bo khoi tao.

Dieu kien u.status = 'ACTIVE' nam trong chinh truy van kiem quyen, khong tach
thanh mot buoc rieng co the bi quen o duong goi khac — nguoi dung bi dinh chi
mat toan bo quyen ngay lap tuc.

requirePermission ghi audit truoc khi nem loi (bat bien D5): mot chuoi no luc
truy cap bi tu choi la tin hieu dieu tra quan trong hon nhieu so voi mot lan
truy cap hop le, va neu khong ghi thi khong ai biet no tung xay ra."
```

---

## Task 9: Phiên đăng nhập và xác thực hai lớp TOTP

**Bất biến liên quan:** **D1** (mở thầu cần MFA còn hiệu lực trong cửa sổ ngắn), **E3** (giới hạn số lần thử, dùng một lần, so sánh chống tấn công thời gian).

**Files:**
- Create: `db/migrations/006_sessions_and_mfa.sql`
- Create: `packages/identity/src/totp.ts`, `packages/identity/src/mfa.ts`
- Modify: `packages/identity/src/index.ts`
- Create: `packages/identity/src/totp.test.ts`, `packages/identity/src/mfa.int.test.ts`

**Interfaces:**
- Consumes: bảng `users` (Task 4), `appendAuditEvent` (Task 6).
- Produces:
  - `generateTotpSecret(): Buffer` (20 byte)
  - `counterForTime(epochMs: number): number`
  - `deriveTotpCode(secret: Buffer, counter: number): string` — 6 chữ số
  - `verifyTotpCode(secret: Buffer, code: string, options?: TotpVerifyOptions): TotpResult`
  - `TotpResult = { ok: true; counter: number } | { ok: false; reason: "SAI_DINH_DANG" | "SAI_MA" | "DA_DUNG" }`
  - `assertFreshMfa(client, { userId, orgId, maxAgeSeconds }): Promise<void>` — ném `MfaRequiredError` nếu lần xác thực gần nhất quá cũ.
  - Bảng `sessions`, `mfa_credentials`.

- [ ] **Step 1: Viết test thất bại cho TOTP bằng vector chuẩn RFC 6238**

Dùng vector chính thức của RFC 6238 làm phép thử biết-trước-đáp-án. Nếu cài đặt sai một chi tiết nào — thứ tự byte của bộ đếm, phép cắt động, mặt nạ bit — vector sẽ không khớp.

```ts
// packages/identity/src/totp.test.ts
import { describe, expect, it } from "vitest";
import { counterForTime, deriveTotpCode, generateTotpSecret, verifyTotpCode } from "./totp.js";

// RFC 6238 Appendix B: khóa SHA-1 là chuỗi ASCII "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

// Cột TOTP của RFC là 8 chữ số; bản 6 chữ số là 6 ký tự cuối.
const RFC_VECTORS: ReadonlyArray<{ seconds: number; expected: string }> = [
  { seconds: 59, expected: "287082" },
  { seconds: 1111111109, expected: "081804" },
  { seconds: 1111111111, expected: "050471" },
  { seconds: 1234567890, expected: "005924" },
  { seconds: 2000000000, expected: "279037" },
  { seconds: 20000000000, expected: "353130" },
];

describe("TOTP", () => {
  it.each(RFC_VECTORS)("khớp vector RFC 6238 tại T=$seconds", ({ seconds, expected }) => {
    expect(deriveTotpCode(RFC_SECRET, counterForTime(seconds * 1000))).toBe(expected);
  });

  it("sinh bí mật dài 20 byte và khác nhau mỗi lần", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a.length).toBe(20);
    expect(a.equals(b)).toBe(false);
  });

  it("[INV-E3] chấp nhận mã đúng ở bước hiện tại", () => {
    const now = 1_700_000_000_000;
    const code = deriveTotpCode(RFC_SECRET, counterForTime(now));
    expect(verifyTotpCode(RFC_SECRET, code, { now })).toEqual({
      ok: true,
      counter: counterForTime(now),
    });
  });

  it("[INV-E3] chấp nhận lệch một bước để bù trễ mạng, từ chối lệch hai bước", () => {
    const now = 1_700_000_000_000;
    const counter = counterForTime(now);

    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter - 1), { now }).ok).toBe(true);
    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter + 1), { now }).ok).toBe(true);
    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter - 2), { now }).ok).toBe(false);
    expect(verifyTotpCode(RFC_SECRET, deriveTotpCode(RFC_SECRET, counter + 2), { now }).ok).toBe(false);
  });

  it("[INV-E3] mã đã dùng không dùng lại được", () => {
    const now = 1_700_000_000_000;
    const counter = counterForTime(now);
    const code = deriveTotpCode(RFC_SECRET, counter);

    expect(verifyTotpCode(RFC_SECRET, code, { now }).ok).toBe(true);
    expect(verifyTotpCode(RFC_SECRET, code, { now, lastUsedCounter: counter })).toEqual({
      ok: false,
      reason: "DA_DUNG",
    });
  });

  it("[INV-E3] từ chối mã sai định dạng mà không rò rỉ thông tin khác", () => {
    const now = 1_700_000_000_000;
    for (const xau of ["", "12345", "1234567", "abcdef", "12 34 56", "١٢٣٤٥٦"]) {
      expect(verifyTotpCode(RFC_SECRET, xau, { now })).toEqual({
        ok: false,
        reason: "SAI_DINH_DANG",
      });
    }
  });

  it("[INV-E3] mã sai bị từ chối", () => {
    const now = 1_700_000_000_000;
    const dung = deriveTotpCode(RFC_SECRET, counterForTime(now));
    const sai = dung === "000000" ? "111111" : "000000";
    expect(verifyTotpCode(RFC_SECRET, sai, { now })).toEqual({ ok: false, reason: "SAI_MA" });
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run packages/identity/src/totp.test.ts`
Kỳ vọng: FAIL — không tìm thấy `./totp.js`.

- [ ] **Step 3: Viết TOTP**

```ts
// packages/identity/src/totp.ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
const DEFAULT_WINDOW = 1;
const CODE_PATTERN = /^[0-9]{6}$/;

export interface TotpVerifyOptions {
  /** Thời điểm tính theo mili-giây epoch. Cho phép truyền vào để test tất định. */
  readonly now?: number;
  /** Số bước 30 giây được chấp nhận lệch về mỗi phía. Mặc định 1. */
  readonly window?: number;
  /** Bộ đếm của lần xác thực thành công gần nhất — nền tảng chống dùng lại mã. */
  readonly lastUsedCounter?: number | null;
}

export type TotpResult =
  | { readonly ok: true; readonly counter: number }
  | { readonly ok: false; readonly reason: "SAI_DINH_DANG" | "SAI_MA" | "DA_DUNG" };

export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

export function counterForTime(epochMs: number): number {
  return Math.floor(epochMs / 1000 / STEP_SECONDS);
}

/** HOTP theo RFC 4226 với phép cắt động, dùng làm nền cho TOTP theo RFC 6238. */
export function deriveTotpCode(secret: Buffer, counter: number): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", secret).update(counterBytes).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Kiểm tra mã TOTP.
 *
 * So sánh bằng timingSafeEqual: so sánh chuỗi thông thường thoát sớm ở ký tự đầu
 * khác nhau, và độ chênh thời gian đó đủ để dò từng chữ số một khi kẻ tấn công
 * gửi đủ nhiều yêu cầu (bất biến E3).
 *
 * Duyệt HẾT cửa sổ trượt thay vì dừng ngay khi khớp, để thời gian chạy không
 * phụ thuộc vào vị trí bước khớp.
 */
export function verifyTotpCode(
  secret: Buffer,
  code: string,
  options: TotpVerifyOptions = {},
): TotpResult {
  if (!CODE_PATTERN.test(code)) return { ok: false, reason: "SAI_DINH_DANG" };

  const now = options.now ?? Date.now();
  const window = options.window ?? DEFAULT_WINDOW;
  const current = counterForTime(now);
  const provided = Buffer.from(code, "ascii");

  let matched: number | null = null;
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + offset;
    const expected = Buffer.from(deriveTotpCode(secret, counter), "ascii");
    if (timingSafeEqual(expected, provided) && matched === null) {
      matched = counter;
    }
  }

  if (matched === null) return { ok: false, reason: "SAI_MA" };

  const lastUsed = options.lastUsedCounter;
  if (typeof lastUsed === "number" && matched <= lastUsed) {
    return { ok: false, reason: "DA_DUNG" };
  }

  return { ok: true, counter: matched };
}
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Chạy: `pnpm vitest run packages/identity/src/totp.test.ts`
Kỳ vọng: PASS — 12 test, gồm 6 vector RFC 6238.

Nếu vector RFC không khớp: kiểm tra `writeBigUInt64BE` (bộ đếm phải là big-endian 8 byte) và mặt nạ `0x7f` ở byte đầu của phép cắt động.

- [ ] **Step 5: Viết migration 006**

```sql
-- db/migrations/006_sessions_and_mfa.sql
-- Phiên đăng nhập và xác thực hai lớp.
--
-- mfa_credentials.last_used_counter chặn dùng lại mã: mỗi mã TOTP chỉ có giá trị
-- một lần, kể cả trong 30 giây nó còn hiệu lực (bất biến E3).
--
-- sessions.mfa_verified_at là mốc để kiểm "MFA còn hiệu lực trong cửa sổ ngắn"
-- ở bất biến D1 — mở thầu đòi hỏi vừa xác thực lại, không chỉ đăng nhập từ sáng.

CREATE TABLE sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash       bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  mfa_verified_at  timestamptz,
  revoked_at       timestamptz,
  ip               inet,
  user_agent       text,
  CHECK (expires_at > created_at)
);

CREATE INDEX sessions_org_user_idx ON sessions (org_id, user_id);

CREATE TABLE mfa_credentials (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind               text NOT NULL DEFAULT 'TOTP' CHECK (kind IN ('TOTP')),
  secret_wrapped     bytea NOT NULL,
  secret_key_version text NOT NULL,
  last_used_counter  bigint,
  failed_attempts    integer NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  confirmed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind)
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_tenant_isolation ON sessions
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());

ALTER TABLE mfa_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY mfa_credentials_tenant_isolation ON mfa_credentials
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());

GRANT SELECT, INSERT, UPDATE ON sessions TO app_api;
GRANT SELECT ON sessions TO app_unseal;
GRANT SELECT, INSERT, UPDATE ON mfa_credentials TO app_api;
-- app_unseal KHÔNG được đọc bí mật TOTP: nó chỉ cần biết phiên đã xác thực lúc nào,
-- và thông tin đó nằm ở sessions.mfa_verified_at.
```

> Bí mật TOTP được lưu dưới dạng đã bọc bằng `KeyWrapper` (Task 7), không lưu dạng rõ. Cột `secret_key_version` cho phép xoay master key mà không mất khả năng đọc bí mật cũ (bất biến G3).

- [ ] **Step 6: Viết kiểm tra độ tươi của MFA**

```ts
// packages/identity/src/mfa.ts
import type pg from "pg";

export class MfaRequiredError extends Error {
  constructor(readonly maxAgeSeconds: number) {
    super(
      `Thao tác này yêu cầu xác thực hai lớp trong vòng ${maxAgeSeconds} giây gần đây. ` +
        "Vui lòng xác thực lại.",
    );
    this.name = "MfaRequiredError";
  }
}

export interface MfaFreshnessCheck {
  readonly sessionId: string;
  readonly maxAgeSeconds: number;
}

/**
 * Ném lỗi nếu phiên chưa xác thực hai lớp, hoặc đã xác thực nhưng quá cũ.
 *
 * Bất biến D1 đòi hỏi MFA "còn hiệu lực trong cửa sổ ngắn" chứ không phải chỉ cần
 * đã đăng nhập. Mở thầu là hành động không thể hoàn tác — người thực hiện phải
 * chứng minh mình đang ngồi trước máy tại thời điểm đó, chứ không phải đã đăng nhập
 * từ sáng và bỏ máy mở.
 *
 * Độ tươi được tính bằng đồng hồ của cơ sở dữ liệu, không phải đồng hồ máy chủ ứng dụng.
 */
export async function assertFreshMfa(
  client: pg.PoolClient,
  { sessionId, maxAgeSeconds }: MfaFreshnessCheck,
): Promise<void> {
  const { rows } = await client.query<{ tuoi: boolean }>(
    `SELECT (s.mfa_verified_at IS NOT NULL
             AND s.revoked_at IS NULL
             AND s.expires_at > now()
             AND s.mfa_verified_at > now() - make_interval(secs => $2::double precision)) AS tuoi
       FROM sessions s
      WHERE s.id = $1`,
    [sessionId, maxAgeSeconds],
  );

  if (rows[0]?.tuoi !== true) {
    throw new MfaRequiredError(maxAgeSeconds);
  }
}
```

```ts
// packages/identity/src/index.ts
export { PERMISSIONS, type Permission } from "./permissions.js";
export {
  PermissionDeniedError,
  hasPermission,
  requirePermission,
  type PermissionCheck,
  type PermissionRequirement,
} from "./rbac.js";
export {
  counterForTime,
  deriveTotpCode,
  generateTotpSecret,
  verifyTotpCode,
  type TotpResult,
  type TotpVerifyOptions,
} from "./totp.js";
export { MfaRequiredError, assertFreshMfa, type MfaFreshnessCheck } from "./mfa.js";
```

- [ ] **Step 7: Viết test integration cho độ tươi MFA**

```ts
// packages/identity/src/mfa.int.test.ts
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { MfaRequiredError, assertFreshMfa } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let orgId: string;
let userId: string;

async function taoPhien(mfaVerifiedAt: string | null): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    `INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at)
     VALUES ($1, $2, $3, now() + interval '8 hours', $4::timestamptz)
     RETURNING id`,
    [orgId, userId, randomBytes(32), mfaVerifiedAt],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  apiPool = db.poolAs("app_api");

  const { rows: orgs } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'a') RETURNING id",
  );
  orgId = orgs[0]!.id;
  const { rows: users } = await db.pool.query<{ id: string }>(
    "INSERT INTO users (org_id, email, full_name) VALUES ($1, 'gd@example.com', 'Giam doc') RETURNING id",
    [orgId],
  );
  userId = users[0]!.id;
});

afterAll(async () => {
  await db?.stop();
});

describe("độ tươi của xác thực hai lớp", () => {
  it("[INV-D1] chấp nhận phiên vừa xác thực", async () => {
    const sessionId = await taoPhien("now()");
    await expect(
      withTenant(apiPool, orgId, (c) => assertFreshMfa(c, { sessionId, maxAgeSeconds: 300 })),
    ).resolves.toBeUndefined();
  });

  it("[INV-D1] từ chối phiên chưa từng xác thực hai lớp", async () => {
    const sessionId = await taoPhien(null);
    await expect(
      withTenant(apiPool, orgId, (c) => assertFreshMfa(c, { sessionId, maxAgeSeconds: 300 })),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it("[INV-D1] từ chối phiên đã xác thực nhưng quá cũ", async () => {
    const sessionId = await taoPhien("now() - interval '20 minutes'");
    await expect(
      withTenant(apiPool, orgId, (c) => assertFreshMfa(c, { sessionId, maxAgeSeconds: 300 })),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it("[INV-D1] từ chối phiên đã bị thu hồi dù vừa xác thực", async () => {
    const sessionId = await taoPhien("now()");
    await db.pool.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [sessionId]);
    await expect(
      withTenant(apiPool, orgId, (c) => assertFreshMfa(c, { sessionId, maxAgeSeconds: 300 })),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });

  it("[INV-F1] phiên không tồn tại trong ngữ cảnh tổ chức khác thì bị từ chối", async () => {
    const sessionId = await taoPhien("now()");
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Cong ty B', 'b') RETURNING id",
    );
    await expect(
      withTenant(apiPool, rows[0]!.id, (c) => assertFreshMfa(c, { sessionId, maxAgeSeconds: 300 })),
    ).rejects.toBeInstanceOf(MfaRequiredError);
  });
});
```

- [ ] **Step 8: Chạy test và commit**

Chạy: `pnpm test:int && pnpm test`
Kỳ vọng: tất cả PASS.

```bash
git add db packages/identity
git commit -m "feat(identity): phien dang nhap va xac thuc hai lop TOTP

TOTP theo RFC 6238, kiem chung bang sau vector chuan cua RFC — neu cai dat
sai thu tu byte bo dem, phep cat dong hay mat na bit thi vector khong khop.

So sanh ma bang timingSafeEqual va duyet HET cua so truot thay vi dung ngay
khi khop, de thoi gian chay khong phu thuoc vi tri buoc khop. So sanh chuoi
thong thuong thoat som o ky tu dau khac nhau, va do chenh do du de do tung
chu so mot (bat bien E3).

last_used_counter chan dung lai ma: moi ma chi co gia tri mot lan ke ca trong
30 giay no con hieu luc.

assertFreshMfa dung dong ho cua co so du lieu: mo thau doi hoi vua xac thuc
lai, khong phai chi can da dang nhap tu sang (bat bien D1)."
```

---

## Task 10: Transactional outbox và job runner

**Bất biến liên quan:** **C2** (tính đúng đắn không phụ thuộc scheduler), **D4** (break-glass sinh cảnh báo tức thì), **B3** (job ghi mốc neo chuỗi kiểm toán).

> Outbox tồn tại vì một lý do cụ thể trong sản phẩm này: khi RFQ đóng thầu hoặc khi có yêu cầu mở thầu khẩn cấp, hệ thống phải gửi thông báo. Nếu gửi thông báo trực tiếp trong transaction nghiệp vụ thì hoặc transaction bị treo theo mạng, hoặc thông báo gửi rồi mà transaction rollback. Ghi ý định vào cùng transaction rồi giao sau là cách duy nhất giữ hai việc nhất quán.
>
> Quan trọng không kém: outbox **không bao giờ** là nơi đặt logic quyết định. Việc chặn nộp báo giá sau deadline nằm ở ràng buộc trong transaction (ADR-005), không nằm ở job. Job chỉ làm những việc mà chạy trễ thì phiền, chứ không sai.

**Files:**
- Create: `db/migrations/007_outbox.sql`
- Create: `packages/outbox/package.json`, `packages/outbox/src/index.ts`, `packages/outbox/src/enqueue.ts`, `packages/outbox/src/runner.ts`
- Create: `packages/outbox/src/outbox.int.test.ts`

**Interfaces:**
- Consumes: `withTenant` (Task 4), `recordChainAnchor` (Task 6).
- Produces:
  - `enqueueJob(client: pg.PoolClient, orgId: string, job: JobInput): Promise<string>` với `JobInput = { kind: string; payload?: Record<string, unknown>; dedupeKey?: string | null; runAfter?: Date | null }`
  - `JobRunner` — `new JobRunner(pool, handlers, options?)`, `runOnce(): Promise<number>` trả về số job đã xử lý, `start()`, `stop()`
  - `JobHandler = (job: OutboxJob, client: pg.PoolClient) => Promise<void>`
  - `OutboxJob = { id: string; orgId: string; kind: string; payload: Record<string, unknown>; attempts: number }`

- [ ] **Step 1: Viết test thất bại cho outbox**

```ts
// packages/outbox/src/outbox.int.test.ts
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { migrate } from "@trustprocure/db";
import { withTenant } from "@trustprocure/tenancy";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { JobRunner, enqueueJob, type OutboxJob } from "./index.js";

const MIGRATIONS = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;
let apiPool: pg.Pool;
let orgId: string;

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS);
  apiPool = db.poolAs("app_api");
  const { rows } = await db.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Cong ty A', 'a') RETURNING id",
  );
  orgId = rows[0]!.id;
});

afterAll(async () => {
  await db?.stop();
});

describe("transactional outbox", () => {
  it("job được ghi trong cùng transaction với nghiệp vụ", async () => {
    await withTenant(apiPool, orgId, async (client) => {
      await client.query("INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $3)", [
        orgId,
        "cung-transaction@example.com",
        "Nguoi dung",
      ]);
      await enqueueJob(client, orgId, { kind: "GUI_THONG_BAO", payload: { toi: "nguoi-dung" } });
    });

    const { rowCount } = await db.pool.query(
      "SELECT 1 FROM outbox_jobs WHERE org_id = $1 AND kind = 'GUI_THONG_BAO'",
      [orgId],
    );
    expect(rowCount).toBe(1);
  });

  it("rollback nghiệp vụ thì job cũng biến mất", async () => {
    await expect(
      withTenant(apiPool, orgId, async (client) => {
        await enqueueJob(client, orgId, { kind: "KHONG_BAO_GIO_CHAY" });
        throw new Error("loi co y");
      }),
    ).rejects.toThrow("loi co y");

    const { rowCount } = await db.pool.query(
      "SELECT 1 FROM outbox_jobs WHERE kind = 'KHONG_BAO_GIO_CHAY'",
    );
    expect(rowCount).toBe(0);
  });

  it("dedupeKey ngăn tạo trùng job", async () => {
    await withTenant(apiPool, orgId, async (client) => {
      await enqueueJob(client, orgId, { kind: "NEO_CHUOI", dedupeKey: "neo-ngay-2026-08-27" });
      await enqueueJob(client, orgId, { kind: "NEO_CHUOI", dedupeKey: "neo-ngay-2026-08-27" });
    });

    const { rowCount } = await db.pool.query(
      "SELECT 1 FROM outbox_jobs WHERE org_id = $1 AND kind = 'NEO_CHUOI'",
      [orgId],
    );
    expect(rowCount).toBe(1);
  });

  it("runner xử lý job và đánh dấu hoàn thành", async () => {
    const daXuLy: OutboxJob[] = [];
    await withTenant(apiPool, orgId, (client) =>
      enqueueJob(client, orgId, { kind: "VIEC_A", payload: { so: 7 } }),
    );

    const runner = new JobRunner(db.pool, {
      VIEC_A: async (job) => {
        daXuLy.push(job);
      },
    });

    expect(await runner.runOnce()).toBe(1);
    expect(daXuLy[0]?.payload).toEqual({ so: 7 });

    const { rows } = await db.pool.query<{ status: string }>(
      "SELECT status FROM outbox_jobs WHERE kind = 'VIEC_A'",
    );
    expect(rows[0]?.status).toBe("DONE");
  });

  it("job lỗi được thử lại và cuối cùng chuyển sang FAILED", async () => {
    await withTenant(apiPool, orgId, (client) =>
      enqueueJob(client, orgId, { kind: "LUON_LOI" }),
    );

    const runner = new JobRunner(
      db.pool,
      {
        LUON_LOI: () => Promise.reject(new Error("that bai co y")),
      },
      { maxAttempts: 3, retryDelaySeconds: 0 },
    );

    for (let i = 0; i < 3; i += 1) await runner.runOnce();

    const { rows } = await db.pool.query<{ status: string; attempts: number; last_error: string }>(
      "SELECT status, attempts, last_error FROM outbox_jobs WHERE kind = 'LUON_LOI'",
    );
    expect(rows[0]?.status).toBe("FAILED");
    expect(rows[0]?.attempts).toBe(3);
    expect(rows[0]?.last_error).toContain("that bai co y");
  });

  it("job chưa tới hạn runAfter thì chưa được lấy", async () => {
    await withTenant(apiPool, orgId, (client) =>
      enqueueJob(client, orgId, {
        kind: "CHUA_TOI_HAN",
        runAfter: new Date(Date.now() + 3_600_000),
      }),
    );

    const runner = new JobRunner(db.pool, { CHUA_TOI_HAN: () => Promise.resolve() });
    expect(await runner.runOnce()).toBe(0);
  });

  it("hai runner chạy song song không xử lý trùng một job", async () => {
    const kind = "KHONG_TRUNG";
    await withTenant(apiPool, orgId, async (client) => {
      for (let i = 0; i < 12; i += 1) {
        await enqueueJob(client, orgId, { kind, payload: { i } });
      }
    });

    let soLanXuLy = 0;
    const handler = { [kind]: () => { soLanXuLy += 1; return Promise.resolve(); } };
    const a = new JobRunner(db.pool, handler, { batchSize: 12 });
    const b = new JobRunner(db.pool, handler, { batchSize: 12 });

    const [x, y] = await Promise.all([a.runOnce(), b.runOnce()]);
    expect(x + y).toBe(12);
    expect(soLanXuLy).toBe(12);
  });

  it("[INV-C2] job không phải cơ chế quyết định — kind lạ chuyển sang FAILED chứ không treo", async () => {
    await withTenant(apiPool, orgId, (client) =>
      enqueueJob(client, orgId, { kind: "KHONG_CO_HANDLER" }),
    );

    const runner = new JobRunner(db.pool, {}, { maxAttempts: 1 });
    await runner.runOnce();

    const { rows } = await db.pool.query<{ status: string }>(
      "SELECT status FROM outbox_jobs WHERE kind = 'KHONG_CO_HANDLER'",
    );
    expect(rows[0]?.status).toBe("FAILED");
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run packages/outbox/src/outbox.int.test.ts`
Kỳ vọng: FAIL — bảng `outbox_jobs` chưa tồn tại.

- [ ] **Step 3: Viết migration 007**

```sql
-- db/migrations/007_outbox.sql
-- Transactional outbox: ghi ý định vào cùng transaction nghiệp vụ, giao sau.
--
-- Gửi thông báo trực tiếp trong transaction nghiệp vụ dẫn tới một trong hai hỏng hóc:
-- transaction bị treo theo độ trễ mạng, hoặc thông báo đã gửi mà transaction rollback.
--
-- Outbox KHÔNG BAO GIỜ là nơi đặt logic quyết định. Việc chặn nộp báo giá sau deadline
-- nằm ở ràng buộc trong transaction (ADR-005, bất biến C2), không nằm ở job. Job chỉ làm
-- những việc mà chạy trễ thì phiền, chứ không sai.

CREATE TABLE outbox_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  kind        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key  text,
  status      text NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  run_after   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Chống trùng theo khóa nghiệp vụ, chỉ áp cho job chưa kết thúc.
CREATE UNIQUE INDEX outbox_jobs_dedupe_idx
  ON outbox_jobs (org_id, kind, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX outbox_jobs_claim_idx
  ON outbox_jobs (status, run_after)
  WHERE status = 'PENDING';

ALTER TABLE outbox_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_jobs_tenant_isolation ON outbox_jobs
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());

GRANT SELECT, INSERT, UPDATE ON outbox_jobs TO app_api;
GRANT SELECT, INSERT, UPDATE ON outbox_jobs TO app_unseal;
```

- [ ] **Step 4: Viết `enqueueJob`**

```json
// packages/outbox/package.json
{
  "name": "@trustprocure/outbox",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@trustprocure/tenancy": "workspace:*",
    "pg": "^8.13.0"
  }
}
```

```ts
// packages/outbox/src/enqueue.ts
import type pg from "pg";

export interface JobInput {
  readonly kind: string;
  readonly payload?: Record<string, unknown>;
  /** Khóa chống trùng theo nghiệp vụ. Job cùng (org, kind, dedupeKey) chỉ tồn tại một bản. */
  readonly dedupeKey?: string | null;
  /** Sớm nhất được phép chạy. Mặc định là ngay. */
  readonly runAfter?: Date | null;
}

/**
 * Ghi job vào outbox. PHẢI gọi bằng `client` của chính transaction nghiệp vụ,
 * không phải một kết nối khác — đó là toàn bộ điểm của mẫu transactional outbox.
 *
 * Trả về id của job, hoặc id của job trùng đã tồn tại khi có dedupeKey.
 */
export async function enqueueJob(
  client: pg.PoolClient,
  orgId: string,
  job: JobInput,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO outbox_jobs (org_id, kind, payload, dedupe_key, run_after)
     VALUES ($1, $2, $3, $4, coalesce($5::timestamptz, now()))
     ON CONFLICT (org_id, kind, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [orgId, job.kind, JSON.stringify(job.payload ?? {}), job.dedupeKey ?? null, job.runAfter ?? null],
  );

  const created = rows[0];
  if (created) return created.id;

  const { rows: existing } = await client.query<{ id: string }>(
    "SELECT id FROM outbox_jobs WHERE org_id = $1 AND kind = $2 AND dedupe_key = $3",
    [orgId, job.kind, job.dedupeKey],
  );
  const found = existing[0];
  if (!found) throw new Error(`Không ghi được job "${job.kind}" và cũng không tìm thấy bản trùng.`);
  return found.id;
}
```

- [ ] **Step 5: Viết `JobRunner`**

```ts
// packages/outbox/src/runner.ts
import type pg from "pg";

export interface OutboxJob {
  readonly id: string;
  readonly orgId: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
}

export type JobHandler = (job: OutboxJob, client: pg.PoolClient) => Promise<void>;

export interface JobRunnerOptions {
  readonly batchSize?: number;
  readonly maxAttempts?: number;
  readonly retryDelaySeconds?: number;
  readonly pollIntervalMs?: number;
}

interface ClaimedRow {
  id: string;
  org_id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export class JobRunner {
  readonly #pool: pg.Pool;
  readonly #handlers: Readonly<Record<string, JobHandler>>;
  readonly #batchSize: number;
  readonly #maxAttempts: number;
  readonly #retryDelaySeconds: number;
  readonly #pollIntervalMs: number;
  #timer: NodeJS.Timeout | null = null;
  #stopped = false;

  constructor(
    pool: pg.Pool,
    handlers: Readonly<Record<string, JobHandler>>,
    options: JobRunnerOptions = {},
  ) {
    this.#pool = pool;
    this.#handlers = handlers;
    this.#batchSize = options.batchSize ?? 10;
    this.#maxAttempts = options.maxAttempts ?? 5;
    this.#retryDelaySeconds = options.retryDelaySeconds ?? 30;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1000;
  }

  /** Lấy và xử lý một lô job. Trả về số job đã xử lý xong (thành công hoặc bỏ cuộc). */
  async runOnce(): Promise<number> {
    const claimed = await this.#claim();
    let done = 0;

    for (const row of claimed) {
      const job: OutboxJob = {
        id: row.id,
        orgId: row.org_id,
        kind: row.kind,
        payload: row.payload,
        attempts: row.attempts,
      };

      const handler = this.#handlers[job.kind];
      if (!handler) {
        // Không có handler là lỗi cấu hình, không phải lỗi tạm thời — bỏ cuộc ngay
        // thay vì thử lại mãi và che mất vấn đề.
        await this.#markFailed(job, `Không có handler cho kind "${job.kind}".`, true);
        done += 1;
        continue;
      }

      const client = await this.#pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.org_id', $1, true)", [job.orgId]);
        await handler(job, client);
        await client.query(
          "UPDATE outbox_jobs SET status = 'DONE', updated_at = now() WHERE id = $1",
          [job.id],
        );
        await client.query("COMMIT");
        done += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        await this.#markFailed(job, (error as Error).message, false);
        done += 1;
      } finally {
        client.release();
      }
    }

    return done;
  }

  start(): void {
    this.#stopped = false;
    const tick = async (): Promise<void> => {
      if (this.#stopped) return;
      try {
        await this.runOnce();
      } catch (error) {
        console.error("JobRunner gặp lỗi khi chạy lô:", (error as Error).message);
      }
      if (!this.#stopped) this.#timer = setTimeout(() => void tick(), this.#pollIntervalMs);
    };
    void tick();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /**
   * FOR UPDATE SKIP LOCKED: nhiều runner chạy song song sẽ nhận các lô rời nhau
   * thay vì tranh nhau cùng một hàng, nên không job nào bị xử lý hai lần.
   */
  async #claim(): Promise<ClaimedRow[]> {
    const { rows } = await this.#pool.query<ClaimedRow>(
      `UPDATE outbox_jobs
          SET status = 'RUNNING', attempts = attempts + 1, updated_at = now()
        WHERE id IN (
          SELECT id FROM outbox_jobs
           WHERE status = 'PENDING' AND run_after <= now()
           ORDER BY run_after
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, org_id, kind, payload, attempts`,
      [this.#batchSize],
    );
    return rows;
  }

  async #markFailed(job: OutboxJob, message: string, boCuocNgay: boolean): Promise<void> {
    const heoHan = boCuocNgay || job.attempts + 1 >= this.#maxAttempts;
    await this.#pool.query(
      `UPDATE outbox_jobs
          SET status = $2,
              last_error = $3,
              run_after = now() + make_interval(secs => $4::double precision),
              updated_at = now()
        WHERE id = $1`,
      [job.id, heoHan ? "FAILED" : "PENDING", message, heoHan ? 0 : this.#retryDelaySeconds],
    );
  }
}
```

```ts
// packages/outbox/src/index.ts
export { enqueueJob, type JobInput } from "./enqueue.js";
export {
  JobRunner,
  type JobHandler,
  type JobRunnerOptions,
  type OutboxJob,
} from "./runner.js";
```

> **Lưu ý quan trọng về RLS và runner.** `#claim` chạy ngoài ngữ cảnh tenant vì runner phục vụ mọi tổ chức. Nhưng `outbox_jobs` bật FORCE RLS, nên một kết nối `app_api` không gắn tenant sẽ thấy **0 hàng** và runner không bao giờ lấy được job nào.
>
> Vì vậy `JobRunner` phải nhận một pool có quyền vượt RLS. Trong test, đó là `db.pool` (siêu người dùng của Testcontainers) — chú ý các test ở Step 1 dùng `apiPool` để **ghi** job qua `withTenant`, nhưng dùng `db.pool` để **chạy** runner. Sự bất đối xứng này là có chủ đích và phản ánh đúng thiết kế triển khai thật.
>
> Khi triển khai thật, tạo một role `app_worker` riêng có `BYPASSRLS` và cấp quyền **chỉ** trên `outbox_jobs`, kèm bình luận nêu rõ lý do trong migration. Ngữ cảnh tenant được gắn lại bằng `set_config` ngay trước khi gọi handler, nên bản thân handler vẫn bị RLS ràng buộc bình thường — quyền vượt RLS chỉ dùng đúng cho bước lấy job.

- [ ] **Step 6: Chạy test và commit**

Chạy: `pnpm vitest run packages/outbox/src/outbox.int.test.ts`
Kỳ vọng: PASS — 8 test.

```bash
git add db packages/outbox pnpm-lock.yaml
git commit -m "feat(outbox): transactional outbox va job runner

Ghi y dinh vao cung transaction nghiep vu roi giao sau. Gui thong bao truc
tiep trong transaction dan toi mot trong hai hong hoc: transaction treo theo
do tre mang, hoac thong bao da gui ma transaction rollback.

Outbox KHONG BAO GIO la noi dat logic quyet dinh. Viec chan nop bao gia sau
deadline nam o rang buoc trong transaction (ADR-005, bat bien C2), khong nam
o job. Job chi lam nhung viec ma chay tre thi phien, chu khong sai.

FOR UPDATE SKIP LOCKED cho phep nhieu runner chay song song ma khong xu ly
trung. Khong co handler la loi cau hinh nen bo cuoc ngay thay vi thu lai mai
va che mat van de."
```

---

## Task 11: Bộ sinh ma trận bất biến và evidence pack

**Bất biến liên quan:** cơ chế bảo vệ **toàn bộ 44 mã bất biến (34 nghiệp vụ nhóm A–G + 10 hàng rào nhóm H)** khỏi bị bỏ quên khi hệ thống lớn lên.

> Đây là hạng mục biến kỷ luật kỹ thuật thành tài sản thương mại. Khi kiểm toán viên của khách hàng hỏi *"làm sao chứng minh nhân viên mua hàng không xem được giá trước giờ mở?"*, câu trả lời là bảng này kèm lịch sử chạy, thay vì một lời hứa. Mục 37 của đặc tả đặt North Star Metric là *Verified Competitive Spend*; chữ **Verified** chính là bảng này.

**Files:**
- Create: `tools/inv-matrix/package.json`, `tools/inv-matrix/src/index.ts`, `tools/inv-matrix/src/parse.ts`, `tools/inv-matrix/src/parse.test.ts`
- Modify: `package.json` (script `evidence`)
- Modify: `.github/workflows/ci.yml` (sinh và tải lên evidence pack)
- Modify: `.gitignore` (bỏ qua báo cáo thô, giữ ma trận)
- Modify: `docs/STATE.md`

**Interfaces:**
- Consumes: `docs/TEST-PLAN.md` (nguồn danh sách bất biến), các file test có nhãn `[INV-XX]`.
- Produces:
  - `parseInvariants(markdown: string): Invariant[]` với `Invariant = { id: string; statement: string; enforcement: string }`
  - `collectCoverage(testJsonReport: string): Map<string, TestOutcome[]>` với `TestOutcome = { id: string; name: string; status: "passed" | "failed" | "skipped" }`
  - `evidence/INV-matrix.md`
  - Mã thoát khác 0 khi có bất biến chưa được test nào phủ, hoặc có test phủ bất biến đang thất bại.

- [ ] **Step 1: Viết test thất bại cho bộ phân tích**

```ts
// tools/inv-matrix/src/parse.test.ts
import { describe, expect, it } from "vitest";
import { collectCoverage, parseInvariants } from "./parse.js";

const TEST_PLAN_MAU = [
  "### Nhóm A — Bí mật giá",
  "",
  "| ID | Bất biến | Cưỡng chế | Tầng test |",
  "|---|---|---|---|",
  "| **A1** | Không endpoint nào trả về giá trước khi mở thầu | Kiến trúc | T2, T5 |",
  "| **A4** | Không trường phái sinh nào rò rỉ giá | Bộ quét rò rỉ | **T2** |",
  "",
  "### Nhóm G — Vòng đời khóa",
  "",
  "| ID | Bất biến | Cưỡng chế | Tầng test |",
  "|---|---|---|---|",
  "| **G1** | Khóa riêng không rời runtime có kiểm soát | IAM + quyền cột DB | **T0**, T3 |",
].join("\n");

const BAO_CAO_MAU = JSON.stringify({
  testResults: [
    {
      name: "/repo/tests/architecture/boundaries.test.ts",
      assertionResults: [
        { fullName: "ranh giới kiến trúc > [INV-G1] chặn module ngoài unseal-worker", status: "passed" },
        { fullName: "ranh giới kiến trúc > mã nguồn hiện tại không vi phạm", status: "passed" },
      ],
    },
    {
      name: "/repo/packages/api/leak.test.ts",
      assertionResults: [
        { fullName: "quét rò rỉ > [INV-A1] không endpoint nào trả giá", status: "failed" },
      ],
    },
  ],
});

describe("phân tích ma trận bất biến", () => {
  it("đọc được toàn bộ bất biến từ TEST-PLAN", () => {
    const invariants = parseInvariants(TEST_PLAN_MAU);
    expect(invariants.map((i) => i.id)).toEqual(["A1", "A4", "G1"]);
    expect(invariants[0]?.statement).toBe("Không endpoint nào trả về giá trước khi mở thầu");
    expect(invariants[2]?.enforcement).toBe("IAM + quyền cột DB");
  });

  it("bỏ dấu ** khi đọc cột cưỡng chế in đậm", () => {
    const invariants = parseInvariants(TEST_PLAN_MAU);
    expect(invariants[1]?.enforcement).toBe("Bộ quét rò rỉ");
  });

  it("gom được test theo mã bất biến", () => {
    const coverage = collectCoverage(BAO_CAO_MAU);
    expect(coverage.get("G1")).toHaveLength(1);
    expect(coverage.get("A1")?.[0]?.status).toBe("failed");
    expect(coverage.has("A4")).toBe(false);
  });

  it("một test gắn nhiều mã bất biến được tính cho tất cả", () => {
    const coverage = collectCoverage(
      JSON.stringify({
        testResults: [
          {
            name: "/repo/x.test.ts",
            assertionResults: [{ fullName: "[INV-A1] và [INV-A4] cùng lúc", status: "passed" }],
          },
        ],
      }),
    );
    expect(coverage.get("A1")).toHaveLength(1);
    expect(coverage.get("A4")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Chạy: `pnpm vitest run tools/inv-matrix`
Kỳ vọng: FAIL — không tìm thấy `./parse.js`.

- [ ] **Step 3: Viết bộ phân tích**

```json
// tools/inv-matrix/package.json
{
  "name": "@trustprocure/inv-matrix",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts"
}
```

```ts
// tools/inv-matrix/src/parse.ts
export interface Invariant {
  readonly id: string;
  readonly statement: string;
  readonly enforcement: string;
}

export interface TestOutcome {
  readonly name: string;
  readonly status: "passed" | "failed" | "skipped";
}

const HANG_BAT_BIEN = /^\|\s*\*\*([A-H]\d+)\*\*\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$/;
const NHAN_BAT_BIEN = /\[INV-([A-H]\d+)\]/g;

function lamSach(cell: string): string {
  return cell.trim().replace(/^\*\*(.*)\*\*$/, "$1").trim();
}

/** Đọc sổ đăng ký bất biến từ docs/TEST-PLAN.md. Tài liệu là nguồn sự thật duy nhất. */
export function parseInvariants(markdown: string): Invariant[] {
  const invariants: Invariant[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = HANG_BAT_BIEN.exec(line);
    if (!match) continue;
    invariants.push({
      id: match[1]!,
      statement: lamSach(match[2]!),
      enforcement: lamSach(match[3]!),
    });
  }
  return invariants;
}

interface VitestJsonReport {
  testResults?: Array<{
    name?: string;
    assertionResults?: Array<{ fullName?: string; status?: string }>;
  }>;
}

/**
 * Gom kết quả test theo mã bất biến, dựa vào nhãn [INV-XX] trong tên test.
 * Một test gắn nhiều nhãn được tính cho tất cả các bất biến đó.
 */
export function collectCoverage(reportJson: string): Map<string, TestOutcome[]> {
  const report = JSON.parse(reportJson) as VitestJsonReport;
  const coverage = new Map<string, TestOutcome[]>();

  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      const name = assertion.fullName ?? "";
      const status =
        assertion.status === "passed" || assertion.status === "failed" ? assertion.status : "skipped";

      NHAN_BAT_BIEN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = NHAN_BAT_BIEN.exec(name)) !== null) {
        const id = match[1]!;
        const list = coverage.get(id) ?? [];
        list.push({ name, status });
        coverage.set(id, list);
      }
    }
  }

  return coverage;
}
```

- [ ] **Step 4: Chạy test để xác nhận đạt**

Chạy: `pnpm vitest run tools/inv-matrix`
Kỳ vọng: PASS — 4 test.

- [ ] **Step 5: Viết bộ sinh ma trận**

```ts
// tools/inv-matrix/src/index.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { collectCoverage, parseInvariants, type TestOutcome } from "./parse.js";

const REPO = resolve(import.meta.dirname, "../../..");
const TEST_PLAN = resolve(REPO, "docs/TEST-PLAN.md");
const REPORT = resolve(REPO, "evidence/vitest-report.json");
const OUTPUT = resolve(REPO, "evidence/INV-matrix.md");

function commitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "khong-xac-dinh";
  }
}

function ketQua(outcomes: TestOutcome[] | undefined): { nhan: string; hong: boolean } {
  if (!outcomes || outcomes.length === 0) return { nhan: "❌ CHƯA PHỦ", hong: true };
  if (outcomes.some((o) => o.status === "failed")) return { nhan: "🔴 ĐANG ĐỎ", hong: true };
  if (outcomes.every((o) => o.status === "skipped")) return { nhan: "⚠️ BỊ BỎ QUA", hong: true };
  return { nhan: "✅ ĐẠT", hong: false };
}

function main(): void {
  const invariants = parseInvariants(readFileSync(TEST_PLAN, "utf8"));
  if (invariants.length === 0) {
    console.error("Không đọc được bất biến nào từ docs/TEST-PLAN.md — kiểm tra định dạng bảng.");
    process.exit(1);
  }

  const coverage = collectCoverage(readFileSync(REPORT, "utf8"));
  const sha = commitSha();
  const thoiDiem = new Date().toISOString();

  const dong: string[] = [];
  const chuaDat: string[] = [];

  for (const inv of invariants) {
    const outcomes = coverage.get(inv.id);
    const { nhan, hong } = ketQua(outcomes);
    if (hong) chuaDat.push(inv.id);
    dong.push(
      `| ${inv.id} | ${inv.statement} | ${inv.enforcement} | ${outcomes?.length ?? 0} | ${nhan} |`,
    );
  }

  const noiDung = [
    "# Ma trận bất biến — Evidence Pack",
    "",
    "> Sinh tự động. Không sửa tay.",
    `> Commit: \`${sha}\` · Thời điểm: ${thoiDiem}`,
    "",
    `**${invariants.length - chuaDat.length}/${invariants.length} bất biến được kiểm chứng.**`,
    "",
    "| INV | Mệnh đề | Cưỡng chế | Số test | Kết quả |",
    "|---|---|---|---|---|",
    ...dong,
    "",
    "---",
    "",
    "Bất biến được coi là phủ khi có ít nhất một test mang nhãn `[INV-<mã>]` trong tên và",
    "test đó chạy đạt. Nguồn danh sách bất biến là `docs/TEST-PLAN.md` — thêm bất biến ở đó",
    "mà chưa có test tương ứng sẽ làm CI đỏ.",
    "",
  ].join("\n");

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, noiDung, "utf8");

  console.log(`Đã ghi ${OUTPUT}`);
  console.log(`${invariants.length - chuaDat.length}/${invariants.length} bất biến được kiểm chứng.`);

  if (chuaDat.length > 0) {
    console.error(`Bất biến chưa đạt: ${chuaDat.join(", ")}`);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 6: Nối vào script và CI**

Thêm vào `scripts` gốc:

```json
"test:report": "vitest run --reporter=json --outputFile=evidence/vitest-report.json",
"evidence": "pnpm test:report ; node --experimental-strip-types tools/inv-matrix/src/index.ts"
```

Dùng `;` chứ không phải `&&`: ma trận phải được sinh **kể cả khi** có test đỏ, vì đó chính là lúc cần nhìn thấy bất biến nào đang hỏng.

Thêm vào `.gitignore`:

```
evidence/vitest-report.json
```

Giữ `evidence/INV-matrix.md` trong version control — lịch sử của nó chính là bằng chứng theo thời gian.

Thêm job vào `.github/workflows/ci.yml`:

```yaml
  evidence:
    name: Evidence pack — ma tran bat bien
    runs-on: ubuntu-latest
    needs: [t1-t2, t3]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm evidence
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: inv-matrix
          path: evidence/INV-matrix.md
```

- [ ] **Step 7: Chạy lần đầu và chấp nhận kết quả đỏ**

Chạy: `pnpm evidence`

Kỳ vọng: **THẤT BẠI có chủ đích.** Ở cuối S0, nhóm A (bí mật giá), phần lớn nhóm B, C, E chưa có test nào vì chúng thuộc S1. Ma trận sẽ báo khoảng 21 trong 44 mã ở trạng thái `CHƯA PHỦ`.

Đây là kết quả **đúng** và là điều cần thấy: nó liệt kê chính xác phần việc còn lại của S1, và ngăn bất kỳ ai tuyên bố hệ thống đã sẵn sàng khi chưa có bằng chứng.

Ghi vào `docs/STATE.md` mục *Trạng thái kiểm thử*: số bất biến đã phủ trên tổng số, kèm danh sách mã chưa phủ.

- [ ] **Step 8: Cho phép CI đỏ có kiểm soát trong giai đoạn S0**

Job `evidence` sẽ đỏ tới hết S1. Đặt `continue-on-error: true` cho job này **và ghi rõ hạn chót gỡ bỏ**:

```yaml
      # Ma trận còn đỏ tới khi S1 hoàn tất — nhóm A, B, C, E phụ thuộc Sealed Bid Core.
      # GỠ DÒNG NÀY ở hạng mục S1.8. Sau S1, bất biến chưa phủ phải chặn merge.
      - run: pnpm evidence
        continue-on-error: true
```

- [ ] **Step 9: Cập nhật `docs/STATE.md` và commit**

Cập nhật các mục: *Cột mốc hiện tại* (S0 hoàn tất), *Điểm chặn* (gỡ mục hook fail-open, đã xử lý ở Task 1), *Trạng thái kiểm thử* (số bất biến đã phủ), *Hành động tiếp theo* (lập kế hoạch S1).

```bash
git add tools/inv-matrix package.json .github .gitignore evidence/INV-matrix.md docs/STATE.md
git commit -m "feat(evidence): bo sinh ma tran bat bien va evidence pack

Doc so dang ky bat bien tu docs/TEST-PLAN.md va doi chieu voi nhan [INV-XX]
trong ten test. Bat bien khong co test phu lam CI do.

Gia tri kep. Ve ky thuat, no ngan bat bien bi bo quen khi he thong lon len.
Ve kinh doanh, khi kiem toan vien cua khach hang hoi lam sao chung minh nhan
vien mua hang khong xem duoc gia truoc gio mo, cau tra loi la bang nay kem
lich su chay, thay vi mot loi hua.

Lan chay dau bao khoang 20/34 bat bien CHUA PHU — dung nhu ky vong, vi nhom
A, B, C, E phu thuoc Sealed Bid Core o S1. Job evidence tam thoi
continue-on-error, co ghi han chot go bo o hang muc S1.8."
```

---

## Đối chiếu với đặc tả

| Hạng mục S0 trong spec §9 | Task | Ghi chú |
|---|---|---|
| S0.1 — Khởi tạo repo, monorepo pnpm, viết lại 2 hook kèm test, dựng `docs/`, CI tầng T0, bảy ADR | 1, 2 | `docs/` và bảy ADR đã hoàn tất ở giai đoạn thiết kế; task 1–2 lo phần hook, monorepo và CI |
| S0.2 — Tenancy: TenantContext, RLS trên toàn bộ bảng | 4 | Kèm test phủ RLS tự động chặn lỗi tương lai |
| S0.3 — Audit chuỗi hash, bộ kiểm chứng, quyền DB | 5, 6 | Tách làm hai: cưỡng chế ở DB trước, chuỗi hash sau |
| S0.4 — `KeyProvider` interface, adapter, đo hiệu năng | 7 | Adapter KMS thật thuộc giai đoạn triển khai hạ tầng; S0 làm interface, adapter local-dev và công cụ đo |
| S0.5 — Identity: tổ chức, người dùng, vai trò, quyền, phiên, MFA TOTP | 8, 9 | Tách RBAC và MFA thành hai task vì hai chu kỳ test khác nhau |
| S0.6 — Transactional outbox và job runner | 10 | |
| S0.7 — Bộ khung test: Testcontainers, fixtures, sinh INV-matrix | 3, 11 | Testcontainers ở task 3 vì mọi task từ 4 trở đi đều cần |

**Bất biến được phủ trong S0:** B3, B4, D1, D3, D5, E3, F1, F2, F3, G1, G2, G3, G4 — 13 trong 34.

**Bất biến còn lại thuộc S1:** toàn bộ nhóm A (bí mật giá), B1/B2/B5, C1–C5, D2, D4, E1, E2, E4–E6 — chúng đòi hỏi RFQ, lời mời, phong bì niêm phong và luồng mở thầu, tức là Sealed Bid Core.

Đây là lý do job `evidence` được đặt `continue-on-error` ở task 11 và phải gỡ ở hạng mục S1.8.

## Điều kiện hoàn thành S0

S0 xong khi **tất cả** đúng:

1. Mười một task đã commit, mỗi task một commit riêng.
2. `pnpm t0 && pnpm test && pnpm test:int` xanh tại máy và trên CI.
3. Hai hook đã được kiểm chứng **bằng cách thật sự bị chặn** trong một phiên Claude Code, không chỉ bằng unit test.
4. Quy tắc `khong-giai-ma-ngoai-unseal-worker` đã được chứng minh chặn thật bằng test đối kháng ở task 2.
5. `pnpm evidence` sinh được `evidence/INV-matrix.md`, và báo đúng 23/44 mã đã phủ (13 nghiệp vụ nhóm A–G + 10 hàng rào nhóm H).
6. `pnpm bench:keys` đã chạy, con số thông lượng đã ghi vào `docs/STATE.md`.
7. `docs/STATE.md` phản ánh đúng trạng thái thật, đã đối chiếu với mã nguồn.
8. `security-reviewer` đã chạy trên task 4, 5, 6, 7, 8, 9 và mọi phát hiện CRITICAL/HIGH đã xử lý.

## Việc cần quyết định trước khi sang S1

1. **Thư mục `Vibe Coding/`.** Hiện là bản copy thủ công của CLAUDE.md và năm file SKILL, trùng với plugin `ai-eng-os` đã cài. README của plugin cảnh báo sẽ gây nhầm lẫn giữa `/feature` và `/ai-eng-os:feature`. Xóa hay chuyển thành `.claude/CLAUDE.md` là quyết định của bạn — kế hoạch này cố ý không tự làm vì đó là thao tác xóa file.
2. **Nhà cung cấp KMS.** ADR-004 để mở giữa AWS KMS, Azure Key Vault và HashiCorp Vault. Cần chốt trước task 7 nếu muốn viết adapter thật ngay, hoặc chốt trước S1.4 nếu chấp nhận dùng local-dev tới lúc đó.
3. **Nơi triển khai.** Chưa chọn hạ tầng đích. Ảnh hưởng tới cấu hình IAM tách quyền giải mã ở ADR-006 — mô hình đó cần một nhà cung cấp có IAM đủ chi tiết để cấp `kms:Decrypt` cho đúng một service.
