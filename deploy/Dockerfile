# syntax=docker/dockerfile:1.7
# ==============================================================================================
# deploy/Dockerfile — MỘT tệp, SÁU đích: api, worker, migrate (ADR-066), web (ADR-068), public-keys (ADR-070), neo (ADR-071)
#
#   docker build -f deploy/Dockerfile --target api     -t tp-api .
#   docker build -f deploy/Dockerfile --target worker  -t tp-unseal-worker .
#   docker build -f deploy/Dockerfile --target migrate -t tp-migrate .
#   docker build -f deploy/Dockerfile --target web     -t tp-web .
#   docker build -f deploy/Dockerfile --target public-keys -t tp-public-keys .
#   docker build -f deploy/Dockerfile --target neo     -t tp-neo .
#
# Không có bước biên dịch: ứng dụng chạy thẳng mã TypeScript bằng `node --experimental-transform-types`
# (cùng cách `pnpm api:dev`). Vì Node từ chối bóc kiểu cho tệp NẰM TRONG node_modules, image giữ đúng
# bố cục workspace — gói nội bộ là symlink `node_modules/@trustprocure/x → packages/x`, đường thật ở
# ngoài node_modules — nên KHÔNG dùng `pnpm deploy`.
#
# Mỗi đích chỉ cài phụ thuộc SẢN XUẤT của đúng gói ấy (`--prod --filter <gói>...`), chạy bằng user
# `node` (không root), và mang bó CA của RDS ghim theo sha256 để kết nối CSDL kiểm chứng chỉ
# (`NODE_EXTRA_CA_CERTS` cho api/worker — `createPool` bắt TLS và cấm sslmode trong URL).
# ==============================================================================================

ARG NODE_IMAGE=node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

FROM ${NODE_IMAGE} AS nguon
ENV CI=1 PNPM_HOME=/pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages packages
COPY apps apps
COPY tools/chay-migrate tools/chay-migrate
COPY tools/neo-so-kiem-toan tools/neo-so-kiem-toan
COPY db db
# Bó CA của RDS (toàn cầu). Đổi bó ⇒ đổi checksum ở đây, có chủ đích.
ADD --chmod=0644 --checksum=sha256:e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3 \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem

FROM nguon AS cai-api
RUN pnpm install --frozen-lockfile --prod --filter "@trustprocure/api..." && rm -rf /pnpm/store

FROM nguon AS cai-worker
RUN pnpm install --frozen-lockfile --prod --filter "@trustprocure/unseal-worker..." && rm -rf /pnpm/store

FROM nguon AS cai-public-keys
RUN pnpm install --frozen-lockfile --prod --filter "@trustprocure/public-keys..." && rm -rf /pnpm/store

FROM nguon AS cai-neo
RUN pnpm install --frozen-lockfile --prod --filter "@trustprocure/neo-so-kiem-toan..." && rm -rf /pnpm/store

FROM nguon AS cai-migrate
RUN pnpm install --frozen-lockfile --prod --filter "@trustprocure/chay-migrate..." && rm -rf /pnpm/store

FROM ${NODE_IMAGE} AS api
# `createPool` bắt TLS với rejectUnauthorized theo kho CA của Node; CA của RDS không nằm trong kho ấy.
ENV NODE_ENV=production NODE_EXTRA_CA_CERTS=/app/rds-ca.pem
WORKDIR /app
COPY --from=cai-api --chown=root:root /app /app
USER node
EXPOSE 8080
CMD ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", "./apps/api/register-ts-resolve.mjs", "apps/api/src/main.ts"]

FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production NODE_EXTRA_CA_CERTS=/app/rds-ca.pem
WORKDIR /app
COPY --from=cai-worker --chown=root:root /app /app
USER node
CMD ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", "./apps/unseal-worker/register-ts-resolve.mjs", "apps/unseal-worker/src/main.ts"]

FROM ${NODE_IMAGE} AS migrate
ENV NODE_ENV=production TRUSTPROCURE_MIGRATE_DB_CA_FILE=/app/rds-ca.pem
WORKDIR /app
COPY --from=cai-migrate --chown=root:root /app /app
USER node
CMD ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", "./tools/chay-migrate/register-ts-resolve.mjs", "tools/chay-migrate/src/index.ts"]

# [ADR-068] `web` chỉ phục vụ tĩnh sau ALB: không phụ thuộc nào (`dependencies` rỗng — ADR-044), không CSDL, không bí mật,
# không bó CA. Nó cần đúng hai thứ: `apps/web` và mã nguồn cửa trình duyệt của gói niêm phong, đọc lúc khởi động và gỡ
# kiểu bằng `stripTypeScriptTypes` — trình duyệt chạy đúng byte mà test của gói đo.
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production TRUSTPROCURE_WEB_STATIC_ONLY=1 TRUSTPROCURE_WEB_HOST=0.0.0.0 TRUSTPROCURE_WEB_PORT=8090
WORKDIR /app
COPY --chown=root:root apps/web apps/web
COPY --chown=root:root packages/sealed-envelope/src packages/sealed-envelope/src
USER node
EXPOSE 8090
CMD ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", "./apps/web/register-ts-resolve.mjs", "apps/web/src/main.ts"]

# [ADR-070] `public-keys` chỉ phục vụ nửa công khai nhận qua biến môi trường: không CSDL (không bó CA), không KMS.
FROM ${NODE_IMAGE} AS public-keys
ENV NODE_ENV=production TRUSTPROCURE_PUBLIC_KEYS_HOST=0.0.0.0 TRUSTPROCURE_PUBLIC_KEYS_PORT=8070
WORKDIR /app
COPY --from=cai-public-keys --chown=root:root /app /app
USER node
EXPOSE 8070
CMD ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", "./apps/public-keys/register-ts-resolve.mjs", "apps/public-keys/src/main.ts"]

# [ADR-071] `neo` — job một lần: đọc đầu chuỗi kiểm toán (CSDL qua TLS ⇒ bó CA của RDS), mượn tp-anchor-writer,
# ký bằng KMS ở tài khoản audit, ghi bucket neo. ENTRYPOINT là công cụ; CMD mặc định neo tài liệu khoá biên nhận —
# RunTask đổi lệnh (`xuat --org …`, `kiem --org …`) bằng containerOverrides.command.
FROM ${NODE_IMAGE} AS neo
ENV NODE_ENV=production NODE_EXTRA_CA_CERTS=/app/rds-ca.pem
WORKDIR /app
COPY --from=cai-neo --chown=root:root /app /app
USER node
ENTRYPOINT ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", "./tools/neo-so-kiem-toan/register-ts-resolve.mjs", "tools/neo-so-kiem-toan/src/index.ts"]
CMD ["khoa-bien-nhan"]
