import { defineConfig } from "rspress/config";

export default defineConfig({
  title: "拾光",
  description: "拾光",
  outDir: ".rspress/build",
  base: "/shiguang/",
  themeConfig: {
    socialLinks: [
      {
        icon: "github",
        mode: "link",
        content: "https://github.com/zihuv/shiguang",
      },
    ],
    nav: [
      { text: "首页", link: "/" },
      { text: "指南", link: "/guide/getting-started" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "指南",
          items: [{ text: "快速开始", link: "/guide/getting-started" }],
        },
      ],
    },
  },
});
