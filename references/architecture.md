# 实现与兼容性

## 原生接入

国内版把自定义模型的 OpenAI 风格请求发往本机 `/v1/chat/completions`。连接组件将显示名称或旧的 `workbuddy-ai/<id>` 映射为国际账号模型 ID，保留消息、工具定义、工具结果与能力参数，向固定国际服务地址转发流式请求。

模型注册中的 `id` 与 `name` 使用同一显示字符串，避免原生客户端拼成 `名称:原始编号`。上游两条同名 Deepseek 路由中，`-sg` 追加 `(SG)`。

模型目录按白名单仅保留模型元数据；图片、视频标签不会作为对话模型登记。`contextWindow.supportedLengths` 与 `defaultLength` 驱动原生上下文选择器；支持列表含 1M 时默认 1M，只有固定 1M 输入上限而无列表时生成单档 1M。其他模型不伪造 1M。

## 运行时和生命周期

`setup.ps1` 使用用户明确选择的国际版安装程序，以 `ELECTRON_RUN_AS_NODE=1` 执行本项目管理脚本。安装后，将原生 MCP 命令设置为该运行时和本机复制的 `mcp-launcher.cjs`，两个安装路径以 MCP 环境变量传入，无需写死盘符。

MCP 探测进程可能很短，后台 HTTP 服务不能直接跟随探测 stdin 退出。启动器向上检查进程链，按国内版可执行文件完整路径找宿主；后台服务跟随该宿主存活。没有找到宿主、端口已有其他服务或旧服务时报告错误，不停止未知进程。已有旧版连接时正常关闭、打开国内版以完成更新，不强制重启。

## 凭证与请求

登录源是用户自己的国际版认证文件，使用已安装客户端的 native storage binding 在内存解密。令牌临近到期时走客户端使用的刷新接口，刷新结果仅保存在进程内存。重新登录或更换账号后仍需重新检查。

国内版官方安装中的 `credential-protection.js` 用于登记本机接口密钥，不复制这个模块到发布包。客户端自行改写密钥存储方式的行为不受本组件控制。

端点固定为 `https://www.workbuddy.ai`。本机服务不提供第三方代理目标配置，拒绝浏览器 Origin，仅接受 loopback 和连接密钥。`/health` 不需要密钥，仅输出服务和进程状态；`/refresh-models` 更新服务目录，不会独自更新原生菜单，菜单刷新使用安装流程。

## 文件变化

安装合并配置时保留其他模型与其他 MCP 条目，并保留对象形式模型配置中的其他根字段。写入前备份；若第二份配置写入失败，尝试恢复第一份原字节。备份和状态都在用户本机，不能打包发布。

`remove` 不解密原模型密钥，只按本组件标识移除对应配置；不会删除用户其他文件。后台已运行服务在正常关闭客户端后退出。

## 验收边界

自定义模型继承哪些原生能力，需要逐项真实任务验证。国内版知识库、云部署和市场资产的存在，不代表与每个国际模型的组合已经可用。显示 1M 与一次短回复不能证明满 1M 输入下的稳定性。

官方参考：[自定义模型](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)、[技能导入](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)、[项目级技能](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project)。内部协议结论来自本机实际观察，不冒充官方公开接口承诺。
