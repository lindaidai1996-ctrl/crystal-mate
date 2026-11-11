# 本地开发使用服务器数据库

## 日常使用

在项目目录运行 `npm run dev`，打开 <http://localhost:3000/zh/login>。命令会先建立或复用数据库 SSH 通道，再启动本地 Next.js；开发、页面热更新仍在电脑上运行，数据库数据写入腾讯云服务器。

`npm run db:migrate`、`npm run db:deploy`、`npm run db:admin` 也会先确保通道可用。仅需连接数据库工具时运行 `npm run db:tunnel`。电脑休眠或断网后，如请求数据库失败，重新运行 `npm run db:tunnel`；若通道刚断开，可能需要等待约 90 秒让 SSH 检测到连接失效后重试。

停止开发服务不会关闭数据库通道，方便继续使用 Prisma 或数据库工具。不再使用时可运行 `npm run db:tunnel:stop`。服务器数据库容器会持续运行，重启服务器后自动恢复。

## 数据分离

| 用途           | 应用入口                                                      | 数据库                    |
| -------------- | ------------------------------------------------------------- | ------------------------- |
| 本地开发与调试 | `http://localhost:3000/zh/login`                              | 服务器 `crystal_mate_dev` |
| 正式业务录入   | 当前通过 `http://localhost:3310/zh/login`；备案后使用正式域名 | 服务器 `crystal_mate`     |

开发库首次用正式库当前数据初始化，之后两者独立，不自动同步。开发中的新商品、修改、删除、表结构迁移不会自动进入正式库。功能开发完成后，需要部署代码并审查、执行正式库迁移；业务数据应直接在正式应用录入。不要把整个开发数据库覆盖到已有新业务数据的正式库。

两个库在独立 Docker 项目、容器、网络和数据卷内，使用不同账号、密码。开发容器限制 384 MB 内存，服务端仅监听 `127.0.0.1:5433`，电脑通过 SSH 转发到 `127.0.0.1:15432`，不开放数据库公网端口。服务器 SSH 不可用时，本地开发也无法读取数据库。

图片继续使用现有 COS 私有桶，复制的数据引用原图片；数据库分离不等于 COS 资源分离。现有应用删除图片关联时不会删除 COS 对象，新上传文件使用随机对象名。开发时不要手动删除桶内原图片，也不要清理“未引用对象”时只检查开发库。图片上传及 AI 调用仍使用现有服务，可能产生对应服务费用。

## 配置与回退

服务器目录 `/opt/crystal-mate`：

- `compose.development.yaml`：开发数据库容器定义。
- `.env.development-db.local`：开发数据库独立密码，仅服务器 root 可读。
- Docker 数据卷 `crystal-mate-development_postgres_data`：开发数据持久化位置。不要执行 `down -v`。

本机 `.env` 的 `DATABASE_URL` 和 `DIRECT_URL` 指向 `crystal_dev@127.0.0.1:15432/crystal_mate_dev`。`DEV_DATABASE_SSH_HOST`、`DEV_DATABASE_SSH_USER`、`DEV_DATABASE_SSH_IDENTITY_FILE`、`DEV_DATABASE_SSH_KNOWN_HOSTS_FILE` 配置专用部署密钥和已验证的主机指纹。示例见 [development.env.example](development.env.example)。启动器会检查两个连接都指向开发库后才建立通道；不要把这些设置复制到正式部署。

切换前的完整本机 `.env` 保存在 `backups/local-env-before-server-dev.env`，该文件包含敏感信息，不能上传 Git 或公开。若需要改回原本机数据库，先停止开发服务，再恢复此文件为 `.env` 后重新启动；旧本机数据库及数据没有删除。回退配置不会把新的开发数据同步回本机数据库。

## 备份

正式库继续每天北京时间 03:30 备份。开发库单独每天 03:45（最多随机延后五分钟）导出并加密上传到同一个 COS 私有桶，名称以 `crystal-dev-` 开头。两种备份共用已有备份加密密钥；密钥仍需单独妥善保管。本地服务器归档保留约 14 天，COS 归档暂不自动清理。

开发备份定时器 `crystal-mate-development-backup.timer`，服务 `crystal-mate-development-backup.service`；查看日志：

```bash
sudo systemctl status crystal-mate-development-backup.timer
sudo journalctl -u crystal-mate-development-backup.service -n 40 --no-pager
```

恢复方法沿用 [部署与备份说明](README.md)，但必须选 `crystal-dev-*.dump.enc` 备份并指定开发数据库容器及账号 `crystal_dev`。先恢复到独立验证库，确认后再切换，不能直接清空正式库。
