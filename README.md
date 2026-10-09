# Crystal Mate 商品管理后台

Next.js App Router、React、Ant Design、Prisma 和 PostgreSQL 构成的单项目后台。当前仅实现管理员商品管理；商品均为库存 0/1 的孤品。管理界面支持中英切换，商品内容只保存中文原文。

## 本地运行

要求 Node.js 20.9+、npm，以及 PostgreSQL 16+。可以用 `docker compose up -d postgres` 启动数据库，也可以使用本机 PostgreSQL。

1. 复制 `.env.example` 为 `.env`，设置 `DATABASE_URL`、`DIRECT_URL` 和随机生成的 `AUTH_SECRET`。本地图片使用 `MEDIA_STORAGE=local`。
2. 执行 `npm install` 和 `npm run db:deploy`。
3. 本地示例配置 `ADMIN_USERNAME=admin`、`ADMIN_PASSWORD=123456`。执行 `npm run db:admin` 创建管理员；如果已有且仅有一个管理员，会更新其账号和密码。
4. 执行 `npm run dev`，打开 `http://localhost:3000/zh/login`。

数据库连接池场景中，`DATABASE_URL` 使用池连接地址，`DIRECT_URL` 使用直连地址；本地可设置为同一个地址。`123456` 仅供本地开发，生产环境必须改用独立的强密码、托管数据库和 HTTPS。

## 图片存储

本地模式把已验证的 JPG、PNG、WebP 写入 `public/uploads`，单张最多 8 MB、每件商品最多 12 张。该目录已加入 `.gitignore`，仅供开发使用；生产环境禁止本地模式。

部署到 Vercel 时设置 `MEDIA_STORAGE=cos`，并配置 `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION`。浏览器使用限时签名 URL 直接向 COS 上传，因此桶的 CORS 规则需要允许 `PUT` 和 `Content-Type` 请求头；允许来源为 `*` 时无需随网站域名变更规则。商品图片通过本站 `/api/images/` 接口由服务端从私有桶读取，仅管理员登录后可见，无需 COS 自定义域名或公有读权限。上传凭证有效期 5 分钟；上传后服务端检查对象存在且不超过 8 MB，再允许关联商品。更换或删除商品图片不会立即删除 COS 对象，后续应定期清理未引用对象与过期上传记录。

## 部署

将仓库连接 Vercel，配置生产环境变量、托管 PostgreSQL 和 COS。首次部署前在可访问数据库的环境运行 `npm run db:deploy` 和 `npm run db:admin`；后续数据库变更先执行迁移再发布对应应用版本。Vercel 自动执行 `npm run build`。不要在预览部署和生产部署间共享可写数据库。上线前从中国大陆网络实测访问速度及稳定性。

## 验证

`npm run typecheck`、`npm run lint`、`npm test` 和 `npm run build` 验证静态质量。初始化本地管理员后，可用 `E2E_USERNAME`、`E2E_PASSWORD` 运行 `npx playwright test`，覆盖登录保护、分类、商品、图片顺序、搜索、售罄及语言切换。首次运行先执行 `npx playwright install chromium`；若本机已有 Chrome，可设置 `PLAYWRIGHT_CHROME_PATH` 为浏览器可执行文件路径。
