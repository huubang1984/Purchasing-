import { register } from "node:module";

// [ADR-038] Bo ghi danh hook resolve cho `pnpm mcp:dev`. Cung khuon `apps/api`; xem ly do ban sao
// co chu y o dau `ts-resolve-hook.mjs`.
register("./ts-resolve-hook.mjs", import.meta.url);
