import { defineConfig } from "rspress/config";

export default defineConfig({
  title: "拾光文档",
  description: "拾光桌面应用技术文档",
  themeConfig: {
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/zihuv/shiguang",
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
