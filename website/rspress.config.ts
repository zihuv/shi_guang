import { defineConfig } from "rspress/config";

export default defineConfig({
  title: "拾光",
  description: "为设计师而生的本地素材管理工具",
  outDir: ".rspress/build",
  base: "/shiguang/",
  icon: "/icon.ico",
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
      {
        text: "指南",
        items: [
          { text: "快速开始", link: "/guide/getting-started" },
          { text: "核心能力", link: "/guide/core-features" },
          { text: "采集与数据", link: "/guide/collection-and-storage" },
        ],
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "入门",
          items: [
            { text: "快速开始", link: "/guide/getting-started" },
          ],
        },
        {
          text: "核心功能",
          items: [
            { text: "核心能力", link: "/guide/core-features" },
          ],
        },
        {
          text: "数据管理",
          items: [
            { text: "采集与数据", link: "/guide/collection-and-storage" },
          ],
        },
      ],
    },
  },
});
