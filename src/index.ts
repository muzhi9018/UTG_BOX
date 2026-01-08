import { login } from "./core/application.js";
import { createPluginManager } from "./core/plugin-manager.js";


login().then(async (user) => {
  console.log(`登录成功，当前用户为: ${user.displayName}`);
  const pluginManager = await createPluginManager();
  await pluginManager.loadAll();
});
