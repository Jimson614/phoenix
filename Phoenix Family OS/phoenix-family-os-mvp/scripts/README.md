# 架构检查

在 Family OS 根目录运行 node scripts/check-architecture.cjs。
也可以从任意目录使用脚本的完整路径运行；脚本自行定位项目根。

它检查预留目录、当前来源映射、Markdown 本地链接和既有运行入口。
不启动服务器、不连接模型、不执行迁移、不写文件，也不保证生产安全。
原测试命令保留在 package.json。
