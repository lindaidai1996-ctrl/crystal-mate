# 腾讯云单机部署与数据库迁移

生产使用独立的 `compose.production.yaml`，不使用本地开发的 `compose.yaml`。本次迁移源为本机 `.env` 指向的 PostgreSQL 18 数据库；Supabase 保持原样。当前先让应用只监听服务器回环地址；通过 SSH 隧道验证，确认备案及域名后再启用 HTTPS 入口。图片继续留在原 COS 桶。

## 服务器准备

使用 Ubuntu 22.04/24.04 LTS、x86_64，安装 Docker Engine 和 Compose v2 插件。官方安装说明：https://docs.docker.com/engine/install/ubuntu/ 。确认 `docker version` 和 `docker compose version` 正常；执行命令的用户需要 Docker 权限。

上传源码到服务器独立目录，例如 `/opt/crystal-mate`。不要上传本机的 `node_modules`、`.next`、`.git` 或开发数据库文件。生产密钥单独安全传输；不要把带密钥的环境文件放进镜像、Git、截图或聊天。

将 `deploy/production.env.example` 复制为根目录 `.env.production` 并设置权限 `chmod 600 .env.production`。用两次独立的 `openssl rand -hex 32` 生成数据库密码和 `AUTH_SECRET`。复制现有生产 COS 配置，以及实际使用的 AI 配置。数据库连接串由 Compose 自动设置，不要复制 Supabase 的连接串到目标应用环境。

`POSTGRES_PASSWORD` 使用生成的十六进制字符串，避免连接 URL 中特殊字符的编码问题。仅首次创建数据库卷时会使用该密码，后续修改环境变量不会自动修改数据库里的密码。不要执行 `docker compose down -v`，它会删除数据库卷。

## 构建与启动数据库

以下命令均在仓库根目录执行：

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml build app migrate
docker compose --env-file .env.production -f compose.production.yaml up -d postgres
```

低配服务器构建时暂不开其他业务；也可以在可信的 Linux amd64 构建环境构建同一镜像再上传。不要把 Mac 的 node_modules 或 macOS 原生依赖复制进 Linux 镜像。

## 迁移现有数据库

先确认迁移源，首次读取只核对 PostgreSQL 版本、迁移记录和各表数量；不要对源库执行 Prisma 迁移、建管理员或删除操作。可用 `node deploy/inspect-db.mjs .env` 只读生成所有 public 表的记录数和内容指纹，输出不含业务明细。

目标默认 PostgreSQL 18，数据卷挂载 `/var/lib/postgresql`，使用镜像的 18 版目录布局。先确认源版本不高于 18，并使用 PostgreSQL 18 的 `pg_dump`；如果源是更高主版本，先调整目标版本和备份工具，不能直接降级恢复。

1. 本次从本机 `.env` 的 `DIRECT_URL` 导出，只导出应用使用的 `public`，包含 `_prisma_migrations`、管理员密码哈希、库存、附件和草稿。若以后迁移 Supabase，应使用直连或 Session Pooler（通常端口 5432），避免 Transaction Pooler（通常端口 6543），不迁移 Supabase 管理的系统 schema。
2. 使用 `pg_dump --format=custom --schema=public --no-owner --no-privileges`。通过受限权限的 `.pgpass` 或环境变量提供密码，不要把完整连接串写进可见命令历史。归档文件需要权限 600，并通过 SSH 传输。
3. 将源归档上传为根目录的 `backups/source-public.dump`，恢复到尚未执行 Prisma 迁移的空目标库。不能先运行迁移再恢复同一份完整 schema。

```bash
docker compose --env-file .env.production -f compose.production.yaml \
  exec -T postgres psql -U crystal -d crystal_mate -v ON_ERROR_STOP=1 <<'SQL'
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public') THEN
    RAISE EXCEPTION 'Target is not empty; stop and investigate';
  END IF;
  EXECUTE 'DROP SCHEMA public';
END $guard$;
SQL

docker compose --env-file .env.production -f compose.production.yaml \
  exec -T postgres pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  -U crystal -d crystal_mate < backups/source-public.dump

docker compose --env-file .env.production -f compose.production.yaml \
  run --rm migrate migrate status
docker compose --env-file .env.production -f compose.production.yaml \
  run --rm migrate
docker compose --env-file .env.production -f compose.production.yaml up -d app
```

恢复失败时保留日志并调查，不要忽略报错或在有数据的库上重复恢复。Supabase 特有的扩展、触发器、权限、RLS 或外部 schema 依赖需要逐项处理。此项目密码登录由 Auth.js 和应用的 Admin 表实现，迁移后沿用原账号密码，不运行创建管理员脚本来覆盖密码。

## 内部验证

在本机建立隧道；本地 3310 如已被占用，改为其他端口，并同步调整 `.env.production` 的 `AUTH_URL` 后重建应用容器。

```bash
ssh -L 3310:127.0.0.1:3000 ubuntu@SERVER_IP
```

浏览器打开 `http://localhost:3310/zh/login`。核对所有业务表和迁移记录、原账号登录、商品/物料/采购数据、库存和金额、原有图片读取、新图片上传、AI 功能（如启用）。演练库上的写入仅用于验证，最终迁移应恢复源库的最新数据。

## 最终切换与 HTTPS

最终迁移前停止旧环境的业务写入，包括仍可能访问 Vercel 的用户。最终导出必须在停止写入后完成，并恢复到专门准备的空目标数据库；保留演练数据卷直到确认不再需要，不对未知数据卷做删除操作。核对表数量和关键金额后再开放新环境。

备案与接入要求确认完成后，将阿里云 DNS 的域名 A 记录指向服务器 IP，配置 `.env.production` 的 `APP_DOMAIN`、`ACME_EMAIL` 和 `AUTH_URL=https://你的域名`。如域名配置了 AAAA，确保指向可访问的 IPv6，否则删除错误记录。只在启用公网入口时开放 80/443；数据库 5432 和应用 3000 不对公网开放。

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d app
docker compose --env-file .env.production -f compose.production.yaml \
  --profile public up -d caddy
```

Caddy 会申请并续期证书。核对 COS CORS 允许新域名发起 PUT 和 Content-Type；保持私有桶。对外切换后旧环境继续保留，但禁止两边同时写入。新库开始写入后，回退不能只切 DNS：需要先停写并迁回新增数据，避免业务数据丢失。

## 备份与运维

### 网站备案页脚

登录页和所有管理页面底部均显示 `粤ICP备2026180719号-1`，链接到工信部备案管理系统。部署此版本后生效。

公安联网备案待审核期间不展示公安备案标识。审核通过后，从公安备案平台获取正式信息，在服务器 `.env.production` 中配置以下三项；三项齐全时才会显示：

- `PUBLIC_SECURITY_RECORD_NUMBER`：平台核发的完整公安备案号，带空格时使用引号包裹。
- `PUBLIC_SECURITY_RECORD_URL`：平台提供的该网站备案查询链接。
- `PUBLIC_SECURITY_RECORD_ICON`：平台提供的图标地址，或放入 `public` 目录后的站内路径（例如 `/images/备案图标文件名.png`）。新增本地图标时需要重新构建镜像。

不要使用腾讯云的“公安联网备案数据码”作为正式备案号。配置通过服务端在请求时读取，无需设置 `NEXT_PUBLIC_` 变量。仅修改这三项环境变量时，重新创建应用容器即可：

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d --no-deps app
```

更新后核对登录页、管理页的备案号码、图标及查询链接。

### 日常维护

`sh deploy/backup.sh` 生成仅当前用户可读的备份文件，并验证归档目录可读；这还不等于数据库已经能完整恢复，必须定期恢复到独立数据库演练。脚本不会删除旧备份，监控磁盘空间并单独制定保留策略。

异机备份使用 `backup-offsite.sh`：先导出并验证本地归档，再使用 AES-256-GCM 加密，上传同一私有 COS 桶的 `crystal-mate/db-backups/` 前缀，核对远端长度。成功后清理超过 14 天的自动本地备份；COS 备份不会自动删除，需观察用量并按恢复需求设置保留策略。备份运行使用迁移工具镜像，配置见 `backup.env.example`。

`.env.backup.local` 单独保存 COS 配置、镜像版本及备份加密密钥，权限必须为 600。务必在服务器之外再保存一份解密密钥；只有 COS 归档而丢失密钥时无法恢复。恢复时下载 `.enc` 文件，在已安装项目依赖的本机执行：

```bash
node deploy/decrypt-backup.mjs archive.dump.enc restored.dump backups/backup-key.env
```

安装 `crystal-mate-backup.service` 和 `crystal-mate-backup.timer` 到 `/etc/systemd/system/`，执行 `systemctl daemon-reload` 和 `systemctl enable --now crystal-mate-backup.timer`。每日北京时间 03:30 后随机延迟最多 5 分钟备份。用 `systemctl start crystal-mate-backup.service` 手动执行，用 `journalctl -u crystal-mate-backup.service` 查看结果。任务失败会记录为 failed，目前没有接入短信/邮件告警，应定期检查。

数据库归档包含业务数据和密码哈希，不要设为公有读。COS 图片是独立资产，也需要版本/误删保护策略。

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 app
sh deploy/backup.sh
```

日志配置已限制单服务的轮转大小；仍需监控 Docker 镜像、数据库、备份及整机磁盘占用。更新前先备份，使用版本号区分镜像；数据库迁移可能不向后兼容，不能只依赖回退旧镜像。
